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
import { ToCanvasEngine } from './recorder/ToCanvasEngine';
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

	private engine: RecorderEngine = new ToCanvasEngine();
	private engineKind: EngineKind = 'tocanvas';

	constructor(private config: KonvaRecorderConfig) {
		this.outputCanvas = document.createElement('canvas');
		this.outputCtx = this.outputCanvas.getContext('2d')!;
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
		if (this.isRecording || this.engineKind === kind) return;
		this.engine.destroy();
		this.engine = kind === 'clone' ? new CloneTransformEngine() : new ToCanvasEngine();
		this.engineKind = kind;
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

		this.engine.renderFrame({
			stage: this.config.stage,
			ctx: this.outputCtx,
			output: this.output,
			region: this.region,
			watermark: this.config.watermark,
			scalingFactor: 1
		});

		this.rafId = requestAnimationFrame(this.renderFrame);
	};

	/**
	 * Stops recording and returns the final video blob.
	 * Fixes WebM duration metadata for accurate playback.
	 */
	stopRecording(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.mediaRecorder) {
				resolve(new Blob([]));
				return;
			}

			if (this.rafId !== null) {
				cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}

			this.mediaRecorder.onstop = async () => {
				const blob = new Blob(this.recordedChunks, {
					type: this.codec.blobType
				});

				// fixWebmDuration patches WebM duration metadata; MP4 already carries it.
				const duration = Date.now() - this.recordingStartTime;
				const fixedBlob =
					this.codec.container === 'webm' ? await fixWebmDuration(blob, duration) : blob;

				this.recordedChunks = [];
				this.isRecording = false;
				resolve(fixedBlob);
			};

			this.mediaRecorder.stop();
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
	}
}
