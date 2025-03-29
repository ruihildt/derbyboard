import Konva from 'konva';
import fixWebmDuration from 'fix-webm-duration';

/**
 * KonvaRecorder handles video recording of Konva canvas animations
 * Supports recording specific areas or full canvas with optional audio
 */
export class KonvaRecorder {
	// Core recording components
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private isRecording = false;
	private audioStream: MediaStream | null = null;

	// Time tracking for recording duration
	private recordingStartTime: number = 0;
	private elapsedTime: number = 0;
	private timeInterval: number | null = null;

	// Konva specific elements
	private animation: Konva.Animation;
	private layer: Konva.Layer;

	/**
	 * @param stage - The Konva stage to record
	 * @param scalingFactor - The factor to scale the stage for recording
	 */
	constructor(
		private stage: Konva.Stage,
		scalingFactor: number = 1.5
	) {
		// Create a high-res stage for recording
		const recordingStage = new Konva.Stage({
			container: document.createElement('div'),
			width: stage.width() * scalingFactor,
			height: stage.height() * scalingFactor,
			scale: stage.scale(),
			position: {
				x: stage.position().x * scalingFactor,
				y: stage.position().y * scalingFactor
			}
		});

		// Clone and scale all layers for the recording stage
		stage.getLayers().forEach((originalLayer) => {
			const recordingLayer = originalLayer.clone();
			recordingLayer.children?.forEach((child) => {
				// Scale position
				child.x(child.x() * scalingFactor);
				child.y(child.y() * scalingFactor);

				// Scale visual properties
				if (child instanceof Konva.Circle) {
					child.radius(child.radius() * scalingFactor);
					child.strokeWidth(child.strokeWidth() * scalingFactor);
				}
				if (child instanceof Konva.Line || child instanceof Konva.Path) {
					child.strokeWidth(child.strokeWidth() * scalingFactor);
				}
				child.scale({ x: scalingFactor, y: scalingFactor });
			});
			recordingStage.add(recordingLayer);
		});

		// Create merged layer for recording
		const mergedLayer = new Konva.Layer();
		recordingStage.add(mergedLayer);

		this.animation = new Konva.Animation(() => {
			if (this.isRecording) {
				// Sync scale and position from display stage
				recordingStage.scale(stage.scale());
				recordingStage.position({
					x: stage.position().x * scalingFactor,
					y: stage.position().y * scalingFactor
				});

				// Sync positions from display stage to recording stage
				stage.getLayers().forEach((originalLayer, i) => {
					const recordingLayer = recordingStage.getLayers()[i];
					originalLayer.children?.forEach((child, j) => {
						const recordingChild = recordingLayer.children?.[j];
						if (recordingChild) {
							recordingChild.x(child.x() * scalingFactor);
							recordingChild.y(child.y() * scalingFactor);
							recordingChild.rotation(child.rotation());
							recordingChild.visible(child.visible());
						}
					});
				});

				// Draw the recording frame
				const ctx = mergedLayer.getContext();
				mergedLayer.clear();

				ctx.save();
				ctx.fillStyle = '#FFFFFF';
				ctx.fillRect(0, 0, recordingStage.width(), recordingStage.height());
				ctx.restore();

				recordingStage.getLayers().forEach((layer) => {
					if (layer !== mergedLayer) {
						const layerCanvas = layer.getNativeCanvasElement();
						ctx.drawImage(layerCanvas, 0, 0);
					}
				});
			}
		}, mergedLayer);

		this.layer = mergedLayer;
	}

	/**
	 * Sets the audio stream to be used for recording
	 * Must be called before startRecording()
	 */
	setAudioStream(stream: MediaStream | null) {
		this.audioStream = stream;
	}

	/**
	 * Initiates video recording of the canvas
	 * Sets up MediaRecorder with optimal codec support
	 */
	startRecording() {
		// Reset chunks from previous recordings
		this.recordedChunks = [];

		// Initialize recording time tracking
		this.recordingStartTime = Date.now();
		this.timeInterval = window.setInterval(() => {
			this.elapsedTime = Date.now() - this.recordingStartTime;
		}, 1000);

		const canvas = this.layer.getNativeCanvasElement();

		// Setup canvas stream with 30fps
		const videoStream = canvas.captureStream(30);

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

		// Initialize MediaRecorder with simple configuration like in the previous implementation
		this.mediaRecorder = new MediaRecorder(combinedStream, {
			mimeType: 'video/webm'
		});

		// Collect video data chunks
		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				this.recordedChunks.push(event.data);
			}
		};

		this.mediaRecorder.start(1000); // Collect data every second
		this.isRecording = true;
		this.animation.start();
	}

	/**
	 * Stops recording and returns the final video blob
	 * Fixes WebM duration metadata for accurate playback
	 */
	stopRecording(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.mediaRecorder) {
				resolve(new Blob([]));
				return;
			}

			// Clean up time tracking
			if (this.timeInterval) {
				clearInterval(this.timeInterval);
				this.timeInterval = null;
			}

			this.mediaRecorder.onstop = async () => {
				// Create final video blob with explicit codec information like in the working implementation
				const blob = new Blob(this.recordedChunks, {
					type: 'video/webm; codecs=vp8,opus'
				});

				const duration = Date.now() - this.recordingStartTime;
				const fixedBlob = await fixWebmDuration(blob, duration);

				// Reset recording state
				this.recordedChunks = [];
				this.isRecording = false;
				this.elapsedTime = 0;
				this.animation.stop();

				resolve(fixedBlob);
			};

			this.mediaRecorder.stop();
		});
	}

	/**
	 * Cleanup method to ensure proper resource disposal
	 */
	destroy() {
		if (this.isRecording) {
			this.stopRecording();
		}
		if (this.audioStream) {
			this.audioStream.getTracks().forEach((track) => track.stop());
			this.audioStream = null;
		}
		this.animation.stop();
	}
}
