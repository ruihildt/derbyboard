import { describe, it, expect } from 'vitest';
import {
	simplify,
	catmullRom,
	buildArcLength,
	sampleAtArcLength,
	pathTangentAt,
	clampNodeToBudget
} from './pathMath';
import type { TrackPoint } from '$lib/doc/types';
import { fromTrack, tangentAt, LAP_LENGTH } from '$lib/track/trackFrame';

function tp(S: number, u: number): TrackPoint {
	return { S, u };
}

describe('pathMath — simplify', () => {
	it('preserves endpoints', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5), tp(3, 0.5)];
		const simplified = simplify(points, 0.1);
		expect(simplified[0]).toEqual(points[0]);
		expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
	});

	it('removes collinear-ish interior points below tolerance', () => {
		const points = [tp(0, 0.5), tp(0.5, 0.5), tp(1, 0.5), tp(1.5, 0.5), tp(2, 0.5)];
		const simplified = simplify(points, 0.1);
		expect(simplified.length).toBeLessThan(points.length);
		expect(simplified[0]).toEqual(points[0]);
		expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
	});

	it('keeps sharp corners', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(1, 0.9), tp(2, 0.9)];
		const simplified = simplify(points, 0.1);
		expect(simplified.length).toBeGreaterThanOrEqual(3);
	});

	it('returns as-is for 2 points or fewer', () => {
		const single = [tp(0, 0.5)];
		expect(simplify(single)).toEqual([tp(0, 0.5)]);
		const pair = [tp(0, 0.5), tp(1, 0.5)];
		expect(simplify(pair)).toEqual([tp(0, 0.5), tp(1, 0.5)]);
	});
});

describe('pathMath — catmullRom', () => {
	it('preserves endpoints exactly', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const smoothed = catmullRom(points, 8);
		expect(smoothed[0].S).toBeCloseTo(points[0].S, 6);
		expect(smoothed[0].u).toBeCloseTo(points[0].u, 6);
		expect(smoothed[smoothed.length - 1].S).toBeCloseTo(points[2].S, 6);
		expect(smoothed[smoothed.length - 1].u).toBeCloseTo(points[2].u, 6);
	});

	it('produces expected output length', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const smoothed = catmullRom(points, 8);
		expect(smoothed.length).toBe((points.length - 1) * 8 + 1);
	});

	it('produces smooth curves (second differences small)', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5), tp(3, 0.5)];
		const smoothed = catmullRom(points, 8);
		const metrePoints = smoothed.map((p) => fromTrack(p.S, p.u));

		let maxSecondDiff = 0;
		for (let i = 2; i < metrePoints.length; i++) {
			const firstDiff = {
				x: metrePoints[i].x - metrePoints[i - 1].x,
				y: metrePoints[i].y - metrePoints[i - 1].y
			};
			const prevFirstDiff = {
				x: metrePoints[i - 1].x - metrePoints[i - 2].x,
				y: metrePoints[i - 1].y - metrePoints[i - 2].y
			};
			const secondDiff = Math.abs(firstDiff.x - prevFirstDiff.x + firstDiff.y - prevFirstDiff.y);
			maxSecondDiff = Math.max(maxSecondDiff, secondDiff);
		}

		expect(maxSecondDiff).toBeLessThan(0.1);
	});
});

describe('pathMath — buildArcLength', () => {
	it('produces non-decreasing cumulative distances', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		for (let i = 1; i < path.cum.length; i++) {
			expect(path.cum[i]).toBeGreaterThanOrEqual(path.cum[i - 1]);
		}
	});

	it('cum[0] is 0', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		expect(path.cum[0]).toBe(0);
	});

	it('total equals cum[last]', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		expect(path.total).toBe(path.cum[path.cum.length - 1]);
	});

	it('total approximates sum of metre distances', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);

		let manualSum = 0;
		for (let i = 1; i < points.length; i++) {
			const m0 = fromTrack(points[i - 1].S, points[i - 1].u);
			const m1 = fromTrack(points[i].S, points[i].u);
			const dist = Math.sqrt((m1.x - m0.x) ** 2 + (m1.y - m0.y) ** 2);
			manualSum += dist;
		}

		expect(path.total).toBeCloseTo(manualSum, 4);
	});

	it('handles empty input', () => {
		const path = buildArcLength([]);
		expect(path.points).toEqual([]);
		expect(path.cum).toEqual([]);
		expect(path.total).toBe(0);
	});
});

describe('pathMath — sampleAtArcLength', () => {
	it('d=0 returns first point', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		const sampled = sampleAtArcLength(path, 0);
		expect(sampled.S).toBeCloseTo(points[0].S, 6);
		expect(sampled.u).toBeCloseTo(points[0].u, 6);
	});

	it('d=total returns last point', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		const sampled = sampleAtArcLength(path, path.total);
		expect(sampled.S).toBeCloseTo(points[points.length - 1].S, 6);
		expect(sampled.u).toBeCloseTo(points[points.length - 1].u, 6);
	});

	it('produces uniform-speed sampling', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);

		const metrePositions: Array<{ x: number; y: number }> = [];
		for (let i = 0; i <= 10; i++) {
			const d = (i / 10) * path.total;
			const sampled = sampleAtArcLength(path, d);
			metrePositions.push(fromTrack(sampled.S, sampled.u));
		}

		const distances: number[] = [];
		for (let i = 1; i < metrePositions.length; i++) {
			const dx = metrePositions[i].x - metrePositions[i - 1].x;
			const dy = metrePositions[i].y - metrePositions[i - 1].y;
			distances.push(Math.sqrt(dx * dx + dy * dy));
		}

		const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
		const maxDeviation = Math.max(...distances.map((d) => Math.abs(d - meanDist)));
		const deviationRatio = maxDeviation / meanDist;

		expect(deviationRatio).toBeLessThan(0.05);
	});

	it('clamps d to [0, total]', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		const under = sampleAtArcLength(path, -1);
		const over = sampleAtArcLength(path, path.total * 2);
		expect(under.S).toBeCloseTo(points[0].S, 6);
		expect(over.S).toBeCloseTo(points[points.length - 1].S, 6);
	});

	it('handles single-point path', () => {
		const points = [tp(0, 0.5)];
		const path = buildArcLength(points);
		const sampled = sampleAtArcLength(path, 0.5);
		expect(sampled.S).toBe(points[0].S);
		expect(sampled.u).toBe(points[0].u);
	});
});

describe('pathMath — pathTangentAt', () => {
	it('returns a unit vector on a non-degenerate path', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		const tangent = pathTangentAt(path, 0.5);
		const mag = Math.sqrt(tangent.x ** 2 + tangent.y ** 2);
		expect(mag).toBeCloseTo(1, 3);
	});

	it('sign is consistent with path direction', () => {
		const points = [tp(0, 0.5), tp(1, 0.5), tp(2, 0.5)];
		const path = buildArcLength(points);
		const tangent = pathTangentAt(path, 0.5);
		const trackTangent = tangentAt(points[1].S);
		const dot = tangent.x * trackTangent.x + tangent.y * trackTangent.y;
		expect(dot).toBeGreaterThan(0);
	});

	it('handles degenerate path', () => {
		const points = [tp(0, 0.5)];
		const path = buildArcLength(points);
		const tangent = pathTangentAt(path, 0.5);
		expect(tangent.x).toBe(1);
		expect(tangent.y).toBe(0);
	});
});

describe('pathMath — seam handling', () => {
	it('sampleAtArcLength handles seam crossing continuously', () => {
		const points = [tp(LAP_LENGTH - 1, 0.5), tp(LAP_LENGTH - 0.5, 0.5), tp(0, 0.5), tp(0.5, 0.5)];
		const path = buildArcLength(points);
		const midSample = sampleAtArcLength(path, path.total / 2);
		expect(midSample.S).toBeGreaterThanOrEqual(0);
		expect(midSample.S).toBeLessThan(LAP_LENGTH);
	});
});

describe('pathMath — simplify (maxPoints)', () => {
	// Alternating lanes form genuine corners that epsilon-RDP keeps.
	const zigzag = [
		tp(0, 0.3),
		tp(1, 0.7),
		tp(2, 0.3),
		tp(3, 0.7),
		tp(4, 0.3),
		tp(5, 0.7),
		tp(6, 0.3),
		tp(7, 0.7)
	];

	it('caps the result to maxPoints, preserving endpoints', () => {
		const simplified = simplify(zigzag, 0.01, 5);
		expect(simplified.length).toBe(5);
		expect(simplified[0]).toEqual(zigzag[0]);
		expect(simplified[simplified.length - 1]).toEqual(zigzag[zigzag.length - 1]);
	});

	it('does not trim when maxPoints is omitted', () => {
		expect(simplify(zigzag, 0.01).length).toBe(zigzag.length);
	});

	it('is a no-op when the input has fewer points than maxPoints', () => {
		// Middle point is a genuine corner (off the first-last chord) so it survives epsilon-RDP.
		const points = [tp(0, 0.5), tp(1, 0.9), tp(2, 0.5)];
		expect(simplify(points, 0.1, 5).length).toBe(3);
	});

	it('reduces to exactly the endpoints when maxPoints is 2', () => {
		const simplified = simplify(zigzag, 0.01, 2);
		expect(simplified).toEqual([zigzag[0], zigzag[zigzag.length - 1]]);
	});
});

describe('pathMath — clampNodeToBudget', () => {
	const m = (x: number, y: number) => ({ x, y });
	const incident = (
		a: { x: number; y: number },
		b: { x: number; y: number } | null,
		p: { x: number; y: number }
	) => Math.hypot(p.x - a.x, p.y - a.y) + (b ? Math.hypot(p.x - b.x, p.y - b.y) : 0);

	it('returns the point unchanged when within budget', () => {
		const p = m(5, 1);
		expect(clampNodeToBudget(m(0, 0), m(10, 0), p, 100)).toEqual(p);
	});

	it('clamps an interior node onto the budget ellipse boundary', () => {
		const out = clampNodeToBudget(m(0, 0), m(10, 0), m(5, 10), 12);
		expect(incident(m(0, 0), m(10, 0), out)).toBeCloseTo(12, 5);
		// By symmetry the clamp stays on the perpendicular bisector (x = 5).
		expect(out.x).toBeCloseTo(5, 5);
	});

	it('clamps an endpoint node to a circle of radius budget around the prev node', () => {
		const out = clampNodeToBudget(m(0, 0), null, m(10, 0), 4);
		expect(Math.hypot(out.x, out.y)).toBeCloseTo(4, 5);
		expect(out.x).toBeCloseTo(4, 5);
		expect(out.y).toBeCloseTo(0, 5);
	});

	it('falls back to the focus midpoint when over-constrained', () => {
		// Foci 10 m apart, budget 5 (< 10) is unreachable → midpoint.
		const out = clampNodeToBudget(m(0, 0), m(10, 0), m(5, 5), 5);
		expect(out.x).toBeCloseTo(5, 5);
		expect(out.y).toBeCloseTo(0, 5);
	});
});
