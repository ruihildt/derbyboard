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

	return { s, u: Math.max(0, Math.min(1, u)) };
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

export function laneToOffset(s: number, u: number): number {
	const bounds = laneBounds(s);
	return bounds.inner + u * (bounds.outer - bounds.inner);
}

export function offsetToLane(s: number, v: number): number {
	const bounds = laneBounds(s);
	return (v - bounds.inner) / (bounds.outer - bounds.inner);
}

export function shortestDelta(sFrom: number, sTo: number): number {
	let delta = sTo - sFrom;
	delta = ((delta % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
	if (delta > LAP_LENGTH / 2) {
		delta -= LAP_LENGTH;
	}
	return delta;
}

export function unwrap(sPrev: number, sNext: number): number {
	const delta = shortestDelta(sPrev, sNext);
	return sPrev + delta;
}
