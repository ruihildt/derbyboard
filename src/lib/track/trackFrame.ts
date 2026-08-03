import {
	C1,
	C2,
	C1_OUTER,
	C2_OUTER,
	RADIUS_INNER,
	RADIUS_OUTER,
	F_OUTER_TOP,
	F_OUTER_BOTTOM
} from '@open-roller-derby-tools/derby-track/dist/constants.js';
import type { MeterPoint } from '$lib/trackMath';

const MEASUREMENT_RADIUS = 5.41;
const CIRCUMFERENCE_HALF_CIRCLE = Math.PI * MEASUREMENT_RADIUS;
const LINE_DIST = 2 * C1.x;
export const LAP_LENGTH = 2 * CIRCUMFERENCE_HALF_CIRCLE + 2 * LINE_DIST;

interface Segment {
	startS: number;
	endS: number;
}

const SEGMENTS: Segment[] = [
	{ startS: 0, endS: CIRCUMFERENCE_HALF_CIRCLE },
	{ startS: CIRCUMFERENCE_HALF_CIRCLE, endS: CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST },
	{
		startS: CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST,
		endS: 2 * CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST
	},
	{ startS: 2 * CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST, endS: LAP_LENGTH }
];

function wrapS(s: number): number {
	return ((s % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
}

function findSegmentIndex(s: number): number {
	const wrapped = wrapS(s);
	for (let i = 0; i < SEGMENTS.length; i++) {
		if (wrapped >= SEGMENTS[i].startS && wrapped < SEGMENTS[i].endS) {
			return i;
		}
	}
	return 3;
}

function getMeasurementPointAndNormal(s: number): {
	point: MeterPoint;
	normal: MeterPoint;
	angle: number;
} {
	const wrapped = wrapS(s);
	const idx = findSegmentIndex(wrapped);
	const localS = wrapped - SEGMENTS[idx].startS;

	if (idx === 0) {
		const angle = -localS / MEASUREMENT_RADIUS + Math.PI / 2;
		return {
			point: {
				x: C1.x + MEASUREMENT_RADIUS * Math.cos(angle),
				y: C1.y + MEASUREMENT_RADIUS * Math.sin(angle)
			},
			normal: { x: Math.cos(angle), y: Math.sin(angle) },
			angle
		};
	} else if (idx === 1) {
		return {
			point: { x: C1.x - localS, y: -MEASUREMENT_RADIUS },
			normal: { x: 0, y: -1 },
			angle: 0
		};
	} else if (idx === 2) {
		const angle = -localS / MEASUREMENT_RADIUS - Math.PI / 2;
		return {
			point: {
				x: C2.x + MEASUREMENT_RADIUS * Math.cos(angle),
				y: C2.y + MEASUREMENT_RADIUS * Math.sin(angle)
			},
			normal: { x: Math.cos(angle), y: Math.sin(angle) },
			angle
		};
	} else {
		return {
			point: { x: C2.x + localS, y: MEASUREMENT_RADIUS },
			normal: { x: 0, y: 1 },
			angle: 0
		};
	}
}

function computeOuterDistance(idx: number, localS: number): number {
	if (idx === 0) {
		const angle = -localS / MEASUREMENT_RADIUS + Math.PI / 2;
		const sinTheta = Math.sin(angle);
		const d = C1.y - C1_OUTER.y;
		const r =
			(-2 * d * sinTheta +
				Math.sqrt(4 * d * d * sinTheta * sinTheta - 4 * (d * d - RADIUS_OUTER * RADIUS_OUTER))) /
			2;
		return r - MEASUREMENT_RADIUS;
	} else if (idx === 1) {
		const x = C1.x - localS;
		const outerY = F_OUTER_TOP(x);
		return -(outerY + MEASUREMENT_RADIUS);
	} else if (idx === 2) {
		const angle = -localS / MEASUREMENT_RADIUS - Math.PI / 2;
		const sinTheta = Math.sin(angle);
		const d = C2.y - C2_OUTER.y;
		const r =
			(-2 * d * sinTheta +
				Math.sqrt(4 * d * d * sinTheta * sinTheta - 4 * (d * d - RADIUS_OUTER * RADIUS_OUTER))) /
			2;
		return r - MEASUREMENT_RADIUS;
	} else {
		const x = C2.x + localS;
		const outerY = F_OUTER_BOTTOM(x);
		return outerY - MEASUREMENT_RADIUS;
	}
}

export function laneBounds(s: number): { inner: number; outer: number } {
	const wrapped = wrapS(s);
	const idx = findSegmentIndex(wrapped);
	const localS = wrapped - SEGMENTS[idx].startS;
	const innerOffset = -(MEASUREMENT_RADIUS - RADIUS_INNER);
	const outerOffset = computeOuterDistance(idx, localS);
	return { inner: innerOffset, outer: outerOffset };
}

export function fromTrack(s: number, u: number): MeterPoint {
	const { point, normal } = getMeasurementPointAndNormal(s);
	const bounds = laneBounds(s);
	const offset = bounds.inner + u * (bounds.outer - bounds.inner);
	return {
		x: point.x + offset * normal.x,
		y: point.y + offset * normal.y
	};
}

/**
 * Meters -> (s, u). `u` is NOT clamped to [0,1]: out-of-bounds is a
 * legitimate, representable state (u < 0 or u > 1) — callers that need a
 * boolean use `isInBoundsTrack`; this function must not clamp for them,
 * otherwise storing a pose silently teleports it back inside the boundary on
 * the next render (see the drag-overlap regression this fixes).
 *
 * This is an exact inverse of `fromTrack` for outward excursions of any
 * magnitude, and for inward excursions down to roughly u > -0.8 (about one
 * lane-width past the inner line). Beyond that the offset construction folds
 * on itself — a genuine geometric singularity of projecting normals off a
 * closed curve, not a classification bug — and further inward the coarse
 * per-segment classifier (based on x/y quadrant, not distance) may attribute
 * the point to a different segment than the one it was generated from. This
 * is far beyond any realistic drag; skaters are never intentionally placed
 * deep in the infield.
 */
export function toTrack(p: MeterPoint): { s: number; u: number } {
	let s: number;

	if (p.x > C1.x) {
		const dx = p.x - C1.x;
		const dy = p.y - C1.y;
		let angle = Math.atan2(dy, dx);
		angle = -angle + Math.PI / 2;
		angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
		s = angle * MEASUREMENT_RADIUS;
	} else if (p.x <= C1.x && p.x >= C2.x && p.y <= 0) {
		s = CIRCUMFERENCE_HALF_CIRCLE + (C1.x - p.x);
	} else if (p.x < C2.x) {
		const dx = p.x - C2.x;
		const dy = p.y - C2.y;
		let angle = Math.atan2(dy, dx);
		angle = -angle - Math.PI / 2;
		angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
		s = CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST + angle * MEASUREMENT_RADIUS;
	} else {
		s = 2 * CIRCUMFERENCE_HALF_CIRCLE + LINE_DIST + (p.x - C2.x);
	}

	s = wrapS(s);

	const { point, normal } = getMeasurementPointAndNormal(s);
	const bounds = laneBounds(s);
	const dx = p.x - point.x;
	const dy = p.y - point.y;
	const signedOffset = dx * normal.x + dy * normal.y;
	const u = (signedOffset - bounds.inner) / (bounds.outer - bounds.inner);

	return { s, u };
}

/**
 * Whether a track-space pose is in bounds, accounting for a skater's drawn
 * radius (in metres). Derived from `laneBounds` rather than baked into the
 * (s,u) encoding, so out-of-bounds poses remain exactly representable and
 * round-trippable. The radius is converted to a local u-margin because lane
 * width (outer - inner) varies around the track.
 */
export function isInBoundsTrack(s: number, u: number, radiusM = 0): boolean {
	if (radiusM === 0) return u >= 0 && u <= 1;
	const bounds = laneBounds(s);
	const width = bounds.outer - bounds.inner;
	const marginU = radiusM / width;
	return u >= marginU && u <= 1 - marginU;
}

export function tangentAt(s: number): MeterPoint {
	const wrapped = wrapS(s);
	const idx = findSegmentIndex(wrapped);
	const localS = wrapped - SEGMENTS[idx].startS;

	if (idx === 0) {
		const angle = -localS / MEASUREMENT_RADIUS + Math.PI / 2;
		const tangentAngle = angle - Math.PI / 2;
		return { x: Math.cos(tangentAngle), y: Math.sin(tangentAngle) };
	} else if (idx === 1) {
		return { x: -1, y: 0 };
	} else if (idx === 2) {
		const angle = -localS / MEASUREMENT_RADIUS - Math.PI / 2;
		const tangentAngle = angle - Math.PI / 2;
		return { x: Math.cos(tangentAngle), y: Math.sin(tangentAngle) };
	} else {
		return { x: 1, y: 0 };
	}
}

/**
 * Unit tangent of the skating direction at a planar (metre) point — a direct
 * equivalent of `tangentAt(toTrack(p).s)` that classifies the segment once and
 * skips the measurement-point/normal/lane-bounds round trip (atan2 + several
 * sin/cos/sqrt) entirely. On the turns the tangent is the radius rotated 90°
 * (a normalize, no trig); on the straights it is a constant. Used by the
 * heading-resolution hot path (per dragmove / per playback frame).
 *
 * Same classification caveats as {@link toTrack}: points deep in the infield
 * may be attributed to a different segment than geometrically nearest — far
 * beyond any realistic skater placement.
 */
export function tangentAtPoint(p: MeterPoint): MeterPoint {
	if (p.x > C1.x || p.x < C2.x) {
		const c = p.x > C1.x ? C1 : C2;
		const dx = p.x - c.x;
		const dy = p.y - c.y;
		const r = Math.hypot(dx, dy);
		if (r < 1e-9) return { x: 0, y: -1 }; // degenerate: same as θ = 0
		return { x: dy / r, y: -dx / r };
	}
	return p.y <= 0 ? { x: -1, y: 0 } : { x: 1, y: 0 };
}

export function laneToOffset(s: number, u: number): number {
	const bounds = laneBounds(s);
	return bounds.inner + u * (bounds.outer - bounds.inner);
}

export function offsetToLane(s: number, v: number): number {
	const bounds = laneBounds(s);
	return (v - bounds.inner) / (bounds.outer - bounds.inner);
}
