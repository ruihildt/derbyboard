import { describe, it, expect } from 'vitest';
import { scopeModeOf, scopeBounds, annotationVisibleOnStep, scopeLabel } from './annotationScope';
import type { Annotation, AnnotationScope, Step } from './types';

function steps(n: number): Step[] {
	return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, entities: [] }));
}

function penAnn(scope?: AnnotationScope): Annotation {
	return {
		id: 'a1',
		kind: 'pen',
		points: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 }
		],
		style: { color: '#ff0000' },
		...(scope ? { scope } : {})
	} as Annotation;
}

describe('annotationScope — scopeModeOf', () => {
	it('classifies board-wide, single and range scopes', () => {
		expect(scopeModeOf(penAnn())).toBe('all');
		expect(scopeModeOf(penAnn({ stepId: 's1' }))).toBe('current');
		expect(scopeModeOf(penAnn({ stepId: 's1', endStepId: 's2' }))).toBe('range');
	});

	it('treats a collapsed range (start == end) as current', () => {
		expect(scopeModeOf(penAnn({ stepId: 's1', endStepId: 's1' }))).toBe('current');
	});
});

describe('annotationScope — scopeBounds', () => {
	it('returns null for board-wide and stale boundary ids', () => {
		expect(scopeBounds(undefined, steps(3))).toBeNull();
		expect(scopeBounds({ stepId: 'gone' }, steps(3))).toBeNull();
		expect(scopeBounds({ stepId: 's1', endStepId: 'gone' }, steps(3))).toBeNull();
	});

	it('resolves single and range bounds as inclusive indices', () => {
		expect(scopeBounds({ stepId: 's1' }, steps(3))).toEqual({ lo: 1, hi: 1 });
		expect(scopeBounds({ stepId: 's0', endStepId: 's2' }, steps(3))).toEqual({ lo: 0, hi: 2 });
	});

	it('normalises an inverted range to min/max (reorder-safe)', () => {
		expect(scopeBounds({ stepId: 's2', endStepId: 's0' }, steps(3))).toEqual({ lo: 0, hi: 2 });
	});
});

describe('annotationScope — annotationVisibleOnStep', () => {
	it('board-wide marks are always visible', () => {
		expect(annotationVisibleOnStep(penAnn(), 's0', steps(3))).toBe(true);
		expect(annotationVisibleOnStep(penAnn(), undefined, steps(3))).toBe(true);
	});

	it('range marks are visible only within their span', () => {
		const ann = penAnn({ stepId: 's0', endStepId: 's2' });
		const s = steps(4);
		expect(annotationVisibleOnStep(ann, 's0', s)).toBe(true);
		expect(annotationVisibleOnStep(ann, 's1', s)).toBe(true);
		expect(annotationVisibleOnStep(ann, 's2', s)).toBe(true);
		expect(annotationVisibleOnStep(ann, 's3', s)).toBe(false);
		expect(annotationVisibleOnStep(ann, undefined, s)).toBe(false);
	});

	it('single-step marks are visible only on that step', () => {
		const ann = penAnn({ stepId: 's1' });
		const s = steps(3);
		expect(annotationVisibleOnStep(ann, 's1', s)).toBe(true);
		expect(annotationVisibleOnStep(ann, 's0', s)).toBe(false);
	});
});

describe('annotationScope — scopeLabel', () => {
	it('labels board-wide, single and range scopes', () => {
		const s = steps(4);
		expect(scopeLabel(penAnn(), s)).toBe('All');
		expect(scopeLabel(penAnn({ stepId: 's2' }), s)).toBe('Step 3');
		expect(scopeLabel(penAnn({ stepId: 's0', endStepId: 's3' }), s)).toBe('Steps 1–4');
	});

	it('appends a single step title when present', () => {
		const s: Step[] = [
			{ id: 's0', entities: [] },
			{ id: 's1', entities: [] },
			{ id: 's2', entities: [], title: 'Wall' }
		];
		expect(scopeLabel(penAnn({ stepId: 's2' }), s)).toBe('Step 3 — Wall');
	});

	it('falls back to "All" when the boundary is stale', () => {
		expect(scopeLabel(penAnn({ stepId: 'gone' }), steps(3))).toBe('All');
	});
});
