import { describe, it, expect } from 'vitest';
import type { Annotation } from '$lib/doc/types';
import {
	baseBox,
	identityTransform,
	resolvedTransform,
	effectiveAnchors,
	moveTransform,
	resizeTransform,
	resizeCursorFor,
	rotateTransform,
	boxCorners,
	rotateHandlePos,
	MIN_HALF
} from './annotationTransform';

// Diagonal arrow (0,0)->(2,2): base box centre (1,1), half-size (1,1).
const arrow = {
	id: 'a',
	kind: 'arrow' as const,
	points: [
		{ x: 0, y: 0 },
		{ x: 2, y: 2 }
	],
	style: { color: '#000' }
} as Annotation;

const label = {
	id: 'l',
	kind: 'label' as const,
	at: { x: 3, y: 3 },
	text: 'hi',
	style: { color: '#000' }
} as Annotation;

describe('annotationTransform — base box', () => {
	it('computes centre and half-sizes from the anchors', () => {
		expect(baseBox(arrow)).toEqual({ cx: 1, cy: 1, hw: 1, hh: 1 });
	});
	it('half-sizes are 0 for a single-anchor label', () => {
		expect(baseBox(label)).toEqual({ cx: 3, cy: 3, hw: 0, hh: 0 });
	});
});

describe('annotationTransform — effective anchors', () => {
	it('identity transform returns the base anchors', () => {
		expect(effectiveAnchors(arrow)).toEqual([
			{ x: 0, y: 0 },
			{ x: 2, y: 2 }
		]);
	});
	it('uses an explicit transform override (live gesture)', () => {
		const t = moveTransform(identityTransform(arrow), { x: 5, y: -3 });
		expect(effectiveAnchors(arrow, t)).toEqual([
			{ x: 5, y: -3 },
			{ x: 7, y: -1 }
		]);
	});
	it('falls back to a stored transform on the annotation', () => {
		const stored = { ...identityTransform(arrow), cx: 10, cy: 10 };
		expect(resolvedTransform({ ...arrow, transform: stored })).toEqual(stored);
	});
});

describe('annotationTransform — move', () => {
	it('translates every anchor by the delta', () => {
		const t = moveTransform(identityTransform(label), { x: 1, y: 1 });
		expect(effectiveAnchors(label, t)).toEqual([{ x: 4, y: 4 }]);
	});
});

describe('annotationTransform — resize', () => {
	it('keeps the opposite corner fixed and tracks the pointer', () => {
		// Drag the (+1,+1) corner (the `to` end) to (4,6); from (0,0) stays.
		const rt = resizeTransform(identityTransform(arrow), 1, 1, 1, 1, { x: 4, y: 6 });
		expect(effectiveAnchors(arrow, rt)).toEqual([
			{ x: 0, y: 0 },
			{ x: 4, y: 6 }
		]);
		expect(rt.sx).toBeCloseTo(2);
		expect(rt.sy).toBeCloseTo(3);
	});
	it('clamps to the minimum half-size so the box cannot invert', () => {
		// Pointer dragged essentially onto the fixed corner.
		const rt = resizeTransform(identityTransform(arrow), 1, 1, 1, 1, { x: 0.01, y: 0.01 });
		expect(rt.sx).toBeCloseTo(MIN_HALF);
		expect(rt.sy).toBeCloseTo(MIN_HALF);
	});
	it('single-axis (edge) resize scales only the dragged axis', () => {
		// Drag the right edge (su=1, sv=0) outward to x=5; the left end stays.
		const rt = resizeTransform(identityTransform(arrow), 1, 1, 1, 0, { x: 5, y: 1 });
		expect(rt.sx).toBeCloseTo(2.5);
		expect(rt.sy).toBeCloseTo(1); // height frozen
		expect(effectiveAnchors(arrow, rt)).toEqual([
			{ x: 0, y: 0 },
			{ x: 5, y: 2 }
		]);
	});
	it('left edge resize keeps the right end fixed', () => {
		const rt = resizeTransform(identityTransform(arrow), 1, 1, -1, 0, { x: -1, y: 1 });
		expect(rt.sx).toBeCloseTo(1.5);
		expect(effectiveAnchors(arrow, rt)).toEqual([
			{ x: -1, y: 0 },
			{ x: 2, y: 2 }
		]);
	});
});

describe('annotationTransform — resize cursor', () => {
	it('maps corners and edges to directional cursors at zero rotation', () => {
		expect(resizeCursorFor(1, 1, 0)).toBe('nwse-resize');
		expect(resizeCursorFor(1, 0, 0)).toBe('ew-resize');
		expect(resizeCursorFor(0, 1, 0)).toBe('ns-resize');
	});
	it('rotates the cursor with the box angle', () => {
		// A horizontal edge rotated 90deg becomes vertical → ns-resize.
		expect(resizeCursorFor(1, 0, Math.PI / 2)).toBe('ns-resize');
	});
});

describe('annotationTransform — rotate', () => {
	it('rotates the anchors around the box centre', () => {
		const centre = { x: 1, y: 1 };
		const t = rotateTransform(
			identityTransform(arrow),
			centre,
			{ x: 2, y: 1 }, // start: pointer right of centre
			{ x: 1, y: 2 } // now: pointer below centre -> +90 deg
		);
		expect(t.angle).toBeCloseTo(Math.PI / 2);
		const e = effectiveAnchors(arrow, t);
		expect(e[0].x).toBeCloseTo(2);
		expect(e[0].y).toBeCloseTo(0);
		expect(e[1].x).toBeCloseTo(0);
		expect(e[1].y).toBeCloseTo(2);
	});
});

describe('annotationTransform — selection geometry', () => {
	it('box corners trace the oriented rectangle', () => {
		expect(boxCorners(arrow)).toEqual([
			{ x: 2, y: 2 },
			{ x: 0, y: 2 },
			{ x: 0, y: 0 },
			{ x: 2, y: 0 }
		]);
	});
	it('rotate handle sits centred above the top edge', () => {
		// centre (1,1), hh 1, offset 0.5 -> (1, 1 - 1.5) = (1, -0.5)
		expect(rotateHandlePos(arrow, 0.5)).toEqual({ x: 1, y: -0.5 });
	});
});
