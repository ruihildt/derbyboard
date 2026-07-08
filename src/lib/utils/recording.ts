import type { Quality } from './codec';

export type AspectRatio = '16:9' | '1:1' | '4:3';
export type EngineKind = 'composite' | 'clone';

export type RecordingMode = 'full' | 'region';

/** Output height in pixels for each quality tier. */
export const QUALITY_HEIGHT: Record<Quality, number> = {
	'720p': 720,
	'1080p': 1080,
	'1440p': 1440,
	'2160p': 2160
};

/** Width / height for each aspect ratio. */
export const ASPECT_RATIO: Record<AspectRatio, number> = {
	'16:9': 16 / 9,
	'1:1': 1,
	'4:3': 4 / 3
};

export interface OutputSpec {
	w: number;
	h: number;
}

/**
 * Target output dimensions for region mode. Quality defines the height; the width
 * follows the chosen aspect ratio.
 */
export function outputDimensions(quality: Quality, ratio: AspectRatio): OutputSpec {
	const h = QUALITY_HEIGHT[quality];
	return { w: Math.round(h * ASPECT_RATIO[ratio]), h };
}
