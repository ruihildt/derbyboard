import { derived } from 'svelte/store';
import { toolMode, isCaptureTool } from '$lib/stores/toolMode';

/** Capture-region interaction mode, derived from the armed tool:
 * - 'edit' (resize handles hot) while a capture tool (video/screenshot) is armed,
 * - 'board' (pass-through) for every other tool.
 *
 * There is no manual toggle: resizing is enabled solely by arming a capture
 * tool and disabled automatically when switching to a drawing/view tool. */
export type RegionMode = 'board' | 'edit';

export const regionMode = derived(toolMode, ($toolMode): RegionMode =>
	isCaptureTool($toolMode) ? 'edit' : 'board'
);
