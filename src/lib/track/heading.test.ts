import { describe, it, expect } from 'vitest';
import { resolveHeading, resolveHeadings, motionHeading } from './heading';
import { trackLayer } from './trackLayer';
import { fromTrack, LAP_LENGTH } from './trackFrame';
import type { EntityPose, PlanarPoint } from '$lib/doc/types';

/** Planar world point for a track-space pose (used to build planar test poses). */
function planar(S: number, u: number): PlanarPoint {
	return fromTrack(S, u);
}

/** Helper: the auto (looking) heading the module should produce at a given S. */
function autoHeadingAt(s: number): number {
	const t = trackLayer.tangentAt(planar(s, 0.5));
	return Math.atan2(t.y, t.x);
}

/** Builds a planar EntityPose from track-space (S, u) plus optional overrides. */
function poseAt(id: string, S: number, u = 0.5, extra: Partial<EntityPose> = {}): EntityPose {
	const m = planar(S, u);
	return { id, x: m.x, y: m.y, heading: 0, ...extra };
}

/** Normalises an angle to (-π, π] for comparing across the ±π wrap. */
function normalize(a: number): number {
	let x = ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
	if (x <= -Math.PI) x += 2 * Math.PI;
	return x;
}

describe('resolveHeading', () => {
	it('auto-faces along the track tangent by default (looking direction)', () => {
		expect(resolveHeading(poseAt('e1', 3.2), true)).toBeCloseTo(autoHeadingAt(3.2), 10);
	});

	it('returns the stored heading when manualHeading is true, even if autoFace is on', () => {
		expect(
			resolveHeading(poseAt('e1', 3.2, 0.5, { heading: Math.PI / 3, manualHeading: true }), true)
		).toBe(Math.PI / 3);
	});

	it('returns the stored heading when autoFace is false (all manual)', () => {
		expect(resolveHeading(poseAt('e1', 3.2, 0.5, { heading: -Math.PI / 4 }), false)).toBe(
			-Math.PI / 4
		);
	});

	it('on the closing straight faces +x (heading 0)', () => {
		// The final straight segment has tangent {x:1, y:0} ⇒ heading 0.
		expect(resolveHeading(poseAt('e1', LAP_LENGTH - 1, 0.5, { heading: 99 }), true)).toBeCloseTo(
			0,
			10
		);
	});

	it('does NOT change with motion: two poses at the same S share a heading', () => {
		// The core "looking ≠ moving" property: the facing at a position is the
		// same regardless of where the skater is heading next.
		const here = poseAt('e1', 5);
		expect(resolveHeading(here, true)).toBeCloseTo(autoHeadingAt(5), 10);
		// A pose at the same S (e.g. an arrival step) resolves identically.
		const same = poseAt('e1', 5);
		expect(resolveHeading(same, true)).toBe(resolveHeading(here, true));
	});

	it('relative mode: facing = track tangent + delta, and the delta persists across positions', () => {
		// A 180° (π) offset from the skating direction.
		const a = poseAt('e1', 3, 0.5, { headingMode: 'relative', headingDelta: Math.PI });
		const expectedAt3 = normalize(autoHeadingAt(3) + Math.PI);
		expect(normalize(resolveHeading(a, true))).toBeCloseTo(expectedAt3, 10);

		// Move the skater to a different S: the SAME delta is reapplied to the
		// new tangent, so they keep facing 180° off the skating direction.
		const b = poseAt('e1', 9, 0.5, { headingMode: 'relative', headingDelta: Math.PI });
		const expectedAt9 = normalize(autoHeadingAt(9) + Math.PI);
		expect(normalize(resolveHeading(b, true))).toBeCloseTo(expectedAt9, 10);
		// And it differs from the pure-tangent facing at that spot.
		expect(resolveHeading(b, true)).not.toBeCloseTo(autoHeadingAt(9), 5);
	});

	it('pinned mode: facing always points toward the fixed look-at world point', () => {
		const lookAt = { x: 10, y: -2 };
		const pose = poseAt('e1', 4, 0.5, { headingMode: 'pinned', lookAt });
		const world = planar(4, 0.5);
		const expected = Math.atan2(lookAt.y - world.y, lookAt.x - world.x);
		expect(resolveHeading(pose, true)).toBeCloseTo(expected, 10);

		// From a different position the skater still faces the same map point.
		const world2 = planar(8, 0.5);
		const pose2 = poseAt('e1', 8, 0.5, { headingMode: 'pinned', lookAt });
		const expected2 = Math.atan2(lookAt.y - world2.y, lookAt.x - world2.x);
		expect(resolveHeading(pose2, true)).toBeCloseTo(expected2, 10);
	});

	it('fixed mode: facing is an absolute angle frozen on the canvas', () => {
		const fixedHeading = 1.23; // an arbitrary absolute world angle
		const pose = poseAt('e1', 4, 0.5, { heading: fixedHeading, headingMode: 'fixed' });
		// The same absolute heading is returned regardless of position.
		expect(resolveHeading(pose, true)).toBeCloseTo(fixedHeading, 10);
		const pose2 = poseAt('e1', 20, 0.2, { heading: fixedHeading, headingMode: 'fixed' });
		expect(resolveHeading(pose2, true)).toBeCloseTo(fixedHeading, 10);
		// And it does not follow the track tangent at that spot.
		expect(resolveHeading(pose, true)).not.toBeCloseTo(autoHeadingAt(4), 5);
	});
});

describe('resolveHeadings', () => {
	it('resolves every step from the track tangent (auto)', () => {
		const steps: EntityPose[][] = [
			[poseAt('e1', 0), poseAt('e2', 1, 0.4)],
			[poseAt('e1', 10), poseAt('e2', 11, 0.6)]
		];

		const resolved = resolveHeadings(steps, true);

		expect(resolved[0][0].heading).toBeCloseTo(autoHeadingAt(0), 10);
		expect(resolved[0][1].heading).toBeCloseTo(autoHeadingAt(1), 10);
		expect(resolved[1][0].heading).toBeCloseTo(autoHeadingAt(10), 10);
		expect(resolved[1][1].heading).toBeCloseTo(autoHeadingAt(11), 10);
	});

	it('keeps manual headings sticky across steps', () => {
		const steps: EntityPose[][] = [
			[poseAt('e1', 0), poseAt('e2', 0, 0.4, { manualHeading: true })],
			[poseAt('e1', 10), poseAt('e2', 10, 0.6, { heading: Math.PI, manualHeading: true })]
		];

		const resolved = resolveHeadings(steps, true);

		// e2 keeps its authored manual heading at each step.
		expect(resolved[0][1].heading).toBe(0);
		expect(resolved[1][1].heading).toBe(Math.PI);
	});

	it('uses stored heading for all poses when autoFace is false', () => {
		const steps: EntityPose[][] = [
			[poseAt('e1', 0, 0.5, { heading: 0 }), poseAt('e2', 0, 0.4, { heading: Math.PI })]
		];

		const resolved = resolveHeadings(steps, false);

		expect(resolved[0][0].heading).toBe(0);
		expect(resolved[0][1].heading).toBe(Math.PI);
	});

	it('the arrival (last) step keeps the same facing — no end-of-move change', () => {
		// A skater arriving at their destination faces along the track there,
		// identical to a pose placed at that same S. No snap at the end.
		const destination = poseAt('e1', 7);
		const steps: EntityPose[][] = [[{ ...destination }], [{ ...destination }]];

		const resolved = resolveHeadings(steps, true);

		expect(resolved[1][0].heading).toBeCloseTo(autoHeadingAt(7), 10);
		expect(resolved[1][0].heading).toBe(resolved[0][0].heading);
	});

	it('handles empty steps array', () => {
		expect(resolveHeadings([], true)).toEqual([]);
	});

	it('does not mutate input steps', () => {
		const steps: EntityPose[][] = [[poseAt('e1', 0)]];
		const original = steps[0][0].heading;
		resolveHeadings(steps, true);
		expect(steps[0][0].heading).toBe(original);
	});
});

describe('motionHeading (captured-clip replay)', () => {
	it('computes bearing from consecutive samples', () => {
		const heading = motionHeading({ x: 0, y: 0 }, { x: 10, y: 0 }, 0);
		expect(typeof heading).toBe('number');
		expect(Number.isFinite(heading)).toBe(true);
		expect(heading).toBeCloseTo(0, 6);
	});

	it('holds fallback when at rest (no motion)', () => {
		const fallback = Math.PI / 4;
		expect(motionHeading({ x: 0, y: 0 }, { x: 0, y: 0 }, fallback)).toBe(fallback);
	});

	it('holds fallback for very small displacements', () => {
		const fallback = Math.PI / 2;
		expect(motionHeading({ x: 0, y: 0 }, { x: 0.0000001, y: 0 }, fallback)).toBe(fallback);
	});

	it('derives a new heading when there is motion', () => {
		const heading = motionHeading({ x: 0, y: 0 }, { x: 0, y: 10 }, Math.PI / 4);
		expect(heading).not.toBe(Math.PI / 4); // moved off the fallback
		expect(heading).toBeCloseTo(Math.PI / 2, 6); // +y bearing
	});
});
