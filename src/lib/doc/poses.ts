import { boardDoc } from './store';
import type { Entity, HeadingMode, WorldPoint } from './types';

export interface Pose {
	x: number;
	y: number;
	heading: number;
}

export type CommitGestureOptions = {
	setManualHeading?: boolean;
	/** Direction-control mode to record on the touched entities. */
	headingMode?: HeadingMode;
	/** Relative offset (radians from tangent) for `'relative'` mode. */
	headingDelta?: number;
	/** Fixed world look-at point (metres) for `'locked'` mode. */
	lookAt?: WorldPoint;
	/** When true, clear any authored heading mode (back to pure auto). */
	clearHeadingMode?: boolean;
};

function poseOf(entity: Entity): Pose {
	return { x: entity.x, y: entity.y, heading: entity.heading };
}

/**
 * Applies the heading-mode portion of {@link CommitGestureOptions} to an entity
 * or step pose (both carry the same optional mode fields). Shared by the
 * default and authoring commit paths so a rotation/lock gesture writes the mode
 * identically to the board entity and the active step's pose.
 */
export function applyHeadingModeOpts(
	target: { headingMode?: HeadingMode; headingDelta?: number; lookAt?: WorldPoint },
	opts?: CommitGestureOptions
): void {
	if (!opts) return;
	if (opts.clearHeadingMode) {
		target.headingMode = undefined;
		target.headingDelta = undefined;
		target.lookAt = undefined;
		return;
	}
	if (opts.headingMode) {
		target.headingMode = opts.headingMode;
	}
	if (opts.headingDelta !== undefined) {
		target.headingDelta = opts.headingDelta;
	}
	if (opts.lookAt) {
		target.lookAt = { ...opts.lookAt };
	}
}

/**
 * Single source of truth for "where is entity X right now", reconciling the
 * committed document (persisted, undoable) with an in-progress gesture's
 * uncommitted motion (a drag, including any collision-nudged neighbours) and
 * replay/export overrides (sample poses from a recording).
 *
 * Three tiers (in precedence order):
 *  - committed: `BoardDoc.entities` — immutable, patched via `boardDoc.applyEdit`,
 *    undoable. This is what persists and what `syncFromDocument` renders.
 *  - live: a plain mutable Map, touched at high frequency (every dragmove /
 *    collision), NOT reactive and NOT in history. Deliberately not a Svelte
 *    store: a gesture can update several entities dozens of times a second,
 *    and routing that through `applyEdit`/`writable.set` would thrash undo
 *    history and reactivity for motion that is transient by definition.
 *  - override: replay/export sample poses. Unlike live, overrides can contain
 *    ids not in the document (foreign rosters from loaded recordings). Used
 *    by `determinePack()` and `getSnapshot()` so replay visuals match what is
 *    rendered.
 *
 * `effective()` / `effectiveAll()` are the ONLY accessors every consumer
 * (renderer, pack manager, recorder) should use — this removes the need for
 * any `isDragging` branch scattered across call sites: during a gesture they
 * transparently see the live pose; during replay they see the override; at
 * rest they see the committed one.
 */
export class PoseStore {
	private live = new Map<string, Pose>();
	private overrides = new Map<string, Pose>();
	/**
	 * Optional override for how a committed gesture is written to the
	 * document. When set (e.g. by the authoring layer while editing an
	 * authored step), the gesture's poses are written through it INSTEAD of
	 * the default `applyEdit`, so the active step can be synced to the new
	 * poses within the SAME undo entry — one undo reverts the whole gesture
	 * on the board and the step together. Null restores the default path.
	 */
	private commitHook:
		((poses: Map<string, Pose>, label: string, opts?: CommitGestureOptions) => boolean) | null =
		null;

	/** Installs/removes the commit override (see {@link commitHook}). */
	setCommitHook(
		hook: ((poses: Map<string, Pose>, label: string, opts?: CommitGestureOptions) => boolean) | null
	): void {
		this.commitHook = hook;
	}

	/** True while a gesture has uncommitted live poses. */
	get isLive(): boolean {
		return this.live.size > 0;
	}

	/** Ids touched by the in-progress gesture, in touch order. */
	touchedIds(): string[] {
		return [...this.live.keys()];
	}

	/** Effective pose for one entity: live → override → committed. */
	effective(id: string): Pose | undefined {
		const l = this.live.get(id);
		if (l) return l;
		const o = this.overrides.get(id);
		if (o) return o;
		const entity = boardDoc.current.entities.find((e) => e.id === id);
		return entity ? poseOf(entity) : undefined;
	}

	/** Effective pose for every entity currently in the document. */
	effectiveAll(): Array<{ entity: Entity; pose: Pose }> {
		return boardDoc.current.entities.map((entity) => ({
			entity,
			pose: this.live.get(entity.id) ?? this.overrides.get(entity.id) ?? poseOf(entity)
		}));
	}

	/**
	 * In-place update of one entity's live (uncommitted) pose. No document
	 * write, no history entry, no Svelte reactivity — safe to call every frame.
	 * Merges onto the current effective pose so a partial update (e.g. just
	 * x/y from a position drag) preserves fields it doesn't touch (heading).
	 */
	setLive(id: string, pose: Partial<Pose>): void {
		const current = this.effective(id);
		if (!current) return;
		const merged = { ...current, ...pose };
		// Never let a non-finite value into the live tier: it would propagate
		// to the document on commit, and from there into persisted state,
		// bricking the board on reload (JSON.stringify turns NaN into null,
		// which reload then stacks at the origin).
		if (
			!Number.isFinite(merged.x) ||
			!Number.isFinite(merged.y) ||
			!Number.isFinite(merged.heading)
		) {
			return;
		}
		this.live.set(id, merged);
	}

	/**
	 * Sets an override pose for one entity. Unlike setLive, this accepts ids
	 * not in the document (foreign rosters from loaded recordings). Used by
	 * replay/export to publish sample poses so determinePack sees them.
	 */
	setOverride(id: string, pose: Pose): void {
		if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.heading)) {
			return;
		}
		this.overrides.set(id, pose);
	}

	/**
	 * Bulk-sets override poses for multiple entities. Replaces any existing
	 * overrides for those ids; other ids are unaffected.
	 */
	setOverrides(poses: Iterable<[string, Pose]>): void {
		for (const [id, pose] of poses) {
			this.setOverride(id, pose);
		}
	}

	/** Discards all live overrides without writing them to the document. */
	abortGesture(): void {
		this.live.clear();
	}

	/**
	 * Discards all override poses (replay/export). Called on replay exit and
	 * board reset so the override tier doesn't leak into editing.
	 */
	clearOverrides(): void {
		this.overrides.clear();
	}

	/** True while the override tier has poses (replay/export active). */
	get hasOverrides(): boolean {
		return this.overrides.size > 0;
	}

	/**
	 * Writes every live-overridden pose to the document in a single
	 * `applyEdit` — one undo step for the whole gesture, including any
	 * collision-nudged neighbours the user never directly touched — then
	 * clears the live tier so subsequent reads fall through to committed.
	 */
	commitGesture(label: string, opts?: CommitGestureOptions): boolean {
		if (this.live.size === 0) return false;
		const poses = this.live;
		const changed =
			this.commitHook !== null
				? this.commitHook(poses, label, opts)
				: this.defaultCommit(poses, label, opts);
		this.live.clear();
		return changed;
	}

	private defaultCommit(
		poses: Map<string, Pose>,
		label: string,
		opts?: CommitGestureOptions
	): boolean {
		return boardDoc.applyEdit((draft) => {
			for (const [id, pose] of poses) {
				// Defensive: skip any pose that slipped through as non-finite,
				// so a numeric bug elsewhere can never corrupt the document.
				if (
					!Number.isFinite(pose.x) ||
					!Number.isFinite(pose.y) ||
					!Number.isFinite(pose.heading)
				) {
					continue;
				}
				const entity = draft.entities.find((e) => e.id === id);
				if (entity) {
					entity.x = pose.x;
					entity.y = pose.y;
					entity.heading = pose.heading;
					if (opts?.setManualHeading) {
						entity.manualHeading = true;
					}
					applyHeadingModeOpts(entity, opts);
				}
			}
		}, label);
	}
}

export const poseStore = new PoseStore();
