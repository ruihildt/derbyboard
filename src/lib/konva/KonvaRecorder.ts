import type Konva from 'konva';
import fixWebmDuration from 'fix-webm-duration';
import type { Watermark } from './Watermark';
import {
	BITRATE_BY_QUALITY,
	pickRecorderCodec,
	type Quality,
	type RecorderCodec
} from '$lib/utils/codec';

const FRAME_RATE = 30;

/**
 * KonvaRecorder captures video of a Konva stage.
 *
 * Each frame re-rasterizes the live display stage via `stage.toCanvas`, so player
 * movement, pack/engagement-zone updates and pan/zoom are all captured. A previous
 * clone-based implementation only ever rendered the first frame: it relied on
 * `Konva.Animation` redrawing its merged layer, while the cloned content layers were
 * drawn once at record start and never updated.
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
	private codec: RecorderCodec = pickRecorderCodec();

	constructor(
		private stage: Konva.Stage,
		private scalingFactor: number = 1,
		private watermark?: Watermark
	) {
		this.outputCanvas = document.createElement('canvas');
		this.outputCtx = this.outputCanvas.getContext('2d')!;
	}

	/**
	 * Sets the audio stream to be used for recording.
	 * Must be called before startRecording().
	 */
	setAudioStream(stream: MediaStream | null) {
		this.audioStream = stream;
	}

	/**
	 * Sets the target quality tier (controls the recording bitrate).
	 * Must be called before startRecording().
	 */
	setQuality(quality: Quality) {
		this.quality = quality;
	}

	/**
	 * Initiates video recording of the canvas.
	 */
	startRecording() {
		this.recordedChunks = [];
		this.recordingStartTime = Date.now();

		// The output canvas is sized once per take; captureStream must read a stable size.
		this.outputCanvas.width = Math.max(1, Math.round(this.stage.width() * this.scalingFactor));
		this.outputCanvas.height = Math.max(1, Math.round(this.stage.height() * this.scalingFactor));

		const videoStream = this.outputCanvas.captureStream(FRAME_RATE);

		// Combine video and audio streams if audio is available
		let combinedStream: MediaStream;
		if (this.audioStream) {
			combinedStream = new MediaStream([
				...videoStream.getVideoTracks(),
				...this.audioStream.getAudioTracks()
			]);
		} else {
			combinedStream = videoStream;
		}

		this.codec = pickRecorderCodec();
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

	/**
	 * Renders a single frame: re-rasterizes the live stage at the recording resolution
	 * into the output canvas. Explicit bounds (origin + full stage size) capture the
	 * whole viewport at the current pan/zoom, rather than just the content bounds.
	 */
	private renderFrame = (now: number) => {
		if (!this.isRecording) return;

		// Throttle rasterization to the capture frame rate to limit CPU use.
		if (now - this.lastFrameTime < 1000 / FRAME_RATE - 1) {
			this.rafId = requestAnimationFrame(this.renderFrame);
			return;
		}
		this.lastFrameTime = now;

		const frame = this.stage.toCanvas({
			x: 0,
			y: 0,
			width: this.stage.width(),
			height: this.stage.height(),
			pixelRatio: this.scalingFactor
		});

		const { outputCtx: ctx, outputCanvas } = this;
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
		ctx.drawImage(frame, 0, 0);

		if (this.watermark) {
			this.watermark.draw(ctx, outputCanvas.width, outputCanvas.height, this.scalingFactor);
		}

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
	}
}
