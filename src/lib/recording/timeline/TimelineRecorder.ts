import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { TimelineProject, TimelineSample, Snapshot } from './types';

/**
 * Epsilon for snapshot comparison. Positions closer than this (in pixels) are
 * considered identical. Prevents floating-point noise from generating spurious
 * samples during idle periods.
 */
const POSITION_EPSILON = 0.5;
const VIEW_EPSILON = 0.001;

/**
 * Minimum idle duration (ms) before a hold anchor is required. If motion stops
 * for longer than this, an anchor sample is inserted at the end of the idle
 * span so replay holds the board steady instead of slowly drifting.
 */
const HOLD_ANCHOR_THRESHOLD_MS = 100;

/**
 * Captures board state over time for timeline replay.
 *
 * Samples are taken on a continuous `requestAnimationFrame` clock while
 * recording, comparing each frame's snapshot against the last pushed sample.
 * A sample is pushed only when the board actually changes (positions or view
 * differ beyond epsilon), so idle periods generate no samples. When motion
 * resumes after an idle span longer than {@link HOLD_ANCHOR_THRESHOLD_MS}, a
 * hold anchor is inserted first so replay holds the board steady during the
 * idle period instead of slowly drifting.
 *
 * This captures all board motion: drags, authored playback, step navigation,
 * tweens, pan/zoom — any change that affects `getSnapshot()`.
 */
export class TimelineRecorder {
	private game: KonvaGame;
	private samples: TimelineSample[] = [];
	private startTime = 0;
	private running = false;

	/** Capture-time viewport size, frozen at record start (canonical). */
	private source: { w: number; h: number } = { w: 0, h: 0 };

	private rafId: number | null = null;
	private lastSnapshot: TimelineSample | null = null;

	constructor(game: KonvaGame) {
		this.game = game;
	}

	start(): void {
		this.samples = [];
		this.running = true;
		this.startTime = performance.now();

		const stage = this.game.getStage();
		// Freeze the source dims once at record start so a mid-record resize
		// can't corrupt the canonical capture dimensions.
		this.source = { w: stage.width(), h: stage.height() };

		// Initial sample at t=0.
		const initial = this.game.getSnapshot();
		this.lastSnapshot = { t: 0, ...initial };
		this.samples.push(this.lastSnapshot);

		this.startFrameLoop();
	}

	private startFrameLoop(): void {
		const tick = (): void => {
			if (!this.running) {
				this.rafId = null;
				return;
			}
			this.tryPushSample();
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

	/**
	 * Compares the current snapshot against the last pushed sample. If they
	 * differ beyond epsilon, pushes a new sample. If the idle gap is large,
	 * inserts a hold anchor first so replay holds the board steady.
	 */
	private tryPushSample(): void {
		if (!this.running || !this.lastSnapshot) return;
		const now = performance.now();
		const t = now - this.startTime;
		const current = this.game.getSnapshot();

		if (!this.hasChanged(this.lastSnapshot, current)) return;

		// Motion detected. If the idle gap is large, insert a hold anchor at
		// the end of the idle span so replay holds the board steady.
		const idleGap = t - this.lastSnapshot.t;
		if (idleGap > HOLD_ANCHOR_THRESHOLD_MS) {
			// Hold anchor: duplicate the last snapshot at (t - epsilon) so
			// replay interpolates from the anchor to the new sample, holding
			// the board steady during the idle period.
			const anchor = { ...this.lastSnapshot, t: t - 1 };
			this.samples.push(anchor);
		}

		const sample = { t, ...current };
		this.lastSnapshot = sample;
		this.samples.push(sample);
	}

	/**
	 * Compares two snapshots for equality within epsilon. Returns true if any
	 * position or view value differs beyond the threshold.
	 */
	private hasChanged(a: TimelineSample, b: Snapshot): boolean {
		// Compare view (zoom, pan).
		if (Math.abs(a.view.zoom - b.view.zoom) > VIEW_EPSILON) return true;
		if (Math.abs(a.view.relativeX - b.view.relativeX) > VIEW_EPSILON) return true;
		if (Math.abs(a.view.relativeY - b.view.relativeY) > VIEW_EPSILON) return true;

		// Compare team players by id.
		if (a.teamPlayers.length !== b.teamPlayers.length) return true;
		const bById = new Map(b.teamPlayers.map((p) => [p.id, p]));
		for (const pa of a.teamPlayers) {
			const pb = bById.get(pa.id);
			if (!pb) return true;
			if (Math.abs(pa.relative.x - pb.relative.x) > POSITION_EPSILON) return true;
			if (Math.abs(pa.relative.y - pb.relative.y) > POSITION_EPSILON) return true;
		}

		// Compare skating officials by id.
		if (a.skatingOfficials.length !== b.skatingOfficials.length) return true;
		const bOfficialsById = new Map(b.skatingOfficials.map((p) => [p.id, p]));
		for (const pa of a.skatingOfficials) {
			const pb = bOfficialsById.get(pa.id);
			if (!pb) return true;
			if (Math.abs(pa.relative.x - pb.relative.x) > POSITION_EPSILON) return true;
			if (Math.abs(pa.relative.y - pb.relative.y) > POSITION_EPSILON) return true;
		}

		return false;
	}

	stop(): { project: TimelineProject; durationMs: number } {
		this.running = false;
		this.stopFrameLoop();

		// Push a final sample at wall-clock end so the recording captures any
		// trailing motion or narration.
		const now = performance.now();
		const t = now - this.startTime;
		const finalSnapshot = this.game.getSnapshot();
		if (this.lastSnapshot) {
			if (!this.hasChanged(this.lastSnapshot, finalSnapshot)) {
				// No change since last sample; just update the timestamp.
				this.lastSnapshot.t = t;
			} else {
				// Motion detected; push a new sample.
				const sample = { t, ...finalSnapshot };
				this.lastSnapshot = sample;
				this.samples.push(sample);
			}
		}
		// durationMs is wall-clock time, not last-motion time, so trailing
		// narration after the last movement is inside the movement timeline.
		const durationMs = t;
		return {
			project: {
				version: 1,
				createdAt: new Date().toISOString(),
				durationMs,
				samples: this.samples,
				source: this.source
			},
			durationMs
		};
	}
}
