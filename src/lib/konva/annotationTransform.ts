import type { Annotation, AnnotationTransform, PlanarPoint } from '$lib/doc/types';

/** Minimum half-size (planar metres) enforced during resize so a box can't
 * collapse to zero / invert. */
export const MIN_HALF = 0.05;

/** The base (untransformed) anchor points defining an annotation's geometry. */
export function baseAnchors(ann: Annotation): PlanarPoint[] {
	switch (ann.kind) {
		case 'pen':
		case 'arrow':
		case 'zone':
			return ann.points;
		case 'gap':
			return [ann.from, ann.to];
		case 'label':
			return [ann.at];
	}
}

/** Axis-aligned bounding box (planar metres) of the base geometry: centre +
 * half-width/height. For a single-anchor label the half-sizes are 0. */
export function baseBox(ann: Annotation): { cx: number; cy: number; hw: number; hh: number } {
	const pts = baseAnchors(ann);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return {
		cx: (minX + maxX) / 2,
		cy: (minY + maxY) / 2,
		hw: (maxX - minX) / 2,
		hh: (maxY - minY) / 2
	};
}

/** Identity transform centred on the annotation's base box. */
export function identityTransform(ann: Annotation): AnnotationTransform {
	const b = baseBox(ann);
	return { cx: b.cx, cy: b.cy, angle: 0, sx: 1, sy: 1 };
}

/** Resolved transform (falls back to identity when absent). */
export function resolvedTransform(ann: Annotation): AnnotationTransform {
	return ann.transform ?? identityTransform(ann);
}

function rotate(angle: number, p: PlanarPoint): PlanarPoint {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/**
 * Effective anchor points after applying the annotation's transform (or the
 * supplied override during a live gesture). Base geometry stays untouched.
 */
export function effectiveAnchors(ann: Annotation, t?: AnnotationTransform): PlanarPoint[] {
	const box = baseBox(ann);
	const xform = t ?? resolvedTransform(ann);
	return baseAnchors(ann).map((b) => {
		const scaled = { x: (b.x - box.cx) * xform.sx, y: (b.y - box.cy) * xform.sy };
		const r = rotate(xform.angle, scaled);
		return { x: xform.cx + r.x, y: xform.cy + r.y };
	});
}

/** Box local axes (planar) for a given angle: u = local-x, v = local-y. */
function axes(angle: number): { u: PlanarPoint; v: PlanarPoint } {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return { u: { x: c, y: s }, v: { x: -s, y: c } };
}

/** Current half-sizes (base half-size * scale). */
export function halfSizes(ann: Annotation, t?: AnnotationTransform): { hw: number; hh: number } {
	const b = baseBox(ann);
	const xform = t ?? resolvedTransform(ann);
	return { hw: b.hw * xform.sx, hh: b.hh * xform.sy };
}

/** The four oriented corner points (planar) of the transformed box. */
export function boxCorners(ann: Annotation, t?: AnnotationTransform): PlanarPoint[] {
	const xform = t ?? resolvedTransform(ann);
	const { hw, hh } = halfSizes(ann, xform);
	const { u, v } = axes(xform.angle);
	const { cx, cy } = xform;
	return [
		{ x: cx + hw * u.x + hh * v.x, y: cy + hw * u.y + hh * v.y },
		{ x: cx - hw * u.x + hh * v.x, y: cy - hw * u.y + hh * v.y },
		{ x: cx - hw * u.x - hh * v.x, y: cy - hw * u.y - hh * v.y },
		{ x: cx + hw * u.x - hh * v.x, y: cy + hw * u.y - hh * v.y }
	];
}

/**
 * Rotation handle position (planar): centred on the box width, a `offset`
 * above the top edge. "Above" follows the box's local -y axis so it tracks the
 * rotation.
 */
export function rotateHandlePos(
	ann: Annotation,
	offset: number,
	t?: AnnotationTransform
): PlanarPoint {
	const xform = t ?? resolvedTransform(ann);
	const { hh } = halfSizes(ann, xform);
	const { v } = axes(xform.angle);
	// Local up = -v; place above the top edge by (hh + offset).
	return { x: xform.cx - (hh + offset) * v.x, y: xform.cy - (hh + offset) * v.y };
}

// --- gesture transforms (pure; return a new transform) ----------------------

/** Move: translate the centre by `delta` (planar). */
export function moveTransform(t: AnnotationTransform, delta: PlanarPoint): AnnotationTransform {
	return { ...t, cx: t.cx + delta.x, cy: t.cy + delta.y };
}

/**
 * Resize from a dragged corner. The opposite corner stays fixed. `su,sv` are
 * the dragged corner's local signs (±1). `pointer` is the live pointer in
 * planar metres. Per-axis scale; stroke width is unaffected (geometry only).
 */
export function resizeTransform(
	t: AnnotationTransform,
	baseHw: number,
	baseHh: number,
	su: number,
	sv: number,
	pointer: PlanarPoint
): AnnotationTransform {
	const { u, v } = axes(t.angle);
	// Fixed (opposite) corner from the current transform.
	const hw = baseHw * t.sx;
	const hh = baseHh * t.sy;
	const fixed = {
		x: t.cx - su * hw * u.x - sv * hh * v.x,
		y: t.cy - su * hw * u.y - sv * hh * v.y
	};
	// Project (fixed -> pointer) onto the box axes.
	const d = { x: pointer.x - fixed.x, y: pointer.y - fixed.y };
	const du = d.x * u.x + d.y * u.y;
	const dv = d.x * v.x + d.y * v.y;
	// New half-sizes, clamped to a minimum so the box can't invert.
	const newHw = Math.max(MIN_HALF, Math.abs(du) / 2);
	const newHh = Math.max(MIN_HALF, Math.abs(dv) / 2);
	// Centre sits one half-size in from the fixed corner toward the dragged one.
	const cx = fixed.x + su * newHw * u.x + sv * newHh * v.x;
	const cy = fixed.y + su * newHw * u.y + sv * newHh * v.y;
	return {
		cx,
		cy,
		angle: t.angle,
		sx: baseHw > 0 ? newHw / baseHw : t.sx,
		sy: baseHh > 0 ? newHh / baseHh : t.sy
	};
}

/**
 * Rotate around the box centre. `centre` is the (fixed) centre during the
 * gesture; `start` and `pointer` are the pointer positions at gesture start and
 * now (planar).
 */
export function rotateTransform(
	t: AnnotationTransform,
	centre: PlanarPoint,
	start: PlanarPoint,
	pointer: PlanarPoint
): AnnotationTransform {
	const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
	const a1 = Math.atan2(pointer.y - centre.y, pointer.x - centre.x);
	return { ...t, angle: t.angle + (a1 - a0) };
}
