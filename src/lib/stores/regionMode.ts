import { derived } from 'svelte/store';
import { toolMode } from '$lib/stores/toolMode';

/** Capture-region interaction mode, derived from the armed tool:
 * - 'edit' (resize handles hot) while the hand (pan) tool is armed,
 * - 'board' (pass-through) for every other tool.
 *
 * There is no manual toggle: resizing is enabled solely by arming the hand
 * tool (which also hosts the zone-format selector) and disabled automatically
 * when switching to any other tool. */
export type RegionMode = 'board' | 'edit';

export const regionMode = derived(toolMode, ($toolMode): RegionMode =>
	$toolMode === 'hand' ? 'edit' : 'board'
);
