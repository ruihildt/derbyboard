import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { TimelineProject, TimelineSample, Snapshot } from './types';
import { poseStore } from '$lib/doc/poses';
import { boardDoc } from '$lib/doc/store';
import { boardSettings, type BoardSettings } from '$lib/stores/boardSettings';
import { get } from 'svelte/store';
import type { BoardDoc } from '$lib/doc/types';
import type { PathFrame } from './types';

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

	/**
	 * Dirty-check cache, refreshed whenever the full snapshot path runs.
	 * Lets idle frames prove "nothing the snapshot covers could have changed"
	 * with a handful of primitive/reference reads — the previous
	 * implementation built a full snapshot plus two lookup Maps every frame
	 * just to discover the board was idle.
	 */
	private lastPoseVersion = -1;
	private lastDocRef: BoardDoc | null = null;
	private lastView = { zoom: 0, x: 0, y: 0, w: 0, h: 0 };
	private lastPathFrameRef: PathFrame | undefined;
	private lastSettingsRef: BoardSettings | null = null;

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
		this.refreshDirtyCache();

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
		// Zero-allocation pre-check: skip the snapshot build entirely while
		// the board is provably idle (the common case during a recording).
		if (!this.boardMayHaveChanged()) return;
		// Refresh unconditionally — the epsilon comparison below anchors to
		// `lastSnapshot` (not this cache), so sub-epsilon drift still
		// accumulates correctly across frames.
		this.refreshDirtyCache();

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
	 * True only when something the snapshot covers could have changed since
	 * the last full check. A false positive costs one getSnapshot +
	 * hasChanged (which then correctly declines to push); a false negative
	 * would lose motion, so every signal the snapshot reads is covered:
	 * pose tiers (version), committed doc (reference identity — doc updates
	 * are immutable), stage view + size, and the path-frame reference.
	 */
	private boardMayHaveChanged(): boolean {
		const stage = this.game.getStage();
		if (poseStore.version !== this.lastPoseVersion) return true;
		if (boardDoc.current !== this.lastDocRef) return true;
		if (stage.scaleX() !== this.lastView.zoom) return true;
		if (stage.x() !== this.lastView.x) return true;
		if (stage.y() !== this.lastView.y) return true;
		if (stage.width() !== this.lastView.w || stage.height() !== this.lastView.h) return true;
		if (this.game.getPathFrameRef() !== this.lastPathFrameRef) return true;
		// getSnapshot() reads pathsVisible from boardSettings (immutable updates).
		if (get(boardSettings) !== this.lastSettingsRef) return true;
		return false;
	}

	private refreshDirtyCache(): void {
		const stage = this.game.getStage();
		this.lastPoseVersion = poseStore.version;
		this.lastDocRef = boardDoc.current;
		this.lastView = {
			zoom: stage.scaleX(),
			x: stage.x(),
			y: stage.y(),
			w: stage.width(),
			h: stage.height()
		};
		this.lastPathFrameRef = this.game.getPathFrameRef();
		this.lastSettingsRef = get(boardSettings);
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

		// Compare path frame (presence, entity count, selection, ghost count).
		const af = a.pathFrame;
		const bf = b.pathFrame;
		if ((af?.paths.length ?? 0) !== (bf?.paths.length ?? 0)) return true;
		if ((af?.prevPaths?.length ?? 0) !== (bf?.prevPaths?.length ?? 0)) return true;
		if ((af?.nextPaths?.length ?? 0) !== (bf?.nextPaths?.length ?? 0)) return true;
		if (af?.selectedEntityId !== bf?.selectedEntityId) return true;
		if (af && bf) {
			for (let i = 0; i < af.paths.length; i++) {
				if (af.paths[i].entityId !== bf.paths[i].entityId) return true;
				if (af.paths[i].points.length !== bf.paths[i].points.length) return true;
			}
		}

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
