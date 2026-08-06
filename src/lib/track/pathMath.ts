import type { PlanarPoint } from '$lib/doc/types';

/**
 * Ramer–Douglas–Peucker simplification in planar metre space. Operates directly
 * on the canonical planar points. `epsilon` is in metres (default 0.15 m ≈ 6 in).
 * Also reused by captured-clip decimation — keep it generic over planar points.
 *
 * If `maxPoints` is given and the epsilon result exceeds it, the result is further
 * reduced to exactly `maxPoints` by repeatedly removing the least-significant
 * interior point (see `reduceToN`), always preserving both endpoints. Used to cap
 * authored movement paths.
 */
export function simplify(points: PlanarPoint[], epsilon = 0.15, maxPoints?: number): PlanarPoint[] {
	const result = rdpByEpsilon(points, epsilon);
	if (maxPoints !== undefined && result.length > maxPoints) {
		return reduceToN(result, Math.max(2, maxPoints));
	}
	return result;
}

function rdpByEpsilon(points: PlanarPoint[], epsilon: number): PlanarPoint[] {
	if (points.length <= 2) return points.map((p) => ({ ...p }));

	const start = points[0];
	const end = points[points.length - 1];

	let maxDist = 0;
	let maxIdx = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const dist = perpendicularDistance(points[i], start, end);
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
function reduceToN(points: PlanarPoint[], n: number): PlanarPoint[] {
	if (points.length <= n || n < 2) return points.map((p) => ({ ...p }));

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
				const dev = perpendicularDistance(points[i], points[prevKept], points[nextKept]);
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

	const out: PlanarPoint[] = [];
	for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ ...points[i] });
	return out;
}

/**
 * Constrains a proposed node position `p` (metres) so the total length of the path segment(s)
 * incident to it stays within `budget` metres. `a` is the previous node (or `null` for the
 * path's first node); `b` is the next node, or `null` when `p` is the path endpoint (only one
 * incident segment). Used to enforce `MAX_PATH_LENGTH_M` while a path node is dragged.
 *
 * - If `p` already fits the budget it is returned unchanged.
 * - Otherwise `p` is moved toward the focus midpoint (interior node) or toward `a` (endpoint)
 *   until the incident length equals the budget (binary search). The sum of distances to two
 *   foci is convex and globally minimised on the segment between them, so the search is exact.
 * - Over-constrained (budget below the straight-line distance between the neighbours): returns
 *   the focus midpoint / `a`, the position that minimises the incident length.
 */
export function clampNodeToBudget(
	a: PlanarPoint | null,
	b: PlanarPoint | null,
	p: PlanarPoint,
	budget: number
): PlanarPoint {
	const incident = (q: PlanarPoint): number => {
		const dA = a ? Math.hypot(q.x - a.x, q.y - a.y) : 0;
		const dB = b ? Math.hypot(q.x - b.x, q.y - b.y) : 0;
		return dA + dB;
	};

	if (incident(p) <= budget) return { x: p.x, y: p.y };

	// Anchor toward the available neighbour(s): the midpoint of both for an
	// interior node, the single neighbour for an endpoint/start node, or p
	// itself if the node has no neighbours (single-point path).
	const anchor: PlanarPoint =
		a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : (a ?? b ?? { x: p.x, y: p.y });

	// Binary search the boundary incident == budget along the segment p→anchor.
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2;
		const q: PlanarPoint = {
			x: p.x + (anchor.x - p.x) * mid,
			y: p.y + (anchor.y - p.y) * mid
		};
		if (incident(q) > budget) lo = mid;
		else hi = mid;
	}
	return { x: p.x + (anchor.x - p.x) * hi, y: p.y + (anchor.y - p.y) * hi };
}

/**
 * Ray-casting point-in-polygon test in planar metre space. Returns true when
 * `p` lies strictly inside the polygon `poly` (a closed loop implied by
 * connecting the last vertex back to the first). Needs at least 3 vertices.
 * Used by the lasso tool to find the players enclosed by a freehand loop.
 *
 * The `+ 1e-12` guards a divide-by-zero on horizontal edges (yi === yj); it
 * is far below planar resolution so it never flips a real result.
 */
export function pointInPolygon(p: PlanarPoint, poly: PlanarPoint[]): boolean {
	const n = poly.length;
	if (n < 3) return false;
	let inside = false;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		const crosses = yi > p.y !== yj > p.y;
		if (crosses) {
			const xAtY = ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
			if (p.x < xAtY) inside = !inside;
		}
	}
	return inside;
}

function perpendicularDistance(
	pt: PlanarPoint,
	lineStart: PlanarPoint,
	lineEnd: PlanarPoint
): number {
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
 * Catmull-Rom spline through the given planar points, producing `samplesPerSegment` equally-spaced
 * (in parameter, NOT arc length) interpolated points per input segment. Endpoints are preserved
 * (first/last input points are the first/last output points). Tension 0.5 (uniform Catmull-Rom).
 * Returns a NEW array of planar points.
 */
export function catmullRom(points: PlanarPoint[], samplesPerSegment = 8): PlanarPoint[] {
	if (points.length < 2) return points.map((p) => ({ ...p }));

	const result: PlanarPoint[] = [];

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[Math.min(points.length - 1, i + 1)];
		const p3 = points[Math.min(points.length - 1, i + 2)];

		for (let j = 0; j < samplesPerSegment; j++) {
			const t = j / samplesPerSegment;
			result.push(catmullRomInterpolate(p0, p1, p2, p3, t));
		}
	}

	result.push({ ...points[points.length - 1] });
	return result;
}

/**
 * Closed-loop Catmull-Rom: the curve wraps from the last point back to the
 * first, producing a smooth closed blob (used by the zone/area tool). Falls
 * back to the open variant when there aren't enough points to form a loop.
 */
export function catmullRomClosed(points: PlanarPoint[], samplesPerSegment = 8): PlanarPoint[] {
	const n = points.length;
	if (n < 3) return catmullRom(points, samplesPerSegment);
	const result: PlanarPoint[] = [];
	const at = (i: number): PlanarPoint => points[((i % n) + n) % n];
	for (let i = 0; i < n; i++) {
		const p0 = at(i - 1);
		const p1 = at(i);
		const p2 = at(i + 1);
		const p3 = at(i + 2);
		for (let j = 0; j < samplesPerSegment; j++) {
			result.push(catmullRomInterpolate(p0, p1, p2, p3, j / samplesPerSegment));
		}
	}
	return result;
}

function catmullRomInterpolate(
	p0: PlanarPoint,
	p1: PlanarPoint,
	p2: PlanarPoint,
	p3: PlanarPoint,
	t: number
): PlanarPoint {
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
 * Builds a cumulative arc-length table over the (already smoothed) planar points.
 * Returns an object with the points and a parallel cumulative-distance array starting at 0.
 */
export interface ArcLengthPath {
	points: PlanarPoint[];
	cum: number[];
	total: number;
}

export function buildArcLength(points: PlanarPoint[]): ArcLengthPath {
	if (points.length === 0) {
		return { points: [], cum: [], total: 0 };
	}

	const cum = [0];

	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		cum.push(cum[cum.length - 1] + dist);
	}

	return { points, cum, total: cum[cum.length - 1] };
}

/**
 * Samples the arc-length-parametrised path at distance `d` metres (0 ≤ d ≤ total). Linear
 * interpolation of `x` and `y` between the two bracketing points. A planar polyline has no
 * seam, so there is no wrap handling. Returns a planar point.
 */
export function sampleAtArcLength(path: ArcLengthPath, d: number): PlanarPoint {
	if (path.points.length === 0) return { x: 0, y: 0 };
	if (path.points.length === 1) return { ...path.points[0] };

	const clampedD = Math.max(0, Math.min(d, path.total));

	if (clampedD === 0) return { ...path.points[0] };
	if (clampedD === path.total) return { ...path.points[path.points.length - 1] };

	let idx = 0;
	for (let i = 0; i < path.cum.length - 1; i++) {
		if (clampedD >= path.cum[i] && clampedD <= path.cum[i + 1]) {
			idx = i;
			break;
		}
	}

	const segmentDist = path.cum[idx + 1] - path.cum[idx];
	if (segmentDist === 0) return { ...path.points[idx] };

	const localT = (clampedD - path.cum[idx]) / segmentDist;
	const p0 = path.points[idx];
	const p1 = path.points[idx + 1];

	return {
		x: p0.x + localT * (p1.x - p0.x),
		y: p0.y + localT * (p1.y - p0.y)
	};
}

/**
 * Unit tangent of the path at normalised fraction `f` (0 ≤ f ≤ 1), as a planar
 * direction {x,y}. Computed from a small central difference of sampleAtArcLength
 * around f. Used for heading-derivation during path playback when autoFace is on.
 */
export function pathTangentAt(path: ArcLengthPath, f: number): PlanarPoint {
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

	const dx = p1.x - p0.x;
	const dy = p1.y - p0.y;
	const mag = Math.sqrt(dx * dx + dy * dy);

	if (mag === 0) {
		return { x: 1, y: 0 };
	}

	return { x: dx / mag, y: dy / mag };
}
