import { describe, it, expect, beforeEach } from 'vitest';
import { boardDoc } from './store';
import { poseStore } from './poses';
import { createEmptyDoc } from './types';
import type { Entity } from './types';
import { authoringSession } from '$lib/stores/session';
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
	snapshotPoses,
	findAuthoredClip
} from './clipOps';

function entity(id: string, S: number, u = 0.5, heading = 0): Entity {
	return { id, kind: 'skater', team: 'A', role: 'blocker', S, u, heading };
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

	it('appends a step snapshotting the current board', () => {
		createAuthoredClipFromBoard();
		// Move the board (via document edit) then snapshot a new step.
		boardDoc.applyEdit((d) => {
			d.entities.find((e) => e.id === 'a')!.S = 40;
		}, 'move');
		addStepFromBoard();
		const clip = getActiveClip()!;
		expect(clip.steps).toHaveLength(2);
		expect(clip.steps[1].entities[0].S).toBe(40);
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
		poseStore.setLive('a', { S: 77, u: 0.1 });
		poseStore.commitGesture('move');
		const clip = getActiveClip()!;
		// Active step reflects the new pose; original step 0 does not.
		expect(clip.steps[1].entities.find((p) => p.id === 'a')?.S).toBe(77);
		expect(clip.steps[0].entities.find((p) => p.id === 'a')?.S).toBe(10);
	});
});

describe('clipOps — commit hook (one undo reverts board + step)', () => {
	beforeEach(() => resetBoard([entity('a', 10), entity('b', 20)]));

	it('writes a gesture to the document and active step in a single undo entry', () => {
		createAuthoredClipFromBoard();
		poseStore.setLive('a', { S: 30, u: 0.7 });
		poseStore.setLive('b', { S: 40, u: 0.8 });
		const changed = poseStore.commitGesture('move');
		expect(changed).toBe(true);

		const clip = getActiveClip()!;
		expect(clip.steps[0].entities.find((p) => p.id === 'a')?.S).toBe(30);
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.S).toBe(30);

		// A single undo reverts BOTH the board and the step. (The clip's
		// "Create drill" entry remains underneath, so canUndo stays true.)
		const couldUndo = boardDoc.canUndo;
		boardDoc.undo();
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.S).toBe(10);
		expect(getActiveClip()!.steps[0].entities.find((p) => p.id === 'a')?.S).toBe(10);
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
});

describe('clipOps — navigateToStep (history-less)', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('loads a step onto the board without creating undo history', () => {
		createAuthoredClipFromBoard();
		// Step 0: a@10. Add a step with a@50.
		boardDoc.applyEdit((d) => {
			d.entities.find((e) => e.id === 'a')!.S = 50;
		}, 'move');
		addStepFromBoard();
		// Undo history now has: create, move, add.
		const historyDepth = undoDepth();
		navigateToStep(0); // back to step 0 (a@10)
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.S).toBe(10);
		// Navigation did not add history.
		expect(undoDepth()).toBe(historyDepth);
		navigateToStep(1); // forward to step 1 (a@50)
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.S).toBe(50);
	});
});

describe('clipOps — exitAuthoring', () => {
	beforeEach(() => resetBoard([entity('a', 10)]));

	it('clears the session and restores the default commit path', () => {
		createAuthoredClipFromBoard();
		exitAuthoring();
		expect(getActiveClip()).toBeUndefined();
		// Default commit writes to the document only (no active step to sync).
		poseStore.setLive('a', { S: 99, u: 0.9 });
		poseStore.commitGesture('move');
		expect(boardDoc.current.entities.find((e) => e.id === 'a')?.S).toBe(99);
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
