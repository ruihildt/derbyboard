import { describe, it, expect } from 'vitest';
import { resolveHeading, resolveHeadings, motionHeading } from './heading';
import { tangentAt, fromTrack, LAP_LENGTH } from './trackFrame';
import type { EntityPose } from '$lib/doc/types';

/** Helper: the auto (looking) heading the module should produce at a given S. */
function autoHeadingAt(s: number): number {
	const t = tangentAt(s);
	return Math.atan2(t.y, t.x);
}

/** Normalises an angle to (-π, π] for comparing across the ±π wrap. */
function normalize(a: number): number {
	let x = ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
	if (x <= -Math.PI) x += 2 * Math.PI;
	return x;
}

describe('resolveHeading', () => {
	it('auto-faces along the track tangent by default (looking direction)', () => {
		const pose: EntityPose = { id: 'e1', S: 3.2, u: 0.5, heading: 0 };
		expect(resolveHeading(pose, true)).toBeCloseTo(autoHeadingAt(3.2), 10);
	});

	it('returns the stored heading when manualHeading is true, even if autoFace is on', () => {
		const pose: EntityPose = {
			id: 'e1',
			S: 3.2,
			u: 0.5,
			heading: Math.PI / 3,
			manualHeading: true
		};
		expect(resolveHeading(pose, true)).toBe(Math.PI / 3);
	});

	it('returns the stored heading when autoFace is false (all manual)', () => {
		const pose: EntityPose = { id: 'e1', S: 3.2, u: 0.5, heading: -Math.PI / 4 };
		expect(resolveHeading(pose, false)).toBe(-Math.PI / 4);
	});

	it('on the closing straight faces +x (heading 0)', () => {
		// The final straight segment has tangent {x:1, y:0} ⇒ heading 0.
		const pose: EntityPose = { id: 'e1', S: LAP_LENGTH - 1, u: 0.5, heading: 99 };
		expect(resolveHeading(pose, true)).toBeCloseTo(0, 10);
	});

	it('does NOT change with motion: two poses at the same S share a heading', () => {
		// The core "looking ≠ moving" property: the facing at a position is the
		// same regardless of where the skater is heading next.
		const here: EntityPose = { id: 'e1', S: 5, u: 0.5, heading: 0 };
		expect(resolveHeading(here, true)).toBeCloseTo(autoHeadingAt(5), 10);
		// A pose at the same S (e.g. an arrival step) resolves identically.
		const same: EntityPose = { id: 'e1', S: 5, u: 0.5, heading: 0 };
		expect(resolveHeading(same, true)).toBe(resolveHeading(here, true));
	});

	it('relative mode: facing = track tangent + delta, and the delta persists across positions', () => {
		// A 180° (π) offset from the skating direction.
		const a: EntityPose = {
			id: 'e1',
			S: 3,
			u: 0.5,
			heading: 0,
			headingMode: 'relative',
			headingDelta: Math.PI
		};
		const expectedAt3 = normalize(autoHeadingAt(3) + Math.PI);
		expect(normalize(resolveHeading(a, true))).toBeCloseTo(expectedAt3, 10);

		// Move the skater to a different S: the SAME delta is reapplied to the
		// new tangent, so they keep facing 180° off the skating direction.
		const b: EntityPose = {
			id: 'e1',
			S: 9,
			u: 0.5,
			heading: 0,
			headingMode: 'relative',
			headingDelta: Math.PI
		};
		const expectedAt9 = normalize(autoHeadingAt(9) + Math.PI);
		expect(normalize(resolveHeading(b, true))).toBeCloseTo(expectedAt9, 10);
		// And it differs from the pure-tangent facing at that spot.
		expect(resolveHeading(b, true)).not.toBeCloseTo(autoHeadingAt(9), 5);
	});

	it('pinned mode: facing always points toward the fixed look-at world point', () => {
		const lookAt = { x: 10, y: -2 };
		const pose: EntityPose = {
			id: 'e1',
			S: 4,
			u: 0.5,
			heading: 0,
			headingMode: 'pinned',
			lookAt
		};
		const world = fromTrack(4, 0.5);
		const expected = Math.atan2(lookAt.y - world.y, lookAt.x - world.x);
		expect(resolveHeading(pose, true)).toBeCloseTo(expected, 10);

		// From a different position the skater still faces the same map point.
		const world2 = fromTrack(8, 0.5);
		const pose2: EntityPose = { id: 'e1', S: 8, u: 0.5, heading: 0, headingMode: 'pinned', lookAt };
		const expected2 = Math.atan2(lookAt.y - world2.y, lookAt.x - world2.x);
		expect(resolveHeading(pose2, true)).toBeCloseTo(expected2, 10);
	});

	it('fixed mode: facing is an absolute angle frozen on the canvas', () => {
		const fixedHeading = 1.23; // an arbitrary absolute world angle
		const pose: EntityPose = {
			id: 'e1',
			S: 4,
			u: 0.5,
			heading: fixedHeading,
			headingMode: 'fixed'
		};
		// The same absolute heading is returned regardless of position.
		expect(resolveHeading(pose, true)).toBeCloseTo(fixedHeading, 10);
		const pose2: EntityPose = {
			id: 'e1',
			S: 20,
			u: 0.2,
			heading: fixedHeading,
			headingMode: 'fixed'
		};
		expect(resolveHeading(pose2, true)).toBeCloseTo(fixedHeading, 10);
		// And it does not follow the track tangent at that spot.
		expect(resolveHeading(pose, true)).not.toBeCloseTo(autoHeadingAt(4), 5);
	});
});

describe('resolveHeadings', () => {
	it('resolves every step from the track tangent (auto)', () => {
		const steps: EntityPose[][] = [
			[
				{ id: 'e1', S: 0, u: 0.5, heading: 0 },
				{ id: 'e2', S: 1, u: 0.4, heading: 0 }
			],
			[
				{ id: 'e1', S: 10, u: 0.5, heading: 0 },
				{ id: 'e2', S: 11, u: 0.6, heading: 0 }
			]
		];

		const resolved = resolveHeadings(steps, true);

		expect(resolved[0][0].heading).toBeCloseTo(autoHeadingAt(0), 10);
		expect(resolved[0][1].heading).toBeCloseTo(autoHeadingAt(1), 10);
		expect(resolved[1][0].heading).toBeCloseTo(autoHeadingAt(10), 10);
		expect(resolved[1][1].heading).toBeCloseTo(autoHeadingAt(11), 10);
	});

	it('keeps manual headings sticky across steps', () => {
		const steps: EntityPose[][] = [
			[
				{ id: 'e1', S: 0, u: 0.5, heading: 0 },
				{ id: 'e2', S: 0, u: 0.4, heading: 0, manualHeading: true }
			],
			[
				{ id: 'e1', S: 10, u: 0.5, heading: 0 },
				{ id: 'e2', S: 10, u: 0.6, heading: Math.PI, manualHeading: true }
			]
		];

		const resolved = resolveHeadings(steps, true);

		// e2 keeps its authored manual heading at each step.
		expect(resolved[0][1].heading).toBe(0);
		expect(resolved[1][1].heading).toBe(Math.PI);
	});

	it('uses stored heading for all poses when autoFace is false', () => {
		const steps: EntityPose[][] = [
			[
				{ id: 'e1', S: 0, u: 0.5, heading: 0 },
				{ id: 'e2', S: 0, u: 0.4, heading: Math.PI }
			]
		];

		const resolved = resolveHeadings(steps, false);

		expect(resolved[0][0].heading).toBe(0);
		expect(resolved[0][1].heading).toBe(Math.PI);
	});

	it('the arrival (last) step keeps the same facing — no end-of-move change', () => {
		// A skater arriving at their destination faces along the track there,
		// identical to a pose placed at that same S. No snap at the end.
		const destination: EntityPose = { id: 'e1', S: 7, u: 0.5, heading: 0 };
		const steps: EntityPose[][] = [[{ ...destination }], [{ ...destination }]];

		const resolved = resolveHeadings(steps, true);

		expect(resolved[1][0].heading).toBeCloseTo(autoHeadingAt(7), 10);
		expect(resolved[1][0].heading).toBe(resolved[0][0].heading);
	});

	it('handles empty steps array', () => {
		expect(resolveHeadings([], true)).toEqual([]);
	});

	it('does not mutate input steps', () => {
		const steps: EntityPose[][] = [[{ id: 'e1', S: 0, u: 0.5, heading: 0 }]];
		const original = steps[0][0].heading;
		resolveHeadings(steps, true);
		expect(steps[0][0].heading).toBe(original);
	});
});

describe('motionHeading (captured-clip replay)', () => {
	it('computes bearing from consecutive samples', () => {
		const heading = motionHeading(0, 10, 0, 0.5);
		expect(typeof heading).toBe('number');
		expect(Number.isFinite(heading)).toBe(true);
	});

	it('holds fallback when at rest (no motion)', () => {
		const fallback = Math.PI / 4;
		expect(motionHeading(0, 0, fallback, 0.5)).toBe(fallback);
	});

	it('holds fallback for very small displacements', () => {
		const fallback = Math.PI / 2;
		expect(motionHeading(0, 0.0000001, fallback, 0.5)).toBe(fallback);
	});

	it('derives a new heading when there is motion', () => {
		const heading = motionHeading(0, 10, Math.PI / 4, 0.5);
		expect(heading).not.toBe(Math.PI / 4); // moved off the fallback
	});
});
