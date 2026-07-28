import { boardDoc } from './store';
import type { Entity } from './types';

export interface Pose {
	S: number;
	u: number;
	heading: number;
}

function poseOf(entity: Entity): Pose {
	return { S: entity.S, u: entity.u, heading: entity.heading };
}

/**
 * Single source of truth for "where is entity X right now", reconciling the
 * committed document (persisted, undoable) with an in-progress gesture's
 * uncommitted motion (a drag, including any collision-nudged neighbours).
 *
 * Two tiers:
 *  - committed: `BoardDoc.entities` — immutable, patched via `boardDoc.applyEdit`,
 *    undoable. This is what persists and what `syncFromDocument` renders.
 *  - live: a plain mutable Map, touched at high frequency (every dragmove /
 *    collision), NOT reactive and NOT in history. Deliberately not a Svelte
 *    store: a gesture can update several entities dozens of times a second,
 *    and routing that through `applyEdit`/`writable.set` would thrash undo
 *    history and reactivity for motion that is transient by definition.
 *
 * `effective()` / `effectiveAll()` are the ONLY accessors every consumer
 * (renderer, pack manager, recorder) should use — this removes the need for
 * any `isDragging` branch scattered across call sites: during a gesture they
 * transparently see the live pose; at rest they see the committed one.
 */
export class PoseStore {
	private live = new Map<string, Pose>();

	/** True while a gesture has uncommitted live poses. */
	get isLive(): boolean {
		return this.live.size > 0;
	}

	/** Ids touched by the in-progress gesture, in touch order. */
	touchedIds(): string[] {
		return [...this.live.keys()];
	}

	/** Effective pose for one entity: live override if present, else committed. */
	effective(id: string): Pose | undefined {
		const l = this.live.get(id);
		if (l) return l;
		const entity = boardDoc.current.entities.find((e) => e.id === id);
		return entity ? poseOf(entity) : undefined;
	}

	/** Effective pose for every entity currently in the document. */
	effectiveAll(): Array<{ entity: Entity; pose: Pose }> {
		return boardDoc.current.entities.map((entity) => ({
			entity,
			pose: this.live.get(entity.id) ?? poseOf(entity)
		}));
	}

	/**
	 * In-place update of one entity's live (uncommitted) pose. No document
	 * write, no history entry, no Svelte reactivity — safe to call every frame.
	 * Merges onto the current effective pose so a partial update (e.g. just
	 * S/u from a position drag) preserves fields it doesn't touch (heading).
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
			!Number.isFinite(merged.S) ||
			!Number.isFinite(merged.u) ||
			!Number.isFinite(merged.heading)
		) {
			return;
		}
		this.live.set(id, merged);
	}

	/** Discards all live overrides without writing them to the document. */
	abortGesture(): void {
		this.live.clear();
	}

	/**
	 * Writes every live-overridden pose to the document in a single
	 * `applyEdit` — one undo step for the whole gesture, including any
	 * collision-nudged neighbours the user never directly touched — then
	 * clears the live tier so subsequent reads fall through to committed.
	 */
	commitGesture(label: string): boolean {
		if (this.live.size === 0) return false;
		const poses = this.live;
		const changed = boardDoc.applyEdit((draft) => {
			for (const [id, pose] of poses) {
				// Defensive: skip any pose that slipped through as non-finite,
				// so a numeric bug elsewhere can never corrupt the document.
				if (
					!Number.isFinite(pose.S) ||
					!Number.isFinite(pose.u) ||
					!Number.isFinite(pose.heading)
				) {
					continue;
				}
				const entity = draft.entities.find((e) => e.id === id);
				if (entity) {
					entity.S = pose.S;
					entity.u = pose.u;
					entity.heading = pose.heading;
				}
			}
		}, label);
		this.live.clear();
		return changed;
	}
}

export const poseStore = new PoseStore();
