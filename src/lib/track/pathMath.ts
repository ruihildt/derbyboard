import type { TrackPoint } from '$lib/doc/types';
import { unwrap, fromTrack, toTrack, LAP_LENGTH } from '$lib/track/trackFrame';
import type { MeterPoint } from '$lib/trackMath';

/**
 * Ramer–Douglas–Peucker simplification in metre space. Projects each TrackPoint to metres,
 * simplifies, returns the surviving TrackPoints. `epsilon` is in metres (default 0.15 m ≈ 6 in).
 * Also reused by P7 captured-clip decimation — keep it generic over the metre projection here.
 *
 * If `maxPoints` is given and the epsilon result exceeds it, the result is further reduced to
 * exactly `maxPoints` by repeatedly removing the least-significant interior point (see
 * `reduceToN`), always preserving both endpoints. Used to cap authored movement paths.
 */
export function simplify(points: TrackPoint[], epsilon = 0.15, maxPoints?: number): TrackPoint[] {
	const result = rdpByEpsilon(points, epsilon);
	if (maxPoints !== undefined && result.length > maxPoints) {
		return reduceToN(result, Math.max(2, maxPoints));
	}
	return result;
}

function rdpByEpsilon(points: TrackPoint[], epsilon: number): TrackPoint[] {
	if (points.length <= 2) return points.map((p) => ({ ...p }));

	const metrePoints = points.map((p) => fromTrack(p.S, p.u));
	const start = metrePoints[0];
	const end = metrePoints[metrePoints.length - 1];

	let maxDist = 0;
	let maxIdx = 0;
	for (let i = 1; i < metrePoints.length - 1; i++) {
		const dist = perpendicularDistance(metrePoints[i], start, end);
		if (dist > maxDist) {
			maxDist = dist;
			maxIdx = i;
		}
	}

	if (maxDist > epsilon) {
		const left = rdpByEpsilon(points.slice(0, maxIdx + 1), epsilon);
		const right = rdpByEpsilon(points.slice(maxIdx), epsilon);
		return [...left.slice(0, -1), ...right];
	} else {
		return [points[0], points[points.length - 1]].map((p) => ({ ...p }));
	}
}

/**
 * Reduces a polyline to at most `n` points by repeatedly removing the interior point whose
 * removal distorts the curve the least (smallest perpendicular deviation to the chord through
 * its nearest kept neighbours). Both endpoints are always preserved, so the most geometrically
 * significant control points survive — preserving the path's character under the point cap.
 */
function reduceToN(points: TrackPoint[], n: number): TrackPoint[] {
	if (points.length <= n || n < 2) return points.map((p) => ({ ...p }));

	const metre = points.map((p) => fromTrack(p.S, p.u));
	const keep = new Array(points.length).fill(true);

	let kept = points.length;
	while (kept > n) {
		let worstIdx = -1;
		let worstDev = Infinity;
		let prevKept = 0;
		for (let i = 1; i < points.length; i++) {
			if (!keep[i]) continue;
			if (i < points.length - 1) {
				let nextKept = i + 1;
				while (nextKept < points.length - 1 && !keep[nextKept]) nextKept++;
				const dev = perpendicularDistance(metre[i], metre[prevKept], metre[nextKept]);
				if (dev < worstDev) {
					worstDev = dev;
					worstIdx = i;
				}
			}
			prevKept = i;
		}
		if (worstIdx < 0) break;
		keep[worstIdx] = false;
		kept--;
	}

	const out: TrackPoint[] = [];
	for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ ...points[i] });
	return out;
}

/**
 * Constrains a proposed node position `p` (metres) so the total length of the path segment(s)
 * incident to it stays within `budget` metres. `a` is the previous node; `b` is the next node,
 * or `null` when `p` is the path endpoint (only one incident segment). Used to enforce
 * `MAX_PATH_LENGTH_M` while a path node is dragged.
 *
 * - If `p` already fits the budget it is returned unchanged.
 * - Otherwise `p` is moved toward the focus midpoint (interior node) or toward `a` (endpoint)
 *   until the incident length equals the budget (binary search). The sum of distances to two
 *   foci is convex and globally minimised on the segment between them, so the search is exact.
 * - Over-constrained (budget below the straight-line distance between the neighbours): returns
 *   the focus midpoint / `a`, the position that minimises the incident length.
 */
export function clampNodeToBudget(
	a: MeterPoint,
	b: MeterPoint | null,
	p: MeterPoint,
	budget: number
): MeterPoint {
	const incident = (q: MeterPoint): number => {
		const dA = Math.hypot(q.x - a.x, q.y - a.y);
		const dB = b ? Math.hypot(q.x - b.x, q.y - b.y) : 0;
		return dA + dB;
	};

	if (incident(p) <= budget) return { x: p.x, y: p.y };

	const anchor: MeterPoint = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: a.x, y: a.y };

	// Binary search the boundary incident == budget along the segment p→anchor.
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		const q: MeterPoint = {
			x: p.x + (anchor.x - p.x) * mid,
			y: p.y + (anchor.y - p.y) * mid
		};
		if (incident(q) > budget) lo = mid;
		else hi = mid;
	}
	return { x: p.x + (anchor.x - p.x) * hi, y: p.y + (anchor.y - p.y) * hi };
}

function perpendicularDistance(pt: MeterPoint, lineStart: MeterPoint, lineEnd: MeterPoint): number {
	const dx = lineEnd.x - lineStart.x;
	const dy = lineEnd.y - lineStart.y;
	const mag = Math.sqrt(dx * dx + dy * dy);
	if (mag === 0) return Math.sqrt((pt.x - lineStart.x) ** 2 + (pt.y - lineStart.y) ** 2);

	const nx = -dy / mag;
	const ny = dx / mag;
	const dist = Math.abs((pt.x - lineStart.x) * nx + (pt.y - lineStart.y) * ny);
	return dist;
}

/**
 * Catmull-Rom spline through the given TrackPoints, producing `samplesPerSegment` equally-spaced
 * (in parameter, NOT arc length) interpolated points per input segment. Endpoints are preserved
 * (first/last input points are the first/last output points). Tension 0.5 (centripetal optional;
 * keep uniform Catmull-Rom for simplicity unless tests fail).
 * Returns a NEW array of TrackPoints (wrapped S preserved per point).
 */
export function catmullRom(points: TrackPoint[], samplesPerSegment = 8): TrackPoint[] {
	if (points.length < 2) return points.map((p) => ({ ...p }));

	const metrePoints = points.map((p) => fromTrack(p.S, p.u));
	const result: TrackPoint[] = [];

	for (let i = 0; i < metrePoints.length - 1; i++) {
		const p0 = metrePoints[Math.max(0, i - 1)];
		const p1 = metrePoints[i];
		const p2 = metrePoints[Math.min(metrePoints.length - 1, i + 1)];
		const p3 = metrePoints[Math.min(metrePoints.length - 1, i + 2)];

		for (let j = 0; j < samplesPerSegment; j++) {
			const t = j / samplesPerSegment;
			const interpolated = catmullRomInterpolate(p0, p1, p2, p3, t);
			const trackPos = toTrack(interpolated);
			result.push({ S: trackPos.s, u: trackPos.u });
		}
	}

	result.push(points[points.length - 1]);
	return result;
}

function catmullRomInterpolate(
	p0: MeterPoint,
	p1: MeterPoint,
	p2: MeterPoint,
	p3: MeterPoint,
	t: number
): MeterPoint {
	const t2 = t * t;
	const t3 = t2 * t;

	const x =
		0.5 *
		(2 * p1.x +
			(-p0.x + p2.x) * t +
			(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
			(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

	const y =
		0.5 *
		(2 * p1.y +
			(-p0.y + p2.y) * t +
			(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
			(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

	return { x, y };
}

/**
 * Builds a cumulative arc-length table over the (already smoothed) points, measured in metres via
 * fromTrack. Returns an object with the points and a parallel cumulative-distance array starting at 0.
 */
export interface ArcLengthPath {
	points: TrackPoint[];
	cum: number[];
	total: number;
}

export function buildArcLength(points: TrackPoint[]): ArcLengthPath {
	if (points.length === 0) {
		return { points: [], cum: [], total: 0 };
	}

	const cum = [0];
	const metrePoints = points.map((p) => fromTrack(p.S, p.u));

	for (let i = 1; i < metrePoints.length; i++) {
		const dx = metrePoints[i].x - metrePoints[i - 1].x;
		const dy = metrePoints[i].y - metrePoints[i - 1].y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		cum.push(cum[cum.length - 1] + dist);
	}

	return { points, cum, total: cum[cum.length - 1] };
}

/**
 * Samples the arc-length-parametrised path at distance `d` metres (0 ≤ d ≤ total). Linear
 * interpolation of S and u between the two bracketing points; S interpolated via unwrap across the
 * seam so a path crossing s=0 stays continuous. Returns { S, u } in track space (wrapped).
 */
export function sampleAtArcLength(path: ArcLengthPath, d: number): TrackPoint {
	if (path.points.length === 0) return { S: 0, u: 0.5 };
	if (path.points.length === 1) return path.points[0];

	const clampedD = Math.max(0, Math.min(d, path.total));

	if (clampedD === 0) return path.points[0];
	if (clampedD === path.total) return path.points[path.points.length - 1];

	let idx = 0;
	for (let i = 0; i < path.cum.length - 1; i++) {
		if (clampedD >= path.cum[i] && clampedD <= path.cum[i + 1]) {
			idx = i;
			break;
		}
	}

	const segmentDist = path.cum[idx + 1] - path.cum[idx];
	if (segmentDist === 0) return path.points[idx];

	const localT = (clampedD - path.cum[idx]) / segmentDist;
	const p0 = path.points[idx];
	const p1 = path.points[idx + 1];

	const unwrappedS = unwrap(p0.S, p1.S);
	const S = (((p0.S + localT * (unwrappedS - p0.S)) % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
	const u = p0.u + localT * (p1.u - p0.u);

	return { S, u };
}

/**
 * Unit tangent of the path at normalised fraction `f` (0 ≤ f ≤ 1), as a metre-space direction
 * {x,y}. Computed from a small central difference of sampleAtArcLength around f. Used for
 * heading-derivation during path playback when autoFace is on.
 */
export function pathTangentAt(path: ArcLengthPath, f: number): MeterPoint {
	if (path.points.length < 2 || path.total === 0) {
		return { x: 1, y: 0 };
	}

	const clampedF = Math.max(0, Math.min(1, f));
	const d = clampedF * path.total;

	const h = Math.max(path.total * 0.01, 0.05);
	const d0 = Math.max(0, d - h);
	const d1 = Math.min(path.total, d + h);

	const p0 = sampleAtArcLength(path, d0);
	const p1 = sampleAtArcLength(path, d1);

	const m0 = fromTrack(p0.S, p0.u);
	const m1 = fromTrack(p1.S, p1.u);

	const dx = m1.x - m0.x;
	const dy = m1.y - m0.y;
	const mag = Math.sqrt(dx * dx + dy * dy);

	if (mag === 0) {
		return { x: 1, y: 0 };
	}

	return { x: dx / mag, y: dy / mag };
}
