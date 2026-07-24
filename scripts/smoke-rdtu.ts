/**
 * Step 0 smoke test for roller-derby-track-utils + local three/lodash shims.
 *
 * Run: npx vite-node scripts/smoke-rdtu.ts
 *
 * vite-node resolves the `three` / `lodash` bare specifiers through the
 * vite.config.ts aliases, so this exercises the exact same shim path the app
 * uses. It validates that the shim's Vector2 methods and cloneDeep actually
 * compute correct values at runtime (the build only proves they bundle).
 *
 * Scope: confirm the package RUNS and produces sane numbers in its own
 * (meter) coordinate space. The 180° orientation reconciliation between
 * Derbyboard's pixel layout and the package's convention is verified later,
 * in Step 2, once the px↔m adapter + Konva rendering exist.
 */
import {
	C1,
	C2,
	MEASUREMENT_RADIUS,
	CIRCUMFERENCE_HALF_CIRCLE,
	MEASUREMENT_LENGTH,
	ENGAGEMENT_ZONE_DISTANCE_TO_PACK,
	getPivotLineDistance,
	getSkatersWDPInBounds,
	getSkatersWDPPivotLineDistance,
	getSkatersWDPInPlayPackSkater,
	getSortedPackBoundaries,
	computePartialTrackShape2D,
	PACK_MEASURING_METHODS
} from 'roller-derby-track-utils';
import { analyzePack, engagementZonePathData, pxToMeter, isInBounds } from '$lib/trackMath';
import {
	CENTER_POINT_OFFSET,
	VERTICAL_OFFSET_1,
	VERTICAL_OFFSET_2,
	OUTER_VERTICAL_OFFSET_1,
	OUTER_VERTICAL_OFFSET_2,
	TWENTYFEET,
	TRACK_SCALE
} from '$lib/constants';

let failures = 0;
const check = (label: string, cond: boolean, detail = '') => {
	const tag = cond ? 'PASS' : 'FAIL';
	if (!cond) failures++;
	console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n=== constants (shim Vector2 instantiated at module load) ===');
console.log(`  C1 = (${C1.x}, ${C1.y})   C2 = (${C2.x}, ${C2.y})`);
console.log(`  MEASUREMENT_RADIUS = ${MEASUREMENT_RADIUS}`);
console.log(`  MEASUREMENT_LENGTH = ${MEASUREMENT_LENGTH.toFixed(3)} m`);
console.log(`  ENGAGEMENT_ZONE_DISTANCE_TO_PACK = ${ENGAGEMENT_ZONE_DISTANCE_TO_PACK}`);
check('C1 is right turn center (5.33, 0)', C1.x === 5.33 && C1.y === 0);
check('C2 is left turn center (-5.33, 0)', C2.x === -5.33 && C2.y === 0);
check('measurement radius is 3.81 + 1.6', Math.abs(MEASUREMENT_RADIUS - 5.41) < 1e-9);

console.log(
	'\n=== getPivotLineDistance (origin dist=0 = start of right turn; pivot line = half-circle mark) ==='
);
const dPivot = getPivotLineDistance({ x: 5.33, y: 0 });
console.log(
	`  pivot-line junction (5.33, 0) -> ${dPivot.toFixed(3)} m  (CIRCUMFERENCE_HALF_CIRCLE = ${CIRCUMFERENCE_HALF_CIRCLE.toFixed(3)})`
);
check(
	'pivot line sits at the half-circumference mark',
	Math.abs(dPivot - CIRCUMFERENCE_HALF_CIRCLE) < 1e-9,
	`got ${dPivot}`
);

console.log('\n=== pack pipeline (two opposing blockers within 3.05 m on top straight) ===');
// Top straightaway: track surface is around y in [-8.08, -3.81]; measurement line at y=-5.41.
const skaters = [
	{ id: 1, x: 0, y: -5.41, team: 'A' as const },
	{ id: 2, x: 2, y: -5.41, team: 'B' as const },
	{ id: 3, x: 0, y: -6.2, team: 'A' as const, isJammer: true }
];
const enriched = getSkatersWDPInPlayPackSkater(
	getSkatersWDPPivotLineDistance(getSkatersWDPInBounds(skaters)),
	{ method: PACK_MEASURING_METHODS.SECTOR }
);
for (const s of enriched) {
	console.log(
		`  #${s.id} (${s.team}${(s as { isJammer?: boolean }).isJammer ? ' J' : ''}) ` +
			`inBounds=${s.inBounds} pivotLineDist=${s.pivotLineDist?.toFixed(2)} ` +
			`packSkater=${(s as { packSkater?: boolean }).packSkater} ` +
			`inPlay=${(s as { inPlay?: boolean }).inPlay}`
	);
}
const packSkaters = enriched.filter((s) => (s as { packSkater?: boolean }).packSkater);
check('exactly the two blockers form the pack', packSkaters.length === 2, `got ${packSkaters.length}`);
check('jammer excluded from pack', !packSkaters.some((s) => (s as { isJammer?: boolean }).isJammer));
check('both pack skaters inBounds', packSkaters.every((s) => s.inBounds));

console.log('\n=== engagement zone shape (SVG path-data string) ===');
const bounds = getSortedPackBoundaries(packSkaters);
console.log(`  pack boundaries (pivotLineDist): [${bounds?.map((b) => b.toFixed(2)).join(', ')}]`);
const ezPath = computePartialTrackShape2D({
	p1: bounds![0],
	p2: bounds![1],
	method: PACK_MEASURING_METHODS.SECTOR
});
const preview = ezPath.length > 90 ? ezPath.slice(0, 90) + '…' : ezPath;
console.log(`  EZ path data (${ezPath.length} chars): ${preview}`);
check('EZ path is a move-started, closed SVG path', /^M[\d.-]/.test(ezPath) && ezPath.trimEnd().endsWith('Z'));

// engagementZonePathData wraps the pack-only shape but extends the boundaries by
// the engagement-zone distance, so its path must be longer than the pack shape.
const ezWrapper = engagementZonePathData(packSkaters);
check(
	'engagementZonePathData returns a longer (EZ-extended) closed path',
	typeof ezWrapper === 'string' &&
		/^M/.test(ezWrapper) &&
		ezWrapper.endsWith('Z') &&
		ezWrapper.length > ezPath.length
);

console.log('\n=== in-play drift regression (distant blocker must NOT be in play) ===');
// A 5-skater mixed pack on the top straight, plus one lone blocker far away on
// the bottom straight. The lone blocker is well outside the engagement zone.
// The package's getSkatersWDPInPlayPackSkater mutates the shared packBoundaries
// array on each SECTOR call, growing the zone ~20 ft per skater; without the
// adapter's per-call copy this lone blocker would wrongly read as in play.
const driftRaw = [
	{ id: 1, x: 0, y: -5.41, team: 'A' },
	{ id: 2, x: 1, y: -5.41, team: 'B' },
	{ id: 3, x: 2, y: -5.41, team: 'A' },
	{ id: 4, x: 3, y: -5.41, team: 'B' },
	{ id: 5, x: 4, y: -5.41, team: 'A' },
	{ id: 6, x: 0, y: 5.41, team: 'B' }
];
const driftDerived = analyzePack(getSkatersWDPInBounds(driftRaw));
const distant = driftDerived.find((s) => s.id === 6)!;
const packDerivedDrift = driftDerived.filter((s) => s.packSkater);
check('the five top-straight blockers form the pack', packDerivedDrift.length === 5);
check('pack members are in play', packDerivedDrift.every((s) => s.inPlay));
check(
	'distant bottom-straight blocker is NOT in play',
	distant.inPlay === false,
	`got inPlay=${distant.inPlay}`
);

console.log('\n=== RECTANGLE method validation ===');
// Same scenario as SECTOR: two close mixed blockers + a distant one. On a
// straight, RECTANGLE and SECTOR distances coincide, so both methods must agree
// on pack membership, and the distant blocker must be out of play.
const rectRaw = [
	{ id: 1, x: 0, y: -5.41, team: 'A' },
	{ id: 2, x: 2, y: -5.41, team: 'B' },
	{ id: 3, x: 0, y: -6.2, team: 'A', isJammer: true },
	{ id: 4, x: 0, y: 5.41, team: 'A' }
];
const rectBounds = getSkatersWDPInBounds(rectRaw);
const rectDerived = analyzePack(rectBounds, PACK_MEASURING_METHODS.RECTANGLE);
const rectPack = rectDerived.filter((s) => s.packSkater);
check(
	'RECTANGLE finds the two top-straight blockers as the pack',
	rectPack.length === 2 && rectPack.every((s) => s.id === 1 || s.id === 2)
);
check(
	'RECTANGLE: distant blocker is NOT in play',
	rectDerived.find((s) => s.id === 4)!.inPlay === false
);
const secDerived = analyzePack(rectBounds, PACK_MEASURING_METHODS.SECTOR);
const membershipAgrees = rectDerived.every(
	(s) => s.packSkater === secDerived.find((t) => t.id === s.id)?.packSkater
);
check('RECTANGLE agrees with SECTOR on pack membership (straight)', membershipAgrees);

const rectEz = engagementZonePathData(rectPack, PACK_MEASURING_METHODS.RECTANGLE);
check(
	'RECTANGLE engagement-zone path is a closed SVG path',
	typeof rectEz === 'string' && /^M/.test(rectEz) && rectEz.endsWith('Z'),
	`${(rectEz || '').length} chars`
);

console.log('\n=== trackMath px↔meter adapter (orientation + in-bounds) ===');
const center = { x: 500, y: 400 };
const origin = pxToMeter({ x: 500, y: 400 }, center);
check('viewport center maps to meter (0, 0)', origin.x === 0 && origin.y === 0, `got (${origin.x}, ${origin.y})`);

// A point 5.33 m to the RIGHT of Derbyboard center is the RIGHT turn (C1) in
// package space too -> meter x ~= +5.33. The track surface matches the package
// directly (same wide/narrow corners), so there is NO horizontal flip.
const rightTurn = pxToMeter({ x: 500 + 5.33 * 35, y: 400 }, center);
check(
	'Derbyboard-right maps to package-right (direct, no flip)',
	Math.abs(rightTurn.x - 5.33) < 1e-9 && rightTurn.y === 0,
	`got (${rightTurn.x}, ${rightTurn.y})`
);

// A point 5.41 m ABOVE Derbyboard center is the TOP straight in both spaces ->
// meter y ~= -5.41 (y preserved; both axes point down).
const topStraight = pxToMeter({ x: 500, y: 400 - 5.41 * 35 }, center);
check(
	'Derbyboard-top maps to package-top (y preserved)',
	topStraight.x === 0 && Math.abs(topStraight.y - -5.41) < 1e-9,
	`got (${topStraight.x}, ${topStraight.y})`
);

// Regression: a skater fully inside the WIDE top-right corner must stay in
// bounds. (4, -7.5) is ~0.8 m inside the outer boundary there. An x-flipped
// mapping would place it on the narrow side and (with the strict margin) mark
// it out of bounds — this guards against that.
const wideCorner = pxToMeter({ x: 500 + 4 * 35, y: 400 - 7.5 * 35 }, center);
check(
	'skater fully inside the wide top-right corner is in bounds',
	isInBounds(wideCorner) === true,
	`at (${wideCorner.x.toFixed(2)}, ${wideCorner.y.toFixed(2)})`
);

check('infield center (0, 0) is out of bounds', isInBounds({ x: 0, y: 0 }) === false);
check('fully inside the top straight (0, -5.41) is in bounds', isInBounds({ x: 0, y: -5.41 }) === true);
check('past the outer boundary (0, -9) is out of bounds', isInBounds({ x: 0, y: -9 }) === false);
check(
	'hitbox touching/crossing the inner edge (0, -3.5) is out of bounds (strict)',
	isInBounds({ x: 0, y: -3.5 }) === false
);
check('fully inside the infield (0, -3.0) is out of bounds', isInBounds({ x: 0, y: -3.0 }) === false);

console.log('\n=== track constants re-based on package (metres) ===');
const m = (px: number) => px / TRACK_SCALE;
check('CENTER_POINT_OFFSET = 5.33 m', Math.abs(m(CENTER_POINT_OFFSET) - 5.33) < 1e-9);
check('VERTICAL_OFFSET_1 = 3.81 m', Math.abs(m(VERTICAL_OFFSET_1) - 3.81) < 1e-9);
check('VERTICAL_OFFSET_2 = 0.305 m', Math.abs(m(VERTICAL_OFFSET_2) - 0.305) < 1e-9);
check('OUTER_VERTICAL_OFFSET_1 = 8.385 m', Math.abs(m(OUTER_VERTICAL_OFFSET_1) - 8.385) < 1e-9);
check('OUTER_VERTICAL_OFFSET_2 = 7.775 m', Math.abs(m(OUTER_VERTICAL_OFFSET_2) - 7.775) < 1e-9);
check('TWENTYFEET = 6.1 m', Math.abs(m(TWENTYFEET) - 6.1) < 1e-9);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
