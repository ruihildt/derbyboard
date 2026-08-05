import { writable } from 'svelte/store';

export type DrawTool =
	| 'select'
	| 'hand' // dedicated canvas panning tool
	| 'drawPath' // freehand movement path for the selected entity
	| 'pen' // freehand stroke annotation
	| 'arrow' // straight arrow (two taps / drag)
	| 'zone' // freehand closed blob
	| 'label' // tap to place a text label, then type it inline on the canvas
	| 'gap' // two-point gap marker (drag or two taps)
	| 'erase' // tap an annotation to delete it
	| 'video' // arms video recording
	| 'screenshot'; // arms screenshot capture

export const toolMode = writable<DrawTool>('select');

/** Capture tools — always available regardless of experience, and mutually
 * exclusive with the drawing/view tools (only one tool armed at a time). */
export const CAPTURE_TOOLS: DrawTool[] = ['video', 'screenshot'];

export const isCaptureTool = (t: DrawTool): boolean => t === 'video' || t === 'screenshot';

/** Whether `t` lays down an annotation/shape on the canvas. `select` and
 * `hand` are view tools, `erase` is a destructive tool, and the capture tools
 * don't draw — none of these lay annotations. */
export const isDrawingTool = (t: DrawTool): boolean =>
	t !== 'select' && t !== 'hand' && t !== 'erase' && !isCaptureTool(t);
