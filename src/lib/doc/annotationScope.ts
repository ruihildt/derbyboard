import type { Annotation, AnnotationScope, Step } from './types';

/** The scope editing modes exposed by the Select panel. */
export type ScopeMode = 'all' | 'current' | 'range';

/**
 * Which scope mode an annotation is currently in, derived from its stored
 * scope. Absent scope ⇒ 'all'; a distinct `endStepId` ⇒ 'range'; otherwise a
 * single step ⇒ 'current'.
 */
export function scopeModeOf(ann: Annotation): ScopeMode {
	if (!ann.scope) return 'all';
	const s = ann.scope;
	return s.endStepId && s.endStepId !== s.stepId ? 'range' : 'current';
}

/**
 * Inclusive `[lo, hi]` step **indices** spanned by a scope within the ordered
 * `steps` array. Returns null when the annotation is board-wide (no scope) or a
 * boundary step id no longer exists. Uses min/max of the two boundary indices
 * so a reorder never inverts the range.
 */
export function scopeBounds(
	scope: AnnotationScope | undefined,
	steps: Step[]
): { lo: number; hi: number } | null {
	if (!scope) return null;
	const startIdx = steps.findIndex((s) => s.id === scope.stepId);
	if (startIdx < 0) return null;
	const endId = scope.endStepId ?? scope.stepId;
	const endIdx = endId === scope.stepId ? startIdx : steps.findIndex((s) => s.id === endId);
	if (endIdx < 0) return null;
	return { lo: Math.min(startIdx, endIdx), hi: Math.max(startIdx, endIdx) };
}

/**
 * Whether an annotation is visible on the step with `activeStepId`. Board-wide
 * marks (no scope) are always visible; a scoped mark is visible iff the active
 * step's index falls within its (inclusive) bounds.
 */
export function annotationVisibleOnStep(
	ann: Annotation,
	activeStepId: string | undefined,
	steps: Step[]
): boolean {
	if (!ann.scope) return true;
	if (!activeStepId) return false;
	const bounds = scopeBounds(ann.scope, steps);
	if (!bounds) return false;
	const activeIdx = steps.findIndex((s) => s.id === activeStepId);
	return activeIdx >= bounds.lo && activeIdx <= bounds.hi;
}

/**
 * Human-readable scope summary for HUD/panel labels: "All", "Step 3", or
 * "Steps 2–4". A single step with a title reads "Step 3 — Wall". Uses 1-based
 * indices. Returns "All" when board-wide or when boundaries are stale.
 */
export function scopeLabel(ann: Annotation, steps: Step[]): string {
	const bounds = scopeBounds(ann.scope, steps);
	if (!bounds) return 'All';
	if (bounds.lo === bounds.hi) {
		const step = steps[bounds.lo];
		const title = step?.title?.trim();
		return title ? `Step ${bounds.lo + 1} — ${title}` : `Step ${bounds.lo + 1}`;
	}
	return `Steps ${bounds.lo + 1}–${bounds.hi + 1}`;
}
