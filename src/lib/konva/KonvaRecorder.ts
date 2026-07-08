import type Konva from 'konva';
import fixWebmDuration from 'fix-webm-duration';
import type { Watermark } from './Watermark';
import {
	BITRATE_BY_QUALITY,
	pickRecorderCodec,
	type Quality,
	type RecorderCodec
} from '$lib/utils/codec';
import { outputDimensions, type AspectRatio, type OutputSpec } from '$lib/utils/recording';
import type { EngineKind } from '$lib/utils/recording';
import type { Region, RecorderEngine } from './recorder/types';
import { CompositeEngine } from './recorder/CompositeEngine';
import { CloneTransformEngine } from './recorder/CloneTransformEngine';

const FRAME_RATE = 30;

interface KonvaRecorderConfig {
	stage: Konva.Stage;
	watermark?: Watermark;
}

/**
 * KonvaRecorder captures video of a Konva stage.
 *
 * Each frame is rendered into a persistent capture canvas by a swappable
 * {@link RecorderEngine}; `captureStream` reads from that canvas. Settings
 * (quality, aspect ratio, region) are applied via setters before recording and are
 * frozen for the duration of a take.
 */
export class KonvaRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private isRecording = false;
	private audioStream: MediaStream | null = null;

	private recordingStartTime = 0;

	private readonly outputCanvas: HTMLCanvasElement;
	private readonly outputCtx: CanvasRenderingContext2D;
	private rafId: number | null = null;
	private lastFrameTime = 0;

	private quality: Quality = '1080p';
	private ratio: AspectRatio = '16:9';
	private region: Region | null = null;
	private codec: RecorderCodec = pickRecorderCodec();
	private output: OutputSpec = { w: 0, h: 0 };

	private engine: RecorderEngine = new CompositeEngine();
	private engineKind: EngineKind = 'composite';

	constructor(private config: KonvaRecorderConfig) {
		this.outputCanvas = document.createElement('canvas');
		this.outputCtx = this.outputCanvas.getContext('2d')!;
		// Keep the canvas in the DOM (rendered but off-screen) so captureStream reliably
		// samples painted frames — detached canvases may not be captured in some browsers.
		this.outputCanvas.style.cssText =
			'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
		document.body.appendChild(this.outputCanvas);
	}

	/** Audio track to mux into the recording. Must be called before startRecording(). */
	setAudioStream(stream: MediaStream | null) {
		this.audioStream = stream;
	}

	/** Target quality tier (controls bitrate and, in region mode, resolution). */
	setQuality(quality: Quality) {
		if (!this.isRecording) this.quality = quality;
	}

	/** Aspect ratio for region mode. */
	setRatio(ratio: AspectRatio) {
		if (!this.isRecording) this.ratio = ratio;
	}

	/** Selection in viewport CSS pixels, or null for full-frame. Frozen during a take. */
	setRegion(region: Region | null) {
		if (!this.isRecording) this.region = region;
	}

	/** Rendering engine. Frozen during a take. */
	setEngine(kind: EngineKind) {
		if (this.isRecording) return;
		const resolved = kind === 'clone' ? 'clone' : 'composite';
		if (this.engineKind === resolved) return;
		this.engine.destroy();
		this.engine = resolved === 'clone' ? new CloneTransformEngine() : new CompositeEngine();
		this.engineKind = resolved;
	}

	/**
	 * Initiates video recording of the canvas.
	 */
	startRecording() {
		this.recordedChunks = [];
		this.recordingStartTime = Date.now();
		this.codec = pickRecorderCodec();

		// Region mode renders at the quality×ratio target; full-frame uses the viewport.
		this.output = this.region
			? outputDimensions(this.quality, this.ratio)
			: {
					w: Math.max(1, Math.round(this.config.stage.width())),
					h: Math.max(1, Math.round(this.config.stage.height()))
				};
		this.outputCanvas.width = this.output.w;
		this.outputCanvas.height = this.output.h;

		this.engine.prepare(this.config.stage, this.output, this.region);

		const videoStream = this.outputCanvas.captureStream(FRAME_RATE);

		let combinedStream: MediaStream;
		if (this.audioStream) {
			combinedStream = new MediaStream([
				...videoStream.getVideoTracks(),
				...this.audioStream.getAudioTracks()
			]);
		} else {
			combinedStream = videoStream;
		}

		const recorderOptions: MediaRecorderOptions = {
			videoBitsPerSecond: BITRATE_BY_QUALITY[this.quality]
		};
		if (this.codec.mimeType) {
			recorderOptions.mimeType = this.codec.mimeType;
		}
		this.mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);

		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				this.recordedChunks.push(event.data);
			}
		};
		this.mediaRecorder.onerror = (event) => {
			console.error('[KonvaRecorder] MediaRecorder error', event);
		};

		this.mediaRecorder.start(1000); // Collect data every second
		this.isRecording = true;
		this.lastFrameTime = 0;
		this.rafId = requestAnimationFrame(this.renderFrame);
	}

	private renderFrame = (now: number) => {
		if (!this.isRecording) return;

		// Throttle rendering to the capture frame rate to limit CPU use.
		if (now - this.lastFrameTime < 1000 / FRAME_RATE - 1) {
			this.rafId = requestAnimationFrame(this.renderFrame);
			return;
		}
		this.lastFrameTime = now;

		try {
			this.engine.renderFrame({
				stage: this.config.stage,
				ctx: this.outputCtx,
				output: this.output,
				region: this.region,
				watermark: this.config.watermark
			});
		} catch (e) {
			console.error('[KonvaRecorder] renderFrame threw', e);
		}

		this.rafId = requestAnimationFrame(this.renderFrame);
	};

	/**
	 * Stops recording and returns the final video blob.
	 *
	 * Robust against the recorder already being inactive (e.g. its stream track ended)
	 * and against `onstop` never firing: it always settles, surfacing errors instead of
	 * hanging silently.
	 */
	stopRecording(): Promise<Blob> {
		return new Promise((resolve, reject) => {
			if (!this.mediaRecorder) {
				resolve(new Blob([]));
				return;
			}

			if (this.rafId !== null) {
				cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}

			let settled = false;
			const timeout = window.setTimeout(() => {
				if (!settled) {
					console.warn('[KonvaRecorder] onstop did not fire; finalizing via timeout');
					finalize();
				}
			}, 3000);

			const finalize = async () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeout);
				try {
					const raw = new Blob(this.recordedChunks, { type: this.codec.blobType });
					let blob = raw;
					if (this.codec.container === 'webm' && raw.size > 0) {
						try {
							blob = await fixWebmDuration(raw, Date.now() - this.recordingStartTime);
						} catch (e) {
							console.warn('[KonvaRecorder] fixWebmDuration failed; using raw blob', e);
							blob = raw;
						}
					}
					this.recordedChunks = [];
					this.isRecording = false;
					resolve(blob);
				} catch (e) {
					console.error('[KonvaRecorder] finalize failed', e);
					this.isRecording = false;
					reject(e);
				}
			};

			this.mediaRecorder.onstop = () => finalize();

			try {
				if (this.mediaRecorder.state === 'inactive') {
					finalize();
				} else {
					this.mediaRecorder.stop();
				}
			} catch (e) {
				console.error('[KonvaRecorder] mediaRecorder.stop() threw', e);
				finalize();
			}
		});
	}

	/**
	 * Cleanup method to ensure proper resource disposal.
	 */
	destroy() {
		if (this.isRecording) {
			this.stopRecording();
		}
		if (this.audioStream) {
			this.audioStream.getTracks().forEach((track) => track.stop());
			this.audioStream = null;
		}
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.engine.destroy();
		this.outputCanvas.remove();
	}
}
