import { writable, type Writable } from 'svelte/store';

/**
 * Runtime selection state. NOT persisted. Cleared on board rebuild /
 * replay entry / clip exit.
 */
export const selectedEntityId: Writable<string | null> = writable(null);

/**
 * The full set of currently selected player ids (drives the multi-select
 * halos + movement-path overlays). {@link selectedEntityId} is the single
 * "primary"/focused member of this set (rotation knob, HUD, single-drag,
 * drawPath). Kept in sync through {@link setEntitySelection}. NOT persisted.
 */
export const selectedEntityIds: Writable<string[]> = writable([]);

/**
 * Sets the entity selection set, keeping {@link selectedEntityId} (the primary
 * within the set) and {@link selectedEntityIds} in sync:
 *  - empty → primary `null`, set `[]`
 *  - one id → primary that id, set `[id]`
 *  - many → set the lot; primary is `primaryId` when given (and a member),
 *    otherwise the last id.
 *
 * Does NOT touch annotation selection or the direction control — those remain
 * the caller's concern (mutual exclusion with marks is handled at the call
 * site, e.g. selecting a mark then clearing the entity).
 */
export function setEntitySelection(ids: string[], primaryId?: string | null): void {
	const unique = Array.from(new Set(ids));
	selectedEntityIds.set(unique);
	let primary: string | null;
	if (unique.length === 0) primary = null;
	else if (primaryId != null && unique.includes(primaryId)) primary = primaryId;
	else primary = unique[unique.length - 1];
	selectedEntityId.set(primary);
}

/**
 * The currently selected annotation id, or null. Mutually exclusive with
 * {@link selectedEntityId} (one selected thing at a time): tapping a mark clears
 * the entity selection and vice-versa. NOT persisted.
 */
export const selectedAnnotationId: Writable<string | null> = writable(null);

/**
 * Whether the direction control (rotation knob + dashed guide line) is active
 * for the selected entity. Single-click selects; double-click activates the
 * direction control. Clicking another entity or the canvas deactivates it.
 * NOT persisted.
 */
export const directionControlActive: Writable<boolean> = writable(false);
