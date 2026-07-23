/**
 * Adapter between Derbyboard's Konva pixel space and roller-derby-track-utils'
 * meter space. All package functions operate in meters, so this is the single
 * boundary where units and orientation are reconciled.
 *
 * Coordinate model:
 *  - Derbyboard renders in pixels, track centered at the viewport center, with
 *    1 m = TRACK_SCALE px.
 *  - Derbyboard's track is the package's track REFLECTED ACROSS THE VERTICAL
 *    AXIS: the pivot line is on the LEFT in Derbyboard but on the RIGHT
 *    (C1, +5.33 m) in the package. So x is negated; y is preserved (both axes
 *    point down — screen y-down, package top-straight at negative y).
 */
import { getSkatersWDPInBounds } from 'roller-derby-track-utils';
import { TRACK_SCALE } from '$lib/constants';

export interface MeterPoint {
	x: number;
	y: number;
}

/** Konva stage-space px -> package meters, given the viewport center in px. */
export function pxToMeter(pos: MeterPoint, center: MeterPoint): MeterPoint {
	return {
		x: (center.x - pos.x) / TRACK_SCALE,
		y: (pos.y - center.y) / TRACK_SCALE
	};
}

/** Package meters -> Konva stage-space px, given the viewport center in px. */
export function meterToPx(pos: MeterPoint, center: MeterPoint): MeterPoint {
	return {
		x: center.x - pos.x * TRACK_SCALE,
		y: center.y + pos.y * TRACK_SCALE
	};
}

/**
 * Whether a meter-space position is in bounds, using the package's analytic
 * boundary test (skater modelled as a SKATER_RADIUS circle, 0.3 m).
 */
export function isInBounds(pos: MeterPoint): boolean {
	return getSkatersWDPInBounds([pos])[0]?.inBounds === true;
}
