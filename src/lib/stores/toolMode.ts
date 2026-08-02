import { writable } from 'svelte/store';

export type DrawTool =
	| 'select'
	| 'hand' // dedicated canvas panning tool
	| 'drawPath' // freehand movement path for the selected entity
	| 'pen' // freehand stroke annotation
	| 'arrow' // straight arrow (two taps / drag)
	| 'zone' // freehand closed blob
	| 'label' // tap to place a text label (prompt for text)
	| 'gap' // two-point gap marker (drag or two taps)
	| 'erase'; // tap an annotation to delete it

export const toolMode = writable<DrawTool>('select');

/** Whether `t` lays down an annotation/shape on the canvas. `select` and
 * `hand` are view tools and `erase` is a destructive tool — none draw. */
export const isDrawingTool = (t: DrawTool): boolean =>
	t !== 'select' && t !== 'hand' && t !== 'erase';
