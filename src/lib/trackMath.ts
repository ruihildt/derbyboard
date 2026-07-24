/**
 * Adapter between Derbyboard's Konva pixel space and roller-derby-track-utils'
 * meter space. All package functions operate in meters, so this is the single
 * boundary where units and orientation are reconciled.
 *
 * Coordinate model:
 *  - Derbyboard renders in pixels, track centered at the viewport center, with
 *    1 m = TRACK_SCALE px.
 *  - Derbyboard's track surface matches the package's track DIRECTLY: same
 *    inner/outer radii, same slanted outer straight, and the same wide/narrow
 *    corners (top-right & bottom-left are the wide ends). So both axes are
 *    preserved — origin at the viewport center, screen y-down matches the
 *    package's top-straight at negative y. Only the pivot LINE marking differs
 *    in placement between the two, which does not affect bounds.
 */
import {
	C1,
	C2,
	C1_OUTER,
	C2_OUTER,
	F_OUTER_BOTTOM,
	F_OUTER_TOP,
	RADIUS_INNER,
	RADIUS_OUTER,
	getSkatersWDPPivotLineDistance,
	getSkatersWDPInPlayPackSkater,
	getSortedOutermostSkaters,
	PACK_MEASURING_METHODS
} from 'roller-derby-track-utils';
import { PLAYER_RADIUS, TRACK_SCALE } from '$lib/constants';

export interface MeterPoint {
	x: number;
	y: number;
}

/** Konva stage-space px -> package meters, given the viewport center in px. */
export function pxToMeter(pos: MeterPoint, center: MeterPoint): MeterPoint {
	return {
		x: (pos.x - center.x) / TRACK_SCALE,
		y: (pos.y - center.y) / TRACK_SCALE
	};
}

/** Player drawn radius expressed in meters (the in-bounds circle size). */
const PLAYER_RADIUS_M = PLAYER_RADIUS / TRACK_SCALE;

/**
 * Whether a meter-space position is in bounds, using the package's track
 * geometry with a STRICT boundary model: the skater is out of bounds as soon as
 * any part of its circular hitbox touches or extends beyond a track boundary.
 * Equivalently, the skater is in bounds only when the entire hitbox sits inside
 * the track. The skater is modelled as a circle of its drawn radius; the track
 * geometry itself comes from the package's constants, so track-dimension updates
 * are picked up — only the margin model is local.
 */
export function isInBounds(pos: MeterPoint, radiusM: number = PLAYER_RADIUS_M): boolean {
	const { x, y } = pos;
	const r = radiusM;

	// Right turn (package x > C1): entire circle must sit inside the annulus.
	if (x > C1.x) {
		const dInner = Math.hypot(x - C1.x, y - C1.y);
		const dOuter = Math.hypot(x - C1_OUTER.x, y - C1_OUTER.y);
		return dInner > RADIUS_INNER + r && dOuter < RADIUS_OUTER - r;
	}

	// Top straight (-y): entire circle must sit within [F_OUTER_TOP, -RADIUS_INNER].
	if (x <= C1.x && x >= C2.x && y <= 0) {
		return y <= -RADIUS_INNER - r && y >= F_OUTER_TOP(x) + r;
	}

	// Left turn (package x < C2): entire circle must sit inside the annulus.
	if (x < C2.x) {
		const dInner = Math.hypot(x - C2.x, y - C2.y);
		const dOuter = Math.hypot(x - C2_OUTER.x, y - C2_OUTER.y);
		return dInner > RADIUS_INNER + r && dOuter < RADIUS_OUTER - r;
	}

	// Bottom straight (+y): entire circle must sit within [RADIUS_INNER, F_OUTER_BOTTOM].
	return y >= RADIUS_INNER + r && y <= F_OUTER_BOTTOM(x) - r;
}

// --------------------------------------------------------------------------- //
// Pack detection (roller-derby-track-utils)
// --------------------------------------------------------------------------- //

export type PackMethod = (typeof PACK_MEASURING_METHODS)[keyof typeof PACK_MEASURING_METHODS];

/** A skater in package meter space, carrying Derbyboard's own in-bounds flag. */
export interface MeterSkater {
	id: string;
	x: number;
	y: number;
	team: string;
	isJammer: boolean;
	inBounds: boolean;
}

/** A skater enriched by the package's pack pipeline. */
export interface DerivedSkater extends MeterSkater {
	pivotLineDist: number;
	inPlay: boolean;
	packSkater: boolean;
}

/**
 * Run the package's pack pipeline over meter skaters. The input skaters must
 * already carry `inBounds` (Derbyboard sets it from the player's own bounds
 * check, so pack eligibility matches the visual indicator); this adds
 * pivotLineDist, inPlay and packSkater. The default SECTOR method matches the
 * previous hip-to-hip behaviour.
 */
export function analyzePack(
	skaters: MeterSkater[],
	method: PackMethod = PACK_MEASURING_METHODS.SECTOR
): DerivedSkater[] {
	const withPivot = getSkatersWDPPivotLineDistance(skaters);
	// The package's generic infers its constraint, so the TS return type drops the
	// enriched fields; they are present at runtime (verified by the smoke test).
	return getSkatersWDPInPlayPackSkater(withPivot, { method }) as unknown as DerivedSkater[];
}

/** Returns the pack's two outermost skaters as [rearmost, foremost], or null. */
export function packEndpoints(pack: DerivedSkater[]): [DerivedSkater, DerivedSkater] | null {
	if (pack.length < 2) return null;
	const endpoints = getSortedOutermostSkaters(pack);
	if (!endpoints || endpoints.length !== 2) return null;
	return [endpoints[0], endpoints[1]] as unknown as [DerivedSkater, DerivedSkater];
}
