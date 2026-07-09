import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { TimelineProject, TimelineSample } from './types';

const ZOOM_POLL_MS = 100;

/**
 * Captures board state over time for timeline replay.
 *
 * Samples are taken on a fixed `requestAnimationFrame` clock *while a drag is
 * active* (player/official move or stage pan), rather than only on each
 * `dragmove` event. Pointer events fire irregularly (and are coalesced on
 * touch), so tying samples to them yields sparse, unevenly-spaced waypoints
 * that interpolate as choppy motion. Driving capture from the display refresh
 * instead guarantees dense, evenly-spaced samples (~60fps) during motion while
 * staying compact when the board is idle. Zoom has no drag lifecycle, so it is
 * still polled.
 *
 * All Konva drag events bubble to the stage, so a single listener there catches
 * every interaction.
 */
export class TimelineRecorder {
	private game: KonvaGame;
	private samples: TimelineSample[] = [];
	private startTime = 0;
	private running = false;

	/** Number of in-flight drags; gates the fixed-rate capture loop. */
	private activeDrags = 0;
	private rafId: number | null = null;

	private zoomPoll: ReturnType<typeof setInterval> | null = null;
	private lastZoom = 0;

	constructor(game: KonvaGame) {
		this.game = game;
	}

	start(): void {
		this.samples = [];
		this.running = true;
		this.activeDrags = 0;
		this.startTime = performance.now();

		const stage = this.game.getStage();
		this.lastZoom = stage.scaleX();

		stage.on('dragstart', this.handleDragStart);
		stage.on('dragend', this.handleDragEnd);

		this.zoomPoll = setInterval(() => {
			if (!this.running) return;
			const zoom = this.game.getStage().scaleX();
			if (zoom !== this.lastZoom) {
				this.lastZoom = zoom;
				this.pushSample();
			}
		}, ZOOM_POLL_MS);

		// Initial sample at t=0.
		this.pushSample();
	}

	private handleDragStart = (): void => {
		if (!this.running) return;
		this.activeDrags++;
		if (this.activeDrags === 1) this.startFrameLoop();
	};

	private handleDragEnd = (): void => {
		if (!this.running) return;
		this.activeDrags = Math.max(0, this.activeDrags - 1);
		// Capture the exact resting position.
		this.pushSample();
		if (this.activeDrags === 0) this.stopFrameLoop();
	};

	private startFrameLoop(): void {
		const tick = (): void => {
			if (!this.running || this.activeDrags <= 0) {
				this.rafId = null;
				return;
			}
			this.pushSample();
			this.rafId = requestAnimationFrame(tick);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	private stopFrameLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private pushSample(): void {
		if (!this.running) return;
		const t = performance.now() - this.startTime;
		this.samples.push({ t, ...this.game.getSnapshot() });
	}

	stop(): { project: TimelineProject; durationMs: number } {
		this.running = false;
		this.stopFrameLoop();

		const stage = this.game.getStage();
		stage.off('dragstart', this.handleDragStart);
		stage.off('dragend', this.handleDragEnd);

		if (this.zoomPoll !== null) {
			clearInterval(this.zoomPoll);
			this.zoomPoll = null;
		}

		const durationMs = this.samples.length ? this.samples[this.samples.length - 1].t : 0;
		return {
			project: {
				version: 1,
				createdAt: new Date().toISOString(),
				durationMs,
				samples: this.samples
			},
			durationMs
		};
	}
}
