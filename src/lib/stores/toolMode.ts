import { writable } from 'svelte/store';

export type DrawTool =
	| 'select'
	| 'drawPath' // freehand movement path for the selected entity
	| 'pen' // freehand stroke annotation
	| 'arrow' // straight arrow (two taps / drag)
	| 'zone' // freehand closed blob
	| 'label' // tap to place a text label (prompt for text)
	| 'gap'; // two-point gap marker (drag or two taps)

export const toolMode = writable<DrawTool>('select');

export const isDrawingTool = (t: DrawTool): boolean => t !== 'select';
