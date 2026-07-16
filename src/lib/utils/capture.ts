import { ASPECT_RATIO, type AspectRatio } from './recording';

/**
 * Unified capture zone format, shared by the screenshot and video menus.
 * - `custom`: free-form selection rect (no aspect lock)
 * - `16:9` / `4:3` / `1:1`: aspect-locked selection rect
 * - `full`: the whole screen (no selection rect)
 */
export type CaptureFormat = 'custom' | '16:9' | '4:3' | '1:1' | 'full';

/** Selector option order, shared by both menus. */
export const CAPTURE_FORMATS: CaptureFormat[] = ['full', 'custom', '4:3', '16:9', '1:1'];

export const FORMAT_LABELS: Record<CaptureFormat, string> = {
	custom: 'Custom region',
	full: 'Full page',
	'4:3': '4:3',
	'16:9': '16:9',
	'1:1': '1:1'
};

/** Compact labels for the narrow capture-format dropdown. */
export const FORMAT_LABELS_SHORT: Record<CaptureFormat, string> = {
	custom: 'Custom',
	full: 'Full',
	'4:3': '4:3',
	'16:9': '16:9',
	'1:1': '1:1'
};

/** Selection rect as viewport-relative fractions (resolution-independent). */
export interface CaptureZone {
	xFrac: number; // left / viewport width
	yFrac: number; // top / viewport height
	wFrac: number; // width / viewport width
	hFrac: number; // height / viewport height
}

/** True for the aspect-locked ratio formats. */
export function isRatioFormat(format: CaptureFormat): format is AspectRatio {
	return format === '16:9' || format === '4:3' || format === '1:1';
}

/** Aspect ratio for a format, or `null` for free-form / full screen. */
export function formatRatio(format: CaptureFormat): number | null {
	return isRatioFormat(format) ? ASPECT_RATIO[format] : null;
}
