import { describe, it, expect } from 'vitest';
import { LAP_LENGTH } from '$lib/track/trackFrame';
import {
	tweenPose,
	tweenSteps,
	tweenPoseAlong,
	resolveStepPaths,
	transitionDistanceMeters,
	buildTimeline,
	sampleAuthoredAt,
	nearestStepAt,
	easeInOutCubic,
	STEP_DURATION_MS
} from './tween';
import type { EntityPose, Step } from '$lib/doc/types';

function pose(id: string, S: number, u = 0.5, heading = 0): EntityPose {
	return { id, S, u, heading };
}

describe('easeInOutCubic', () => {
	it('is 0 at start and 1 at end', () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(1)).toBeCloseTo(1, 6);
	});

	it('is monotonic non-decreasing', () => {
		let prev = -Infinity;
		for (let i = 0; i <= 20; i++) {
			const v = easeInOutCubic(i / 20);
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
	});
});

describe('tweenPose', () => {
	it('lerps S and u linearly (no easing option) along the straight', () => {
		const r = tweenPose(pose('a', 10, 0.4), pose('a', 20, 0.6), 0.5);
		expect(r.S).toBeCloseTo(15, 6);
		expect(r.u).toBeCloseTo(0.5, 6);
	});

	it('at f=0 returns the from pose and at f=1 the to pose', () => {
		const a = pose('a', 10, 0.4, 0.2);
		const b = pose('a', 20, 0.6, 1.2);
		expect(tweenPose(a, b, 0)).toEqual(a);
		expect(tweenPose(a, b, 1)).toEqual({ ...b, heading: b.heading });
		expect(tweenPose(a, b, 1).S).toBeCloseTo(20, 6);
	});

	it('crosses the seam forward (short way) when to is just past s=0', () => {
		// from near end of lap, to near start: shortest path is forward across seam.
		const fromS = LAP_LENGTH - 5;
		const toS = 5;
		const mid = tweenPose(pose('a', fromS), pose('a', toS), 0.5);
		// Midpoint arc should be near LAP_LENGTH (forward path), not near 0 (backward).
		expect(mid.S).toBeCloseTo(LAP_LENGTH, 0);
	});

	it('does not cut the infield by going the long way backward', () => {
		// from=5, to=LAP_LENGTH-5: shortest is backward across seam (wraps to ~0).
		const mid = tweenPose(pose('a', 5), pose('a', LAP_LENGTH - 5), 0.5);
		// The covering-space midpoint is ~0 (just before the seam), never ~LAP_LENGTH/2.
		expect(Math.abs(mid.S)).toBeLessThan(LAP_LENGTH / 4);
	});

	it('interpolates heading along the shortest rotational direction', () => {
		// From just below +π to just above -π: the short path crosses the ±π
		// boundary (Δ ≈ +0.2). A naive lerp would spin ~2π the long way and
		// land the midpoint near 0; the correct short path keeps it near ±π.
		const a = pose('a', 10, 0.5, Math.PI - 0.1);
		const b = pose('a', 10, 0.5, -Math.PI + 0.1);
		const mid = tweenPose(a, b, 0.5);
		expect(Math.abs(mid.heading)).toBeGreaterThan(2.9);
		// And the total rotation magnitude is tiny (≈0.2), never ≈2π.
		const end = tweenPose(a, b, 1);
		const totalRotation = Math.abs(((end.heading - a.heading + Math.PI) % (2 * Math.PI)) - Math.PI);
		expect(totalRotation).toBeLessThan(0.3);
	});
});

describe('tweenSteps', () => {
	it('tweens entities present in both by id', () => {
		const from = [pose('a', 0, 0), pose('b', 10, 1)];
		const to = [pose('a', 10, 1), pose('b', 20, 0)];
		const r = tweenSteps(from, to, 0.5);
		expect(r).toHaveLength(2);
		expect(r.find((p) => p.id === 'a')?.S).toBeCloseTo(5, 6);
		expect(r.find((p) => p.id === 'b')?.S).toBeCloseTo(15, 6);
	});

	it('snaps entities present in only one endpoint', () => {
		const from = [pose('a', 0, 0)];
		const to = [pose('a', 10, 1), pose('b', 20, 0)];
		const r = tweenSteps(from, to, 0.5);
		expect(r.find((p) => p.id === 'a')?.S).toBeCloseTo(5, 6);
		// 'b' only exists in `to` -> snapped to its target pose, not invented.
		expect(r.find((p) => p.id === 'b')?.S).toBe(20);
	});
});

describe('transitionDistanceMeters', () => {
	it('is the max arc distance over entities', () => {
		const from = [pose('a', 0), pose('b', 0)];
		const to = [pose('a', 3), pose('b', 7)];
		expect(transitionDistanceMeters(from, to)).toBeCloseTo(7, 4);
	});

	it('takes the shortest arc across the seam', () => {
		const from = [pose('a', LAP_LENGTH - 1)];
		const to = [pose('a', 1)];
		// Shortest distance across seam is 2 m, not LAP_LENGTH - 2.
		expect(transitionDistanceMeters(from, to)).toBeCloseTo(2, 4);
	});
});

describe('buildTimeline', () => {
	it('produces N segments for N steps (one per step)', () => {
		const steps = [
			{ entities: [pose('a', 0)] },
			{ entities: [pose('a', 5)] },
			{ entities: [pose('a', 10)] }
		];
		const tl = buildTimeline(steps);
		expect(tl.stepCount).toBe(3);
		expect(tl.segments).toHaveLength(3);
		expect(tl.segments[0].fromStep).toBe(0);
		expect(tl.segments[1].fromStep).toBe(1);
		expect(tl.segments[2].fromStep).toBe(2);
	});

	it('places segments back-to-back with fixed 1-second durations', () => {
		const steps = [
			{ entities: [pose('a', 0)] },
			{ entities: [pose('a', 5)] },
			{ entities: [pose('a', 15)] }
		];
		const tl = buildTimeline(steps);
		expect(tl.segments[0].durationMs).toBe(STEP_DURATION_MS);
		expect(tl.segments[1].startMs).toBe(STEP_DURATION_MS);
		expect(tl.totalMs).toBe(3 * STEP_DURATION_MS);
	});

	it('gives a single step 1 second of duration (so playback works)', () => {
		const tl = buildTimeline([{ entities: [pose('a', 0)] }]);
		expect(tl.segments).toHaveLength(1);
		expect(tl.totalMs).toBe(STEP_DURATION_MS);
	});

	it('ignores holdMs under the fixed-duration model', () => {
		const steps = [
			{ entities: [pose('a', 0)], holdMs: 100 },
			{ entities: [pose('a', 5)], holdMs: 200 }
		];
		const tl = buildTimeline(steps);
		expect(tl.segments[0].startMs).toBe(0);
		expect(tl.totalMs).toBe(2 * STEP_DURATION_MS);
	});
});

describe('sampleAuthoredAt', () => {
	it('returns the first step at/before t=0', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		expect(sampleAuthoredAt(tl, steps, 0)[0].S).toBe(0);
		expect(sampleAuthoredAt(tl, steps, -5)[0].S).toBe(0);
	});

	it('returns the last step pose at/after the end', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		expect(sampleAuthoredAt(tl, steps, tl.totalMs)[0].S).toBe(10);
		expect(sampleAuthoredAt(tl, steps, tl.totalMs + 999)[0].S).toBe(10);
	});

	it('interpolates midway through a step', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		const mid = sampleAuthoredAt(tl, steps, STEP_DURATION_MS / 2);
		// Eased midpoint is not exactly 5, but lies strictly between 0 and 10.
		expect(mid[0].S).toBeGreaterThan(0);
		expect(mid[0].S).toBeLessThan(10);
	});

	it('dwells on the last step when it has no path', () => {
		// A single step with no path: the entity stays at its pose for the
		// full second (from === to, so f doesn't matter).
		const steps = [[pose('a', 7)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		const atMid = sampleAuthoredAt(tl, steps, STEP_DURATION_MS / 2);
		expect(atMid[0].S).toBe(7);
		const atEnd = sampleAuthoredAt(tl, steps, tl.totalMs);
		expect(atEnd[0].S).toBe(7);
	});

	it('follows a path on the last step toward the path endpoint (single-step playback)', () => {
		// Single step with a path: entity should move from its pose toward
		// the path's last point during the 1-second playback.
		const a = pose('a', 0, 0.5);
		const pathPoints = [
			{ S: 0, u: 0.5 },
			{ S: 3, u: 0.5 },
			{ S: 6, u: 0.5 }
		];
		const step: Step = {
			id: 's0',
			entities: [a],
			paths: [{ id: 'p', entityId: 'a', points: pathPoints }]
		};
		const steps = [step.entities];
		const tl = buildTimeline([{ entities: step.entities }]);
		const stepMaps = [resolveStepPaths(step, undefined)];

		// At t=0, entity is at its pose (S=0).
		const start = sampleAuthoredAt(tl, steps, 0, stepMaps);
		expect(start[0].S).toBe(0);

		// At the midpoint, entity should be moving along the path.
		const mid = sampleAuthoredAt(tl, steps, STEP_DURATION_MS / 2, stepMaps);
		expect(mid[0].S).toBeGreaterThan(0);
		expect(mid[0].S).toBeLessThan(6);

		// At the end, entity is at the path's last point (S=6).
		const end = sampleAuthoredAt(tl, steps, tl.totalMs, stepMaps);
		expect(end[0].S).toBeCloseTo(6, 4);
	});
});

describe('nearestStepAt', () => {
	it('clamps to the first/last step at the ends', () => {
		const steps = [[pose('a', 0)], [pose('a', 5)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		expect(nearestStepAt(tl, 0)).toBe(0);
		expect(nearestStepAt(tl, tl.totalMs)).toBe(2);
	});

	it('tips to the arrival step at the transition midpoint', () => {
		const steps = [[pose('a', 0)], [pose('a', 5)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		const mid = tl.segments[0].startMs + tl.segments[0].durationMs / 2;
		expect(nearestStepAt(tl, mid - 1)).toBe(0);
		expect(nearestStepAt(tl, mid + 1)).toBe(1);
	});
});

describe('resolveStepPaths — endpoint injection', () => {
	function stepWithPath(
		entityId: string,
		fromS: number,
		fromU: number,
		toS: number,
		toU: number,
		pathPoints: { S: number; u: number }[]
	): Step {
		return {
			id: 's1',
			entities: [{ id: entityId, S: fromS, u: fromU, heading: 0 }],
			paths: [{ id: 'p1', entityId, points: pathPoints }]
		};
	}

	it('injects the FROM-step pose as the path start point', () => {
		const step = stepWithPath('a', 10, 0.5, 20, 0.5, [
			{ S: 0, u: 0.5 },
			{ S: 5, u: 0.5 },
			{ S: 15, u: 0.5 }
		]);
		const nextStep: Step = {
			id: 's2',
			entities: [{ id: 'a', S: 20, u: 0.5, heading: 0 }]
		};
		const maps = resolveStepPaths(step, nextStep);
		const arcPath = maps.get('a');
		expect(arcPath).toBeDefined();
		// First point should be the FROM-step pose (S=10), not the drawn S=0
		expect(arcPath!.points[0].S).toBe(10);
	});

	it('injects the TO-step pose as the path end point', () => {
		const step = stepWithPath('a', 10, 0.5, 20, 0.5, [
			{ S: 10, u: 0.5 },
			{ S: 15, u: 0.5 },
			{ S: 99, u: 0.9 } // garbage endpoint
		]);
		const nextStep: Step = {
			id: 's2',
			entities: [{ id: 'a', S: 20, u: 0.5, heading: 0 }]
		};
		const maps = resolveStepPaths(step, nextStep);
		const arcPath = maps.get('a');
		expect(arcPath).toBeDefined();
		// Last point should be the TO-step pose (S=20), not the drawn S=99
		const last = arcPath!.points[arcPath!.points.length - 1];
		expect(last.S).toBe(20);
		expect(last.u).toBe(0.5);
	});

	it('updates endpoints when step poses change (always in sync)', () => {
		const step = stepWithPath('a', 10, 0.5, 20, 0.5, [
			{ S: 10, u: 0.5 },
			{ S: 15, u: 0.5 },
			{ S: 20, u: 0.5 }
		]);
		const nextStep: Step = {
			id: 's2',
			entities: [{ id: 'a', S: 20, u: 0.5, heading: 0 }]
		};

		// Modify the TO-step pose
		nextStep.entities[0].S = 25;
		nextStep.entities[0].u = 0.8;

		const maps = resolveStepPaths(step, nextStep);
		const arcPath = maps.get('a')!;
		const last = arcPath.points[arcPath.points.length - 1];
		expect(last.S).toBe(25);
		expect(last.u).toBe(0.8);
	});
});

describe('tweenPoseAlong — path-following playback', () => {
	it('follows the path at intermediate fractions (not a straight lerp)', () => {
		// Step 0: a@S=0,u=0.9 (outside lane). Step 1: a@S=10,u=0.1 (inside lane).
		// Path dips to u=0.5 in the middle — a straight lerp would be at u=0.5
		// at f=0.5 too, but the path's shape makes the MIDPOINT different.
		const a = pose('a', 0, 0.9);
		const b = pose('a', 10, 0.1);

		// Build a path with a curve that deviates from the straight line
		const pathPoints = [
			{ S: 0, u: 0.9 },
			{ S: 2, u: 0.3 }, // dips inside early
			{ S: 5, u: 0.2 },
			{ S: 8, u: 0.15 },
			{ S: 10, u: 0.1 }
		];

		const step: Step = {
			id: 's0',
			entities: [a],
			paths: [{ id: 'p', entityId: 'a', points: pathPoints }]
		};
		const nextStep: Step = { id: 's1', entities: [b] };

		const maps = resolveStepPaths(step, nextStep);
		const arcPath = maps.get('a')!;

		// At f=0.5, the path sample should differ from the straight lerp
		const alongResult = tweenPoseAlong(a, b, 0.5, arcPath, false);
		const straightResult = tweenPose(a, b, 0.5);

		// The u values should differ because the path curves differently
		// than the straight lerp at that point.
		expect(Math.abs(alongResult.u - straightResult.u)).toBeGreaterThan(0.01);
	});

	it('clamps endpoints exactly to step poses', () => {
		const a = pose('a', 5, 0.5);
		const b = pose('a', 15, 0.5);
		const pathPoints = [
			{ S: 0, u: 0.5 },
			{ S: 10, u: 0.5 },
			{ S: 20, u: 0.5 }
		];
		const step: Step = {
			id: 's0',
			entities: [a],
			paths: [{ id: 'p', entityId: 'a', points: pathPoints }]
		};
		const nextStep: Step = { id: 's1', entities: [b] };
		const maps = resolveStepPaths(step, nextStep);
		const arcPath = maps.get('a')!;

		const atStart = tweenPoseAlong(a, b, 0, arcPath, false);
		const atEnd = tweenPoseAlong(a, b, 1, arcPath, false);
		expect(atStart.S).toBe(5);
		expect(atEnd.S).toBe(15);
	});

	it('falls back to straight tween when no path exists', () => {
		const a = pose('a', 0, 0.5);
		const b = pose('a', 10, 0.5);
		const alongResult = tweenPoseAlong(a, b, 0.5, undefined, false);
		const straightResult = tweenPose(a, b, 0.5);
		expect(alongResult.S).toBeCloseTo(straightResult.S, 6);
		expect(alongResult.u).toBeCloseTo(straightResult.u, 6);
	});
});
