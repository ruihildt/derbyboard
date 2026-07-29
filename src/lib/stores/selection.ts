import { writable, type Writable } from 'svelte/store';

/**
 * Runtime selection state. NOT persisted. Cleared on board rebuild /
 * replay entry / clip exit.
 */
export const selectedEntityId: Writable<string | null> = writable(null);

/**
 * Whether the direction control (rotation knob + dashed guide line) is active
 * for the selected entity. Single-click selects; double-click activates the
 * direction control. Clicking another entity or the canvas deactivates it.
 * NOT persisted.
 */
export const directionControlActive: Writable<boolean> = writable(false);
