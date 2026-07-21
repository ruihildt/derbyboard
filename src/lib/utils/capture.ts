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

/** Uniform fit transform from a capture source rect into the live viewport. */
export interface CaptureFit {
	scale: number;
	offX: number;
	offY: number;
}

/**
 * Computes a uniform scale + centering offset that fits `source` inside
 * `viewport` (`contain`) or fills it (`fill`). The offset centers the scaled
 * source, producing letterbox/pillarbox bars under `contain`.
 */
export function fitSourceToViewport(
	source: { w: number; h: number },
	viewport: { w: number; h: number },
	mode: 'contain' | 'fill' = 'contain'
): CaptureFit {
	const scale =
		mode === 'contain'
			? Math.min(viewport.w / source.w, viewport.h / source.h)
			: Math.max(viewport.w / source.w, viewport.h / source.h);
	return {
		scale,
		offX: (viewport.w - source.w * scale) / 2,
		offY: (viewport.h - source.h * scale) / 2
	};
}

/**
 * Projects a capture zone (viewport-relative fractions of the source) through a
 * fit transform into viewport CSS px. `width` and `height` share `fit.scale`,
 * so the rect's aspect is always the capture aspect — the core of the
 * canonical-replay fix.
 */
export function fittedRegionRect(
	region: CaptureZone,
	source: { w: number; h: number },
	fit: CaptureFit
): { left: number; top: number; width: number; height: number } {
	return {
		left: fit.offX + region.xFrac * source.w * fit.scale,
		top: fit.offY + region.yFrac * source.h * fit.scale,
		width: region.wFrac * source.w * fit.scale,
		height: region.hFrac * source.h * fit.scale
	};
}
