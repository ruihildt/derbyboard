import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { SceneCanvas } from 'konva/lib/Canvas.js';
import type { KonvaGame } from '$lib/konva/KonvaGame';
import { colors } from '$lib/constants';
import { interpolateSample } from '../timeline/interpolate';
import type { TimelineProject } from '../timeline/types';

export interface VideoExportOptions {
	game: KonvaGame;
	project: TimelineProject;
	audioBlob: Blob | null;
	/** Output height in pixels (width follows the recording's aspect). */
	height: number;
	fps: number;
	/** Video bitrate in bits/sec. */
	bitrate: number;
	signal?: AbortSignal;
	onProgress?: (framesRendered: number, totalFrames: number) => void;
}

export interface VideoExportResult {
	blob: Blob;
	audioIncluded: boolean;
}

/**
 * H.264 codec candidates (high → low level). Baseline is tried first — it
 * forbids B-frames by spec, so decode order == presentation order (no `ctts`
 * boxes). Some backends (notably Firefox) reject Baseline *encode* outright, so
 * High/Main are probed as fallbacks. `latencyMode: 'realtime'` discourages
 * B-frames there too, and the output callback passes a composition offset so any
 * stray B-frames still mux correctly. Annex-B → AVCC conversion is handled in
 * the output callback regardless of which profile/format is selected.
 */
const H264_CANDIDATES = [
	'avc1.42E034', // Baseline 5.2 (4K@60) — no B-frames
	'avc1.42E033', // Baseline 5.1 (4K@30)
	'avc1.42E028', // Baseline 4.0 (1080p)
	'avc1.42E01F', // Baseline 3.1
	'avc1.640034', // High 5.2 — fallback if Baseline unsupported
	'avc1.640033', // High 5.1
	'avc1.4D4034', // Main 5.2
	'avc1.4D4033' // Main 5.1
];

const AUDIO_BITRATE = 128_000;

/**
 * Renders a recorded timeline to an mp4 via WebCodecs. Each frame is rasterized
 * from the live stage with `stage.toCanvas` at the target resolution (sharp —
 * vector re-rasterization, not a pixel upscale), then hardware-encoded to H.264.
 * Audio (webm/opus) is decoded to PCM and re-encoded to AAC. Requires WebCodecs
 * `VideoEncoder`/`AudioEncoder`.
 */
export class TimelineVideoExporter {
	async export(opts: VideoExportOptions): Promise<VideoExportResult> {
		const { game, project, audioBlob, height, fps, bitrate, signal, onProgress } = opts;
		const stage = game.getStage();
		const watermark = game.getWatermark();

		const stageW = stage.width();
		const stageH = stage.height();

		// Output dimensions + screen-space crop.
		let width: number;
		let crop: { x: number; y: number; width: number; height: number };
		if (project.frame) {
			const z = project.frame.region;
			const cw = z.wFrac * stageW;
			const ch = z.hFrac * stageH;
			crop = { x: z.xFrac * stageW, y: z.yFrac * stageH, width: cw, height: ch };
			width = Math.round((height * cw) / ch);
		} else {
			width = Math.round((height * stageW) / stageH);
			crop = { x: 0, y: 0, width: stageW, height: stageH };
		}

		// H.264 encoders (notably Firefox's) reject non-macroblock-aligned
		// dimensions — an odd width is invalid for 4:2:0, and Firefox requires
		// multiples of 16 — and level 5.2 caps frame size at 36864 macroblocks
		// (MaxFS). Align both up to 16; if that exceeds MaxFS (wide aspects at
		// high res, e.g. full-board 2160p → 4528×2160), scale down
		// proportionally — preserving the aspect — to the largest 16-aligned
		// legal size. The VideoFrame must match these dims exactly.
		const MAX_MACROBLOCKS = 36864;
		let encodeWidth = Math.ceil(width / 16) * 16;
		let encodeHeight = Math.ceil(height / 16) * 16;
		const macroblocks = (encodeWidth / 16) * (encodeHeight / 16);
		if (macroblocks > MAX_MACROBLOCKS) {
			const scale = Math.sqrt(MAX_MACROBLOCKS / macroblocks);
			encodeWidth = Math.floor((encodeWidth * scale) / 16) * 16;
			encodeHeight = Math.floor((encodeHeight * scale) / 16) * 16;
			console.log(
				`[video] capped to H.264 MaxFS: ${width}x${height} → ${encodeWidth}x${encodeHeight}`
			);
		}
		const encodePixelRatio = encodeWidth / crop.width;

		// Decode audio (best-effort; degrade to video-only on failure).
		let audioBuffer: AudioBuffer | null = null;
		if (audioBlob && audioBlob.size > 0) {
			try {
				const arrayBuffer = await audioBlob.arrayBuffer();
				const audioCtx = new AudioContext();
				audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
				await audioCtx.close();
			} catch (e) {
				console.warn('[TimelineVideoExporter] audio decode failed; video-only', e);
				audioBuffer = null;
			}
		}

		const muxer = new Muxer({
			target: new ArrayBufferTarget(),
			video: { codec: 'avc', width: encodeWidth, height: encodeHeight, frameRate: fps },
			audio: audioBuffer
				? {
						codec: 'aac',
						numberOfChannels: audioBuffer.numberOfChannels,
						sampleRate: audioBuffer.sampleRate
					}
				: undefined,
			fastStart: 'in-memory',
			firstTimestampBehavior: 'strict'
		});

		const frameDurationUs = Math.round(1_000_000 / fps);
		const videoConfig = await pickVideoConfig(encodeWidth, encodeHeight, fps, bitrate);

		let videoError: DOMException | null = null;
		// Some backends (e.g. Firefox) emit Annex-B NALUs; mp4-muxer expects
		// length-prefixed AVCC. Convert Annex-B → AVCC on the fly (build an avcC from
		// the keyframe's SPS/PPS), and pass AVCC through unchanged. Chunks arrive in
		// decode order, so DTS = decodeIndex*frameDuration and the composition offset
		// (PTS - DTS) is 0 for Baseline/realtime (no B-frames) and nonzero otherwise.
		let avccDescription: Uint8Array | null = null;
		let loggedBitstream = false;
		let decodeIndex = 0;
		const videoEncoder = new VideoEncoder({
			output: (chunk, meta) => {
				const raw = new Uint8Array(chunk.byteLength);
				chunk.copyTo(raw);
				const annexB =
					raw.length >= 3 &&
					raw[0] === 0 &&
					raw[1] === 0 &&
					(raw[2] === 1 || (raw[2] === 0 && raw.length >= 4 && raw[3] === 1));

				let sample: Uint8Array;
				let description: AllowSharedBufferSource | undefined;
				if (annexB) {
					const nalus = parseAnnexBNalUnits(raw);
					if (avccDescription === null) {
						const sps = nalus.find((n) => (n[0] & 0x1f) === 7);
						const pps = nalus.find((n) => (n[0] & 0x1f) === 8);
						if (sps && pps) avccDescription = buildAvcC(sps, pps);
					}
					sample = toAvccSample(nalus.filter((n) => (n[0] & 0x1f) !== 7 && (n[0] & 0x1f) !== 8));
					description = avccDescription ?? undefined;
					if (!loggedBitstream) {
						console.log('[video] bitstream: AnnexB → AVCC (converted)');
						loggedBitstream = true;
					}
				} else {
					sample = raw;
					description = meta?.decoderConfig?.description ?? undefined;
					if (!loggedBitstream) {
						console.log('[video] bitstream: AVCC (passthrough)');
						loggedBitstream = true;
					}
				}

				const outMeta: EncodedVideoChunkMetadata | undefined = description
					? ({
							decoderConfig: { codec: videoConfig.codec, description }
						} as EncodedVideoChunkMetadata)
					: undefined;
				// DTS advances by one frame per output chunk (decode order); PTS is the
				// chunk's timestamp. Their difference is the composition offset.
				const dts = decodeIndex * frameDurationUs;
				const compositionTimeOffset = chunk.timestamp - dts;
				decodeIndex++;
				muxer.addVideoChunkRaw(
					sample,
					chunk.type === 'key' ? 'key' : 'delta',
					chunk.timestamp,
					frameDurationUs,
					outMeta,
					compositionTimeOffset
				);
			},
			error: (e) => {
				videoError = e;
			}
		});
		videoEncoder.configure(videoConfig);

		let audioEncoder: AudioEncoder | null = null;
		if (audioBuffer) {
			const supported = await AudioEncoder.isConfigSupported({
				codec: 'mp4a.40.2',
				sampleRate: audioBuffer.sampleRate,
				numberOfChannels: audioBuffer.numberOfChannels,
				bitrate: AUDIO_BITRATE
			});
			if (supported.supported) {
				audioEncoder = new AudioEncoder({
					output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
					error: (e) => console.warn('[TimelineVideoExporter] audio encode error', e)
				});
				audioEncoder.configure({
					codec: 'mp4a.40.2',
					sampleRate: audioBuffer.sampleRate,
					numberOfChannels: audioBuffer.numberOfChannels,
					bitrate: AUDIO_BITRATE
				});
			} else {
				console.warn('[TimelineVideoExporter] AAC not supported; video-only');
				audioBuffer = null;
			}
		}

		// Render + encode video frames deterministically.
		const totalFrames = Math.max(1, Math.ceil((project.durationMs / 1000) * fps));

		// Persistent render canvases (allocated ONCE, reused every frame).
		// `stage.toCanvas` allocates 1 + 2·N `SceneCanvas` instances per call
		// (one per visible layer, each with its own buffer) and releases none
		// but the returned one — ~342MB/frame churn at 4K, the OOM root cause.
		// Instead we render each layer directly into a reused `workScene` via
		// `layer.drawScene`, compositing onto the aligned `outCanvas` below.
		const workScene = new SceneCanvas({
			width: crop.width,
			height: crop.height,
			pixelRatio: encodePixelRatio
		});
		// Buffer canvas for shapes that need one (shadow / composite op). Sized
		// larger than the crop by the offset to fit overhanging buffered shapes
		// — same heuristic as Konva's own `Node._toKonvaCanvas`.
		const workBuffer = new SceneCanvas({
			width: crop.width + Math.abs(crop.x),
			height: crop.height + Math.abs(crop.y),
			pixelRatio: encodePixelRatio
		});
		// Reusable macroblock-aligned output canvas. `drawScene` can't guarantee
		// 16-aligned pixel dims (height follows the crop aspect), so we render
		// the crop at the encode width, then blit (sub-1% stretch) into this
		// exact-sized canvas the encoder expects.
		const outCanvas = document.createElement('canvas');
		outCanvas.width = encodeWidth;
		outCanvas.height = encodeHeight;
		const outCtx = outCanvas.getContext('2d');
		const layers = stage.children;

		try {
			for (let i = 0; i < totalFrames; i++) {
				if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
				if (videoError) throw videoError;

				const tMs = (i / fps) * 1000;
				game.applySnapshot(interpolateSample(project, tMs));

				if (outCtx) {
					outCtx.fillStyle = colors.canvasBackground;
					outCtx.fillRect(0, 0, encodeWidth, encodeHeight);
					const workCtx = workScene.getContext();
					for (const layer of layers) {
						if (!layer.isVisible()) continue;
						// Full clear BEFORE the crop translate — `clear()` is
						// transform-aware, so a translate would clear a shifted region
						// and leak the previous layer.
						workCtx.clear();
						workCtx.save();
						workCtx.translate(-crop.x, -crop.y);
						layer.drawScene(workScene, undefined, workBuffer);
						workCtx.restore();
						outCtx.drawImage(workScene._canvas, 0, 0, encodeWidth, encodeHeight);
					}
					if (watermark) watermark.draw(outCtx, encodeWidth, encodeHeight, encodePixelRatio);
				}

				const frame = new VideoFrame(outCanvas, {
					timestamp: i * frameDurationUs,
					duration: frameDurationUs
				});
				videoEncoder.encode(frame, { keyFrame: i % fps === 0 });
				frame.close();

				onProgress?.(i + 1, totalFrames);

				if (i % 30 === 0) {
					console.log(
						`[video] frame ${i + 1}/${totalFrames} encodeQueue=${videoEncoder.encodeQueueSize}`
					);
				}

				// Cap pending VideoFrames and yield every frame so the encoder can
				// drain and the event loop stays responsive.
				if (videoEncoder.encodeQueueSize > 4) await waitForQueue(videoEncoder, 2);
				await new Promise((r) => setTimeout(r, 0));
			}

			await videoEncoder.flush();

			if (audioEncoder && audioBuffer) {
				await encodeAudio(audioEncoder, audioBuffer, signal);
				await audioEncoder.flush();
			}

			muxer.finalize();
			const { buffer } = muxer.target;
			return { blob: new Blob([buffer], { type: 'video/mp4' }), audioIncluded: !!audioBuffer };
		} finally {
			videoEncoder.close();
			audioEncoder?.close();
			// Release the persistent render-canvas backing stores (Konva's own
			// `releaseCanvas` pattern: width=height=0) so a repeated export in the
			// same tab doesn't accumulate them.
			for (const c of [workScene._canvas, workBuffer._canvas, outCanvas]) {
				c.width = 0;
				c.height = 0;
			}
		}
	}
}

/**
 * AVC bitstream formats to probe, in priority order. The output callback
 * normalizes both Annex-B and AVCC to AVCC for mp4-muxer, so either is fine; we
 * just need the one the backend can produce. Probing all variants avoids
 * guessing per-browser (Firefox and Chromium differ here).
 */
const AVC_FORMATS: ('annexb' | 'avc' | undefined)[] = ['annexb', 'avc', undefined];

async function pickVideoConfig(
	width: number,
	height: number,
	fps: number,
	bitrate: number
): Promise<VideoEncoderConfig> {
	console.log('[video] picking config', { width, height, fps, bitrate, ua: navigator.userAgent });
	for (const codec of H264_CANDIDATES) {
		for (const format of AVC_FORMATS) {
			// `latencyMode: 'realtime'` discourages B-frames, keeping decode ==
			// presentation order (the output callback still handles any offset).
			const cfg: VideoEncoderConfig = {
				codec,
				width,
				height,
				bitrate,
				framerate: fps,
				latencyMode: 'realtime',
				...(format ? { avc: { format } } : {})
			};
			try {
				const support = await VideoEncoder.isConfigSupported(cfg);
				console.log('[video] isConfigSupported', codec, `avc=${format ?? 'default'}`, {
					supported: support.supported,
					avc: support.config?.avc,
					bitrate: support.config?.bitrate
				});
				if (support.supported && support.config) {
					console.log('[video] picked', codec, 'avc=', support.config.avc);
					return { ...cfg, ...support.config };
				}
			} catch (e) {
				console.log('[video] isConfigSupported threw', codec, `avc=${format ?? 'default'}`, e);
			}
		}
	}
	// Diagnostic: no H.264 config worked. Probe what this backend CAN encode and
	// whether macroblock-aligned dimensions help, so the logs point at the real
	// fallback (a different codec/container, or a different browser) instead of a
	// bare "not supported" error.
	console.warn('[video] no H.264 config supported; probing alternatives...');
	const probes: { codec: string; label: string }[] = [
		{ codec: 'avc1.640033', label: 'H.264 High (aligned dims)' },
		{ codec: 'vp09.00.10.08', label: 'VP9' },
		{ codec: 'av01.0.04M.08', label: 'AV1' },
		{ codec: 'hev1.1.6.L120.B0', label: 'HEVC' }
	];
	const aw = Math.ceil(width / 16) * 16;
	const ah = Math.ceil(height / 16) * 16;
	for (const { codec, label } of probes) {
		const dims = label.startsWith('H.264') ? { width: aw, height: ah } : { width, height };
		try {
			const s = await VideoEncoder.isConfigSupported({
				codec,
				...dims,
				bitrate,
				framerate: fps,
				...(label.startsWith('H.264') ? { avc: { format: 'annexb' } } : {})
			});
			console.log('[video] probe', label, `${dims.width}x${dims.height}`, {
				supported: s.supported
			});
		} catch (e) {
			console.log('[video] probe', label, 'threw', e);
		}
	}
	throw new Error('No supported H.264 VideoEncoder configuration for this browser');
}

function waitForQueue(encoder: { encodeQueueSize: number }, threshold: number): Promise<void> {
	return new Promise((resolve) => {
		const check = (): void => {
			if (encoder.encodeQueueSize <= threshold) resolve();
			else setTimeout(check, 2);
		};
		check();
	});
}

async function encodeAudio(
	encoder: AudioEncoder,
	buffer: AudioBuffer,
	signal?: AbortSignal
): Promise<void> {
	const sampleRate = buffer.sampleRate;
	const channels = buffer.numberOfChannels;
	const chunkFrames = Math.floor(sampleRate); // ~1s slices
	for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
		if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
		const frames = Math.min(chunkFrames, buffer.length - offset);
		const planar = new Float32Array(channels * frames);
		for (let c = 0; c < channels; c++) {
			planar.set(buffer.getChannelData(c).subarray(offset, offset + frames), c * frames);
		}
		const data = new AudioData({
			format: 'f32-planar',
			sampleRate,
			numberOfFrames: frames,
			numberOfChannels: channels,
			timestamp: Math.round((offset / sampleRate) * 1_000_000),
			data: planar
		});
		encoder.encode(data);
		data.close();
		if (encoder.encodeQueueSize > 8) await waitForQueue(encoder, 4);
	}
}

/** Splits an Annex-B byte stream into its NAL units (without start codes). */
function parseAnnexBNalUnits(data: Uint8Array): Uint8Array[] {
	const units: Uint8Array[] = [];
	let nalStart = -1;
	const len = data.length;
	let i = 0;
	while (i < len) {
		// 4-byte start code 00 00 00 01
		if (
			i + 3 < len &&
			data[i] === 0 &&
			data[i + 1] === 0 &&
			data[i + 2] === 0 &&
			data[i + 3] === 1
		) {
			if (nalStart >= 0) units.push(data.subarray(nalStart, i));
			nalStart = i + 4;
			i = nalStart;
			continue;
		}
		// 3-byte start code 00 00 01
		if (i + 2 < len && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
			if (nalStart >= 0) units.push(data.subarray(nalStart, i));
			nalStart = i + 3;
			i = nalStart;
			continue;
		}
		i++;
	}
	if (nalStart >= 0) units.push(data.subarray(nalStart, len));
	return units;
}

/** Builds an avcC decoder configuration record from SPS + PPS NAL units. */
function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
	const out = new Uint8Array(11 + sps.length + pps.length);
	let o = 0;
	out[o++] = 1; // configurationVersion
	out[o++] = sps[1]; // AVCProfileIndication (profile_idc)
	out[o++] = sps[2]; // profile_compatibility
	out[o++] = sps[3]; // AVCLevelIndication (level_idc)
	out[o++] = 0xff; // 111111 + lengthSizeMinusOne(3) ⇒ 4-byte lengths
	out[o++] = 0xe1; // 111 + numOfSequenceParameterSets(1)
	out[o++] = (sps.length >>> 8) & 0xff;
	out[o++] = sps.length & 0xff;
	out.set(sps, o);
	o += sps.length;
	out[o++] = 1; // numOfPictureParameterSets
	out[o++] = (pps.length >>> 8) & 0xff;
	out[o++] = pps.length & 0xff;
	out.set(pps, o);
	return out;
}

/** Length-prefixes each NAL unit with a 4-byte big-endian length (AVCC sample). */
function toAvccSample(nalus: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const n of nalus) total += 4 + n.length;
	const out = new Uint8Array(total);
	let o = 0;
	for (const n of nalus) {
		out[o++] = (n.length >>> 24) & 0xff;
		out[o++] = (n.length >>> 16) & 0xff;
		out[o++] = (n.length >>> 8) & 0xff;
		out[o++] = n.length & 0xff;
		out.set(n, o);
		o += n.length;
	}
	return out;
}
