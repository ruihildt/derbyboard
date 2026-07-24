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
	getPack,
	isSkaterInEngagementZone,
	getSortedOutermostSkaters,
	getSortedPackBoundaries,
	computePartialTrackShape2D,
	ENGAGEMENT_ZONE_DISTANCE_TO_PACK,
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
 *
 * This does NOT use the package's getSkatersWDPInPlayPackSkater: that function
 * builds packBoundaries once and passes the SAME array into isSkaterInEngagementZone
 * for every skater, and the SECTOR branch MUTATES it (boundaries[0] -= EZ,
 * boundaries[1] += EZ) — so the engagement zone grows ~20 ft per skater and
 * eventually marks everyone in play. Here we compute packBoundaries once and
 * pass a fresh copy per skater, so the zone stays correct.
 */
// The package's .d.ts types isSkaterInEngagementZone as a single options object,
// but the runtime is positional (skater, packBoundaries, method); use the real form.
const isInEngagementZone = isSkaterInEngagementZone as unknown as (
	skater: MeterSkater & { pivotLineDist: number },
	packBoundaries: number[] | DerivedSkater[],
	method: PackMethod
) => boolean;

export function analyzePack(
	skaters: MeterSkater[],
	method: PackMethod = PACK_MEASURING_METHODS.SECTOR
): DerivedSkater[] {
	const withPivot = getSkatersWDPPivotLineDistance(skaters);
	// The package's pack functions are typed for id:number / team:'A'|'B';
	// Derbyboard uses strings (runtime-compatible), so cast at this boundary.
	const pack = getPack(withPivot as unknown as Parameters<typeof getPack>[0], { method }) as
		| DerivedSkater[]
		| null;

	let boundaries: number[] | DerivedSkater[] | null = null;
	if (pack) {
		if (method === PACK_MEASURING_METHODS.SECTOR) {
			const b = getSortedPackBoundaries(pack);
			if (b) boundaries = b as number[];
		} else {
			const b = getSortedOutermostSkaters(pack);
			if (b) boundaries = b as unknown as DerivedSkater[];
		}
	}

	return withPivot.map((skater) => {
		const packSkater = !!pack && skater.inBounds && pack.some((e) => e.id === skater.id);
		let inPlay = false;
		if (skater.isJammer) {
			inPlay = skater.inBounds;
		} else if (skater.inBounds && boundaries) {
			// Fresh copy per call: the package's SECTOR branch mutates the array.
			inPlay = isInEngagementZone(skater, [...boundaries] as number[] | DerivedSkater[], method);
		}
		return { ...skater, inPlay, packSkater };
	}) as unknown as DerivedSkater[];
}

/** Returns the pack's two outermost skaters as [rearmost, foremost], or null. */
export function packEndpoints(pack: DerivedSkater[]): [DerivedSkater, DerivedSkater] | null {
	if (pack.length < 2) return null;
	const endpoints = getSortedOutermostSkaters(pack);
	if (!endpoints || endpoints.length !== 2) return null;
	return [endpoints[0], endpoints[1]] as unknown as [DerivedSkater, DerivedSkater];
}

/**
 * Build the engagement-zone overlay as an SVG path-data string in package
 * METERS. The zone is the pack's pivotLineDist boundaries extended by
 * ENGAGEMENT_ZONE_DISTANCE_TO_PACK on each side — the same extension the
 * package uses for in-play membership, so the overlay matches who is marked
 * in-play. Returns null when there is no pack.
 */
export function engagementZonePathData(
	pack: DerivedSkater[],
	method: PackMethod = PACK_MEASURING_METHODS.SECTOR
): string | null {
	const boundaries = getSortedPackBoundaries(pack);
	if (!boundaries) return null;
	const [rear, fore] = boundaries;
	return computePartialTrackShape2D({
		p1: rear - ENGAGEMENT_ZONE_DISTANCE_TO_PACK,
		p2: fore + ENGAGEMENT_ZONE_DISTANCE_TO_PACK,
		method
	});
}
