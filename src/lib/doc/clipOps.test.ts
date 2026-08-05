import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { boardDoc } from './store';
import { poseStore } from './poses';
import { createEmptyDoc } from './types';
import type { Entity, Annotation, Step } from './types';
import { authoringSession } from '$lib/stores/session';
import { selectedAnnotationId } from '$lib/stores/selection';
import {
	createAuthoredClipFromBoard,
	addStepFromBoard,
	duplicateActiveStep,
	deleteStep,
	moveStep,
	renameStep,
	setStepPackZone,
	navigateToStep,
	activeStepIndex,
	getActiveClip,
	getActiveStep,
	exitAuthoring,
	exitToFree,
	snapshotPoses,
	findAuthoredClip,
	setEntityPath,
	clearEntityPath,
	deletePath,
	addAnnotation,
	deleteAnnotation,
	clearAnnotations,
	setAnnotationScope,
	setAnnotationScopeRange
} from './clipOps';

function entity(id: string, x: number, y = 0.5, heading = 0): Entity {
	return { id, kind: 'skater', team: 'A', role: 'blocker', x, y, heading };
}

function resetBoard(entities: Entity[]): void {
	const doc = createEmptyDoc();
	doc.entities = entities;
	boardDoc.set(doc);
	boardDoc.clearHistory();
	authoringSession.set({ activeClipId: null, activeStepIndex: -1 });
}

describe('clipOps — createAuthoredClipFromBoard', () => {
	beforeEach(() => resetBoard([entity('a', 10), entity('b', 20)]));

	it('creates an authored clip whose step 0 snapshots the current board', () => {
		const id = createAuthoredClipFromBoard('Drill');
		const doc = boardDoc.current;
		const clip = findAuthoredClip(doc, id);
		expect(clip).toBeDefined();
		expect(clip!.steps).toHaveLength(1);
		expect(clip!.steps[0].entities).toEqual(snapshotPoses(doc.entities));
		expect(clip!.title).toBe('Drill');
	});

	it('makes the new clip active at step 0', () => {
		createAuthoredClipFromBoard();
		expect(getActiveClip()).toBeDefined();
		expect(activeStepIndex()).toBe(0);
	});

	it('installs the authoring commit hook', () => {
		createAuthoredClipFromBoard();
		// The hook is exercised by the commitGesture test below; here just
		// confirm authoring is active and a step exists.
		expect(getActiveStep()).toBeDefined();
	});
});

describe('clipOps — addStepFromBoard', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('appends a step with the previous step arrival poses', () => {
		createAuthoredClipFromBoard();
		// Draw a path on step 0 so the entity arrives at x=40.
		const step0Id = getActiveClip()!.steps[0].id;
		setEntityPath(step0Id, 'a', [
			{ x: 10, y: 0.5 },
			{ x: 25, y: 0.5 },
			{ x: 40, y: 0.5 }
		]);
		addStepFromBoard();
		const clip = getActiveClip()!;
		expect(clip.steps).toHaveLength(2);
		// New step starts where the path ends (x=40), not where it began (x=10).
		expect(clip.steps[1].entities[0].x).toBe(40);
		expect(activeStepIndex()).toBe(1);
	});
});

describe('clipOps — duplicateActiveStep (duplicate-and-nudge)', () => {
	beforeEach(() => resetBoard([entity('a', 10), entity('b', 20)]));

	it('inserts a copy of the active step immediately after it', () => {
		createAuthoredClipFromBoard();
		addStepFromBoard(); // now 2 steps, active = 1
		const beforeCount = getActiveClip()!.steps.length;
		duplicateActiveStep();
		const clip = getActiveClip()!;
		expect(clip.steps).toHaveLength(beforeCount + 1);
		// The new step sits at index 2 and mirrors step 1's poses.
		expect(clip.steps[2].entities).toEqual(clip.steps[1].entities.map((p) => ({ ...p })));
		expect(activeStepIndex()).toBe(2);
	});

	it('makes the duplicate active so the coach edits only the copy', () => {
		createAuthoredClipFromBoard();
		duplicateActiveStep();
		// Drag entity 'a' on the active (duplicated) step via the commit hook.
		poseStore.setLive('a', { x: 77, y: 0.1 });
		poseStore.commitGesture('move');
		const clip = getActiveClip()!;
		// Active step reflects the new pose; original step 0 does not.
		expect(clip.steps[1].entities.find((p) => p.id === 'a')?.x).toBe(77);
		expect(clip.steps[0].entities.find((p) => p.id === 'a')?.x).toBe(10);
	});
});

describe('clipOps — commit hook (one undo reverts board + step)', () => {
	beforeEach(() => resetBoard([entity('a', 10), entity('b', 20)]));

	it('writes a gesture to the document and active step in a single undo entry', () => {
		createAuthoredClipFromBoard();
		poseStore.setLive('a', { x: 30, y: 0.7 });
		poseStore.setLive('b', { x: 40, y: 0.8 });
		const changed = poseStore.commitGesture('move');
		expect(changed).toBe(true);

		const clip = getActiveClip()!;
		expect(clip.steps[0].entities.find((p) => p.id === 'a')?.x).toBe(30);
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(30);

		// A single undo reverts BOTH the board and the step. (The clip's
		// "Create drill" entry remains underneath, so canUndo stays true.)
		const couldUndo = boardDoc.canUndo;
		boardDoc.undo();
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(10);
		expect(getActiveClip()!.steps[0].entities.find((p) => p.id === 'a')?.x).toBe(10);
		// Undoing again would remove the clip itself.
		expect(boardDoc.canUndo).toBe(couldUndo);
	});
});

describe('clipOps — deleteStep / moveStep / renameStep / setStepPackZone', () => {
	beforeEach(() => resetBoard([entity('a', 0)]));

	it('deletes a non-last step and keeps the board valid', () => {
		createAuthoredClipFromBoard();
		addStepFromBoard();
		addStepFromBoard();
		expect(getActiveClip()!.steps).toHaveLength(3);
		const middleId = getActiveClip()!.steps[1].id;
		deleteStep(middleId);
		expect(getActiveClip()!.steps).toHaveLength(2);
		expect(getActiveClip()!.steps.find((s) => s.id === middleId)).toBeUndefined();
	});

	it('refuses to delete the last remaining step', () => {
		createAuthoredClipFromBoard();
		const onlyId = getActiveClip()!.steps[0].id;
		deleteStep(onlyId);
		expect(getActiveClip()!.steps).toHaveLength(1);
	});

	it('reorders steps and keeps the same step active by id', () => {
		createAuthoredClipFromBoard();
		addStepFromBoard();
		addStepFromBoard();
		const activeId = getActiveClip()!.steps[2].id;
		navigateToStep(2);
		moveStep(2, 0);
		expect(getActiveClip()!.steps[0].id).toBe(activeId);
	});

	it('renames a step', () => {
		createAuthoredClipFromBoard();
		const id = getActiveClip()!.steps[0].id;
		renameStep(id, 'The wall');
		expect(getActiveClip()!.steps[0].title).toBe('The wall');
	});

	it('persists the pack-zone toggle per step', () => {
		createAuthoredClipFromBoard();
		const id = getActiveClip()!.steps[0].id;
		setStepPackZone(id, false);
		expect(getActiveClip()!.steps[0].showPackZone).toBe(false);
		setStepPackZone(id, true);
		expect(getActiveClip()!.steps[0].showPackZone).toBe(true);
	});

	it('duplicateActiveStep does not copy annotations (board-level) and not paths', () => {
		createAuthoredClipFromBoard();
		// Annotations are board-level now: set one up via addAnnotation.
		addAnnotation({
			id: 'test-ann',
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 },
				{ x: 2, y: 0.5 }
			],
			style: { color: '#ff0000', width: 2 }
		} as Omit<Annotation, 'id'>);
		// A path still lives on the step.
		const pathId = 'test-path';
		boardDoc.applyEdit((d) => {
			const c = getActiveClip(d);
			if (!c) return;
			c.steps[0].paths = [
				{
					id: pathId,
					entityId: 'a',
					points: [
						{ x: 0, y: 0.5 },
						{ x: 1, y: 0.5 },
						{ x: 2, y: 0.5 },
						{ x: 3, y: 0.5 }
					]
				}
			];
		}, 'add path');

		expect(boardDoc.current.annotations).toHaveLength(1);
		expect(getActiveClip()!.steps[0].paths).toHaveLength(1);

		const before = boardDoc.current.annotations!;
		duplicateActiveStep();

		// Annotations are board-level: duplication must not touch them.
		expect(boardDoc.current.annotations).toHaveLength(1);
		expect(boardDoc.current.annotations![0]).toBe(before[0]);
		// The copy carries no annotation field (and paths are not inherited).
		const copyStep = getActiveClip()!.steps[1];
		expect((copyStep as unknown as { annotations?: unknown }).annotations).toBeUndefined();
		expect(copyStep.paths).toBeUndefined();
	});
});

describe('clipOps — paths and annotations', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('setEntityPath creates a new path for an entity', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		const points = [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 },
			{ x: 2, y: 0.5 }
		];
		setEntityPath(stepId, 'a', points);
		const step = getActiveClip()!.steps[0];
		expect(step.paths).toHaveLength(1);
		expect(step.paths![0].entityId).toBe('a');
		expect(step.paths![0].points).toEqual(points);
	});

	it('setEntityPath replaces an existing path for the same entity', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		setEntityPath(stepId, 'a', [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 }
		]);
		setEntityPath(stepId, 'a', [
			{ x: 2, y: 0.5 },
			{ x: 3, y: 0.5 }
		]);
		const step = getActiveClip()!.steps[0];
		expect(step.paths).toHaveLength(1);
		expect(step.paths![0].points).toEqual([
			{ x: 2, y: 0.5 },
			{ x: 3, y: 0.5 }
		]);
	});

	it('clearEntityPath removes the path for an entity', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		setEntityPath(stepId, 'a', [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 }
		]);
		clearEntityPath(stepId, 'a');
		const step = getActiveClip()!.steps[0];
		expect(step.paths).toHaveLength(0);
	});

	it('deletePath removes a path by id', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		setEntityPath(stepId, 'a', [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 }
		]);
		const pathId = getActiveClip()!.steps[0].paths![0].id;
		deletePath(stepId, pathId);
		const step = getActiveClip()!.steps[0];
		expect(step.paths).toHaveLength(0);
	});

	it('addAnnotation creates a new board-wide annotation', () => {
		const id = addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		expect(boardDoc.current.annotations).toHaveLength(1);
		const ann = boardDoc.current.annotations![0];
		expect(ann.id).toBe(id);
		// Board-wide by default: no scope.
		expect(ann.scope).toBeUndefined();
		if (ann.kind === 'pen') {
			expect(ann.points).toEqual([
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			]);
		}
	});

	it('deleteAnnotation removes an annotation by id', () => {
		const id = addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		deleteAnnotation(id);
		expect(boardDoc.current.annotations).toHaveLength(0);
	});

	it('clearAnnotations removes all annotations from the board', () => {
		addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		addAnnotation({
			kind: 'pen',
			points: [
				{ x: 2, y: 0.5 },
				{ x: 3, y: 0.5 }
			],
			style: { color: '#00ff00' }
		} as Omit<Annotation, 'id'>);
		clearAnnotations();
		expect(boardDoc.current.annotations).toBeUndefined();
	});

	it('setAnnotationScope pins an annotation to a step and back to board-wide', () => {
		const id = addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		setAnnotationScope(id, 'step-1');
		expect(boardDoc.current.annotations![0].scope).toEqual({ stepId: 'step-1' });
		setAnnotationScope(id, null);
		expect(boardDoc.current.annotations![0].scope).toBeUndefined();
	});

	it('path/annotation ops create one undo entry each', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		const historyDepth = undoDepth();

		setEntityPath(stepId, 'a', [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 }
		]);
		expect(undoDepth()).toBe(historyDepth + 1);

		addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		expect(undoDepth()).toBe(historyDepth + 2);

		boardDoc.undo();
		expect(boardDoc.current.annotations).toBeUndefined();

		boardDoc.undo();
		expect(getActiveClip()!.steps[0].paths).toBeUndefined();
	});

	it('non-finite points are dropped', () => {
		createAuthoredClipFromBoard();
		const stepId = getActiveClip()!.steps[0].id;
		const pointsWithNaN = [
			{ x: 0, y: 0.5 },
			{ x: NaN, y: 0.5 },
			{ x: 1, y: 0.5 },
			{ x: 2, y: Infinity },
			{ x: 3, y: 0.5 }
		];
		setEntityPath(stepId, 'a', pointsWithNaN);
		expect(getActiveClip()!.steps[0].paths![0].points).toEqual([
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 },
			{ x: 3, y: 0.5 }
		]);

		addAnnotation({
			kind: 'pen',
			points: pointsWithNaN,
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
		const ann = boardDoc.current.annotations![0];
		if (ann.kind === 'pen') {
			expect(ann.points).toEqual([
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 },
				{ x: 3, y: 0.5 }
			]);
		}
	});
});

describe('clipOps — annotation step-range scope', () => {
	beforeEach(() => resetBoard([entity('a', 0)]));

	function penAnnotation(): string {
		return addAnnotation({
			kind: 'pen',
			points: [
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 }
			],
			style: { color: '#ff0000' }
		} as Omit<Annotation, 'id'>);
	}

	/** Builds a 4-step clip and returns its (stable) step ids in order. */
	function fourStepClip(): Step[] {
		createAuthoredClipFromBoard();
		addStepFromBoard();
		addStepFromBoard();
		addStepFromBoard();
		return getActiveClip()!.steps;
	}

	it('setAnnotationScopeRange stores an inclusive range', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[0].id, steps[2].id);
		expect(boardDoc.current.annotations![0].scope).toEqual({
			stepId: steps[0].id,
			endStepId: steps[2].id
		});
	});

	it('setAnnotationScopeRange normalises a reversed selection (auto-swap)', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[2].id, steps[0].id);
		expect(boardDoc.current.annotations![0].scope).toEqual({
			stepId: steps[0].id,
			endStepId: steps[2].id
		});
	});

	it('setAnnotationScopeRange collapses From == To to a single-step scope', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[1].id, steps[1].id);
		expect(boardDoc.current.annotations![0].scope).toEqual({ stepId: steps[1].id });
	});

	it('deleting an interior step leaves the range boundaries intact', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[1].id, steps[3].id); // range over 1..3
		deleteStep(steps[2].id); // interior deletion
		const ann = boardDoc.current.annotations!.find((a) => a.id === id)!;
		expect(ann.scope).toEqual({ stepId: steps[1].id, endStepId: steps[3].id });
	});

	it('deleting a boundary step shrinks the range to survivors', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[1].id, steps[3].id); // range over 1..3
		deleteStep(steps[1].id); // delete the start boundary
		const ann = boardDoc.current.annotations!.find((a) => a.id === id)!;
		expect(ann.scope).toEqual({ stepId: steps[2].id, endStepId: steps[3].id });
	});

	it('deleting a step outside the range leaves the scope untouched', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[1].id, steps[3].id); // range over 1..3
		deleteStep(steps[0].id); // outside the range
		const ann = boardDoc.current.annotations!.find((a) => a.id === id)!;
		expect(ann.scope).toEqual({ stepId: steps[1].id, endStepId: steps[3].id });
	});

	it('deleting the only in-range step removes the annotation', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScope(id, steps[1].id); // single-step scope
		deleteStep(steps[1].id);
		expect(boardDoc.current.annotations!.find((a) => a.id === id)).toBeUndefined();
	});

	it('navigateToStep deselects annotations no longer visible on the new step', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScope(id, steps[1].id); // scoped to step 1
		selectedAnnotationId.set(id);
		expect(get(selectedAnnotationId)).toBe(id);
		navigateToStep(0); // step 0 — annotation not visible
		expect(get(selectedAnnotationId)).toBeNull();
	});

	it('navigateToStep keeps selection when the annotation is visible on the new step', () => {
		const steps = fourStepClip();
		const id = penAnnotation();
		setAnnotationScopeRange(id, steps[1].id, steps[3].id); // range 1-3
		selectedAnnotationId.set(id);
		navigateToStep(2); // within range — stays selected
		expect(get(selectedAnnotationId)).toBe(id);
	});
});

describe('clipOps — navigateToStep (history-less)', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('loads a step onto the board without creating undo history', () => {
		createAuthoredClipFromBoard();
		// Draw a path on step 0 so the entity arrives at x=50.
		const step0Id = getActiveClip()!.steps[0].id;
		setEntityPath(step0Id, 'a', [
			{ x: 10, y: 0.5 },
			{ x: 30, y: 0.5 },
			{ x: 50, y: 0.5 }
		]);
		addStepFromBoard(); // step 1 starts at path endpoint (a@50)
		// Undo history now has: create, draw path, add.
		const historyDepth = undoDepth();
		navigateToStep(0); // back to step 0 (a@10)
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(10);
		// Navigation did not add history.
		expect(undoDepth()).toBe(historyDepth);
		navigateToStep(1); // forward to step 1 (a@50)
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(50);
	});
});

describe('clipOps — backward chain propagation', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('moving a step pose updates the previous step path endpoint', () => {
		createAuthoredClipFromBoard();
		// Draw a path on step 0 ending at x=50; forward propagation seeds step 1.
		const step0Id = getActiveClip()!.steps[0].id;
		setEntityPath(step0Id, 'a', [
			{ x: 10, y: 0.5 },
			{ x: 30, y: 0.5 },
			{ x: 50, y: 0.5 }
		]);
		addStepFromBoard(); // step 1 starts at the path endpoint (a@50)
		expect(getActiveStep()!.entities.find((e) => e.id === 'a')?.x).toBe(50);

		// Move entity a on step 1 to x=70 via a gesture commit.
		poseStore.setLive('a', { x: 70, y: 0.5, heading: 0 });
		poseStore.commitGesture('move');

		// Backward propagation: step 0's path endpoint now follows step 1's pose.
		const step0 = getActiveClip()!.steps[0];
		const last = step0.paths![0].points[step0.paths![0].points.length - 1];
		expect(last).toEqual({ x: 70, y: 0.5 });
	});

	it('does not touch the previous step when on step 0', () => {
		createAuthoredClipFromBoard();
		const step0Id = getActiveClip()!.steps[0].id;
		setEntityPath(step0Id, 'a', [
			{ x: 10, y: 0.5 },
			{ x: 30, y: 0.5 },
			{ x: 50, y: 0.5 }
		]);
		// No previous step on step 0: moving the pose must not change the path's
		// stored endpoint (it stays at the drawn destination, x=50).
		poseStore.setLive('a', { x: 70, y: 0.5, heading: 0 });
		poseStore.commitGesture('move');
		const step0 = getActiveClip()!.steps[0];
		const last = step0.paths![0].points[step0.paths![0].points.length - 1];
		expect(last).toEqual({ x: 50, y: 0.5 });
	});
});

describe('clipOps — exitAuthoring', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('clears the session and restores the default commit path', () => {
		createAuthoredClipFromBoard();
		exitAuthoring();
		expect(getActiveClip()).toBeUndefined();
		// Default commit writes to the document only (no active step to sync).
		poseStore.setLive('a', { x: 99, y: 0.9 });
		poseStore.commitGesture('move');
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(99);
	});
});

describe('clipOps — experience transitions (promote / exit)', () => {
	beforeEach(() => resetBoard([entity('a', 10), entity('b', 20)]));

	it('promotes Free → Drill with step 0 = board snapshot', () => {
		const id = createAuthoredClipFromBoard();
		const clip = findAuthoredClip(boardDoc.current, id)!;
		expect(clip.steps).toHaveLength(1);
		// Non-destructive: the free board entities survive (step 0 mirrors them).
		expect(clip.steps[0].entities).toEqual(snapshotPoses(boardDoc.current.entities));
	});

	it('exitToFree exits authoring and restores the free board (entities intact)', () => {
		createAuthoredClipFromBoard();
		expect(getActiveClip()).toBeDefined();
		// Edit the board inside authoring (commit hook mirrors onto the step).
		poseStore.setLive('a', { x: 33, y: 0.3 });
		poseStore.commitGesture('move');

		exitToFree();
		expect(getActiveClip()).toBeUndefined();
		// The free board entities remain on the document (non-destructive exit).
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.x).toBe(33);
		expect(boardDoc.current.entities.find((e) => e.id === 'b')?.x).toBe(20);
	});

	it('exitToFree and exitAuthoring are the same operation', () => {
		expect(exitToFree).toBe(exitAuthoring);
	});
});

function undoDepth(): number {
	let n = 0;
	while (boardDoc.canUndo) {
		boardDoc.undo();
		n++;
	}
	// Redo back to the original state so the test continues from where it was.
	while (boardDoc.canRedo) boardDoc.redo();
	return n;
}
