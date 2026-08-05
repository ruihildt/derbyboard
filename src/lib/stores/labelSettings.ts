import { persisted } from 'svelte-persisted-store';

/**
 * Text-label (annotation) settings, persisted across sessions. Currently holds
 * the font size used when authoring a new label; the chosen size is also
 * stamped onto each label annotation so a saved board keeps per-label sizing.
 */
export type LabelSize = 'S' | 'M' | 'L' | 'XL';

export interface LabelSettings {
	size: LabelSize;
}

/**
 * Base on-screen pixel size for each step. The AnnotationRenderer divides these
 * by the stage scale (like the legacy label size) so text stays a constant
 * visual size regardless of zoom. `M` is the default for new labels; labels
 * saved before per-label sizing existed fall back to `LEGACY_LABEL_PX` (the old
 * hardcoded 14px) so existing boards look unchanged.
 */
export const LABEL_FONT_PX: Record<LabelSize, number> = {
	S: 14,
	M: 20,
	L: 28,
	XL: 40
};

/** Fallback base size for labels authored before per-label fontSize existed. */
export const LEGACY_LABEL_PX = 14;

/** The base on-screen pixel size for a label size token. */
export function labelBasePx(size: LabelSize): number {
	return LABEL_FONT_PX[size];
}

export const labelSettings = persisted<LabelSettings>('derbyboard-label-settings', {
	size: 'M'
});
