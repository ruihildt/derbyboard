import Konva from 'konva';
import fixWebmDuration from 'fix-webm-duration';

/**
 * KonvaRecorder handles video recording of Konva canvas animations
 * Supports recording specific areas or full canvas
 */
export class KonvaRecorder {
	// Core recording components
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private isRecording = false;

	// Time tracking for recording duration
	private recordingStartTime: number = 0;
	private elapsedTime: number = 0;
	private timeInterval: number | null = null;

	// Konva specific elements
	private animation: Konva.Animation;
	private layer: Konva.Layer;

	/**
	 * @param stage - The Konva stage to record
	 * @param recordingArea - Optional recording bounds {x, y, width, height}
	 */
	constructor(
		private stage: Konva.Stage,
		scalingFactor: number = 2
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
	 * Initiates video recording of the canvas
	 * Sets up MediaRecorder with optimal codec support
	 */
	startRecording() {
		// Initialize recording time tracking
		this.recordingStartTime = Date.now();
		this.timeInterval = window.setInterval(() => {
			this.elapsedTime = Date.now() - this.recordingStartTime;
		}, 1000);

		const canvas = this.layer.getNativeCanvasElement();

		// Setup canvas stream with 30fps
		const stream = canvas.captureStream(30);
		// Define supported video formats in order of preference
		const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
		const supportedMimeType = mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));

		// Initialize MediaRecorder with supported format
		this.mediaRecorder = new MediaRecorder(stream, {
			mimeType: supportedMimeType || 'video/webm'
		});

		// Collect video data chunks
		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				this.recordedChunks = [...this.recordedChunks, event.data];
			}
		};

		this.mediaRecorder.start();
		this.isRecording = true;
		this.animation.start();
	}

	/**
	 * Stops recording and returns the final video blob
	 * Fixes WebM duration metadata for accurate playback
	 */
	stopRecording(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.mediaRecorder) return;

			// Clean up time tracking
			if (this.timeInterval) {
				clearInterval(this.timeInterval);
				this.timeInterval = null;
			}

			this.mediaRecorder.onstop = async () => {
				// Create final video blob and fix duration metadata
				const blob = new Blob(this.recordedChunks, {
					type: 'video/webm'
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
		this.animation.stop();
	}
}
