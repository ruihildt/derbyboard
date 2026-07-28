import { describe, it, expect } from 'vitest';
import { LAP_LENGTH } from '$lib/track/trackFrame';
import {
	tweenPose,
	tweenSteps,
	transitionDistanceMeters,
	transitionDurationMs,
	buildTimeline,
	sampleAuthoredAt,
	nearestStepAt,
	easeInOutCubic
} from './tween';
import type { EntityPose } from '$lib/doc/types';

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

describe('transitionDurationMs', () => {
	it('is zero when nothing moves', () => {
		expect(transitionDurationMs([pose('a', 5, 0.5)], [pose('a', 5, 0.5)])).toBe(0);
	});

	it('grows with distance (monotonic) within the clamp band', () => {
		const base = [pose('a', 0)];
		const small = transitionDurationMs(base, [pose('a', 2)]);
		const big = transitionDurationMs(base, [pose('a', 20)]);
		expect(big).toBeGreaterThan(small);
	});

	it('respects the minimum and maximum clamp bounds', () => {
		const tiny = transitionDurationMs([pose('a', 0)], [pose('a', 0.5)]);
		expect(tiny).toBeGreaterThanOrEqual(500);
		const huge = transitionDurationMs([pose('a', 0)], [pose('a', 1000)]);
		expect(huge).toBeLessThanOrEqual(3200);
	});
});

describe('buildTimeline', () => {
	it('produces N-1 segments for N steps', () => {
		const steps = [
			{ entities: [pose('a', 0)] },
			{ entities: [pose('a', 5)] },
			{ entities: [pose('a', 10)] }
		];
		const tl = buildTimeline(steps);
		expect(tl.stepCount).toBe(3);
		expect(tl.segments).toHaveLength(2);
		expect(tl.segments[0].fromStep).toBe(0);
		expect(tl.segments[1].fromStep).toBe(1);
	});

	it('places segments back-to-back with cumulative start times', () => {
		const steps = [
			{ entities: [pose('a', 0)] },
			{ entities: [pose('a', 5)] },
			{ entities: [pose('a', 15)] }
		];
		const tl = buildTimeline(steps);
		expect(tl.segments[1].startMs).toBe(tl.segments[0].durationMs);
		expect(tl.totalMs).toBe(tl.segments[0].durationMs + tl.segments[1].durationMs);
	});

	it('handles a single step (no transitions)', () => {
		const tl = buildTimeline([{ entities: [pose('a', 0)] }]);
		expect(tl.segments).toHaveLength(0);
		expect(tl.totalMs).toBe(0);
	});

	it('adds hold dwell before each outgoing transition and at the end', () => {
		const steps = [
			{ entities: [pose('a', 0)], holdMs: 100 },
			{ entities: [pose('a', 5)], holdMs: 200 }
		];
		const tl = buildTimeline(steps);
		// First transition starts after step 0's hold.
		expect(tl.segments[0].startMs).toBe(100);
		// Total includes step 0 hold + transition + step 1 hold.
		expect(tl.totalMs).toBe(100 + tl.segments[0].durationMs + 200);
	});
});

describe('sampleAuthoredAt', () => {
	it('returns the first step at/before t=0', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		expect(sampleAuthoredAt(tl, steps, 0)[0].S).toBe(0);
		expect(sampleAuthoredAt(tl, steps, -5)[0].S).toBe(0);
	});

	it('returns the last step at/after the end', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		expect(sampleAuthoredAt(tl, steps, tl.totalMs)[0].S).toBe(10);
		expect(sampleAuthoredAt(tl, steps, tl.totalMs + 999)[0].S).toBe(10);
	});

	it('interpolates midway through a transition', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)]];
		const tl = buildTimeline(steps.map((e) => ({ entities: e })));
		const mid = sampleAuthoredAt(tl, steps, tl.segments[0].startMs + tl.segments[0].durationMs / 2);
		// Eased midpoint is not exactly 5, but lies strictly between 0 and 10.
		expect(mid[0].S).toBeGreaterThan(0);
		expect(mid[0].S).toBeLessThan(10);
	});

	it('dwells on the arrival step during a hold', () => {
		const steps = [[pose('a', 0)], [pose('a', 10)], [pose('a', 20)]];
		const stepObjs = steps.map((e, i) => ({ entities: e, holdMs: i === 1 ? 500 : 0 }));
		const tl = buildTimeline(stepObjs);
		// Just after transition 0->1 ends, before transition 1->2 starts: step 1.
		const dwellT = tl.segments[0].startMs + tl.segments[0].durationMs + 10;
		const sampled = sampleAuthoredAt(tl, steps, dwellT);
		expect(sampled[0].S).toBe(10);
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
