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
import { pxToMeter, isInBounds } from '$lib/trackMath';

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

console.log('\n=== trackMath px↔meter adapter (orientation + in-bounds) ===');
const center = { x: 500, y: 400 };
const origin = pxToMeter({ x: 500, y: 400 }, center);
check('viewport center maps to meter (0, 0)', origin.x === 0 && origin.y === 0, `got (${origin.x}, ${origin.y})`);

// A point 5.33 m to the RIGHT of Derbyboard center is the LEFT turn (C2) in
// package space -> meter x ~= -5.33 (x is mirrored across the vertical axis).
const rightTurn = pxToMeter({ x: 500 + 5.33 * 35, y: 400 }, center);
check(
	'Derbyboard-right maps to package-left (x mirrored)',
	Math.abs(rightTurn.x - -5.33) < 1e-9 && rightTurn.y === 0,
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

check('infield center (0, 0) is out of bounds', isInBounds({ x: 0, y: 0 }) === false);
check('top-straight measurement line (0, -5.41) is in bounds', isInBounds({ x: 0, y: -5.41 }) === true);
check('outside the top boundary (0, -9) is out of bounds', isInBounds({ x: 0, y: -9 }) === false);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
