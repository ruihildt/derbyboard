import { get } from 'svelte/store';
import { boardDoc } from './store';
import { poseStore, type Pose } from './poses';
import { authoringSession } from '$lib/stores/session';
import type { AuthoredClip, BoardDoc, Entity, EntityPose, Step } from './types';

/** Captures the live board's poses (id + S/u/heading) as a step payload. */
export function snapshotPoses(entities: Entity[]): EntityPose[] {
	return entities.map((e) => ({ id: e.id, S: e.S, u: e.u, heading: e.heading }));
}

function newId(): string {
	return crypto.randomUUID();
}

/** Finds the active authored clip in a doc by id; returns undefined if absent/locked. */
export function findAuthoredClip(doc: BoardDoc, clipId: string | null): AuthoredClip | undefined {
	if (!clipId) return undefined;
	const clip = doc.clips.find((c) => c.id === clipId);
	return clip && clip.kind === 'authored' ? clip : undefined;
}

/** The authored clip currently being edited, or undefined. */
export function getActiveClip(doc: BoardDoc = boardDoc.current): AuthoredClip | undefined {
	const s = get(authoringSession);
	return findAuthoredClip(doc, s.activeClipId);
}

/** Clamps the session's step index to the active clip's step range. */
export function clampedStepIndex(clip: AuthoredClip | undefined, index: number): number {
	if (!clip || clip.steps.length === 0) return -1;
	return Math.min(clip.steps.length - 1, Math.max(0, index));
}

/** The active step's index (clamped), or -1 when not authoring. */
export function activeStepIndex(doc: BoardDoc = boardDoc.current): number {
	const clip = getActiveClip(doc);
	return clampedStepIndex(clip, get(authoringSession).activeStepIndex);
}

/** The active step object, or undefined. */
export function getActiveStep(doc: BoardDoc = boardDoc.current): Step | undefined {
	const clip = getActiveClip(doc);
	const idx = activeStepIndex(doc);
	return clip && idx >= 0 ? clip.steps[idx] : undefined;
}

/**
 * Creates a new authored clip whose first step is a snapshot of the current
 * board, makes it the active clip, and navigates to step 0. Returns the new
 * clip id. This is the entry point into authoring mode.
 */
export function createAuthoredClipFromBoard(title?: string): string {
	const clipId = newId();
	const step0: Step = { id: newId(), entities: snapshotPoses(boardDoc.current.entities) };
	boardDoc.applyEdit((draft) => {
		draft.clips.push({ kind: 'authored', id: clipId, title, steps: [step0] });
		draft.activeClipId = clipId;
	}, 'Create drill');
	authoringSession.set({ activeClipId: clipId, activeStepIndex: 0 });
	installAuthoringCommitHook();
	return clipId;
}

/**
 * Appends a new step that snapshots the CURRENT board, then navigates to it.
 * Lets a coach branch a drill from its current state. One undo entry.
 */
export function addStepFromBoard(title?: string): string | null {
	const clip = getActiveClip();
	if (!clip) return null;
	const stepId = newId();
	const poses = snapshotPoses(boardDoc.current.entities);
	const insertAt = clip.steps.length;
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		c.steps.push({ id: stepId, title, entities: poses });
	}, 'Add step');
	navigateToStep(insertAt);
	return stepId;
}

/**
 * Duplicate-and-nudge (the PRIMARY authoring flow): clones the active step's
 * poses into a new step inserted immediately after it, then navigates to the
 * copy so the coach can drag only what changed. One undo entry.
 */
export function duplicateActiveStep(): string | null {
	const clip = getActiveClip();
	const idx = activeStepIndex();
	if (!clip || idx < 0) return null;
	const source = clip.steps[idx];
	const stepId = newId();
	const insertAt = idx + 1;
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const copy: Step = {
			id: stepId,
			title: source.title,
			entities: source.entities.map((p) => ({ ...p })),
			holdMs: source.holdMs,
			showPackZone: source.showPackZone
		};
		c.steps.splice(insertAt, 0, copy);
	}, 'Duplicate step');
	// Load the copy onto the board so its poses are live/editable, then navigate.
	loadStepOntoBoard(insertAt);
	navigateToStep(insertAt);
	return stepId;
}

/** Deletes a step by id. Never deletes the last remaining step. */
export function deleteStep(stepId: string): void {
	const clip = getActiveClip();
	if (!clip || clip.steps.length <= 1) return;
	const idx = clip.steps.findIndex((s) => s.id === stepId);
	if (idx < 0) return;
	const wasActive = idx === activeStepIndex();
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		c.steps = c.steps.filter((s) => s.id !== stepId);
	}, 'Delete step');
	// Keep the board pointing at a valid step; if we removed the active one,
	// clamp to the previous step and reload it.
	const newIdx = Math.max(0, idx - 1);
	navigateToStep(newIdx, wasActive);
}

/** Reorders a step from one index to another within the active clip. */
export function moveStep(fromIndex: number, toIndex: number): void {
	const clip = getActiveClip();
	if (!clip) return;
	if (fromIndex < 0 || fromIndex >= clip.steps.length) return;
	const clampedTo = Math.min(clip.steps.length - 1, Math.max(0, toIndex));
	if (fromIndex === clampedTo) return;
	const activeId = clip.steps[activeStepIndex()]?.id;
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const [moved] = c.steps.splice(fromIndex, 1);
		c.steps.splice(clampedTo, 0, moved);
	}, 'Reorder step');
	// Keep the same step active by id after the move.
	const newActiveIdx = clip.steps.findIndex((s) => s.id === activeId);
	if (newActiveIdx >= 0) {
		authoringSession.update((s) => ({ ...s, activeStepIndex: newActiveIdx }));
	}
}

/** Renames a step by id. */
export function renameStep(stepId: string, title: string): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (step) step.title = title || undefined;
	}, 'Rename step');
}

/** Toggles the pack/engagement-zone overlay visibility persisted on a step. */
export function setStepPackZone(stepId: string, show: boolean): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (step) step.showPackZone = show;
	}, 'Toggle pack zone');
}

/**
 * Writes the current board poses onto the active step within ONE undo entry
 * that also writes the live poses to the document — so undo reverts the board
 * move and the step snapshot together. Registered as the PoseStore commit
 * hook while authoring is active.
 */
function commitAuthoringGesture(poses: Map<string, Pose>, label: string): boolean {
	return boardDoc.applyEdit((draft) => {
		for (const [id, pose] of poses) {
			if (!Number.isFinite(pose.S) || !Number.isFinite(pose.u) || !Number.isFinite(pose.heading)) {
				continue;
			}
			const entity = draft.entities.find((e) => e.id === id);
			if (entity) {
				entity.S = pose.S;
				entity.u = pose.u;
				entity.heading = pose.heading;
			}
		}
		// Mirror the resulting full board onto the active step (poses only).
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		const idx = clampedStepIndex(c, get(authoringSession).activeStepIndex);
		if (c && idx >= 0) {
			c.steps[idx].entities = snapshotPoses(draft.entities);
		}
	}, label);
}

/** Installs the authoring commit hook so drags sync the active step atomically. */
export function installAuthoringCommitHook(): void {
	poseStore.setCommitHook(commitAuthoringGesture);
}

/** Restores the default (document-only) commit path. */
export function removeAuthoringCommitHook(): void {
	poseStore.setCommitHook(null);
}

/**
 * Replaces the live board's poses with a step's poses, preserving roster
 * metadata (kind/team/role/id). Entities are matched by id; a step that omits
 * an entity keeps that entity's current pose, and extra poses are ignored.
 * History-less: this is view navigation, not an edit.
 */
function applyStepPosesToBoard(doc: BoardDoc, step: Step | undefined): BoardDoc {
	if (!step) return doc;
	const byId = new Map(step.entities.map((p) => [p.id, p]));
	const entities = doc.entities.map((e) => {
		const p = byId.get(e.id);
		return p ? { ...e, S: p.S, u: p.u, heading: p.heading } : e;
	});
	return { ...doc, entities };
}

/** Loads a step's poses onto the board (no history, no navigation record). */
export function loadStepOntoBoard(index: number): void {
	const doc = boardDoc.current;
	const clip = getActiveClip(doc);
	const step = clip?.steps[index];
	boardDoc.setView(applyStepPosesToBoard(doc, step));
}

/**
 * Navigates to a step: loads its poses onto the board and records the active
 * index in the session. `reloadBoard` defaults to true; pass false to keep the
 * current board (e.g. after a structural edit that already updated the board).
 */
export function navigateToStep(index: number, reloadBoard = true): void {
	const clip = getActiveClip();
	const idx = clampedStepIndex(clip, index);
	authoringSession.set({
		activeClipId: get(authoringSession).activeClipId,
		activeStepIndex: idx
	});
	if (reloadBoard && idx >= 0) {
		loadStepOntoBoard(idx);
	}
}

/** Steps the user one step forward/backward (clamped to the clip range). */
export function stepBy(delta: number): void {
	navigateToStep(activeStepIndex() + delta);
}

/** Leaves authoring mode: clears the session and restores the default commit path. */
export function exitAuthoring(): void {
	removeAuthoringCommitHook();
	authoringSession.set({ activeClipId: null, activeStepIndex: -1 });
}

/**
 * Loads a lineup preset onto the board as an undoable edit (so a misclick is
 * reversible), replacing the roster. Exits authoring first so the new roster
 * isn't written onto a stale clip's active step.
 */
export function loadPresetEntities(entities: Entity[]): void {
	exitAuthoring();
	boardDoc.applyEdit((draft) => {
		draft.entities = entities;
	}, 'Load lineup');
}

/**
 * Re-establishes the authoring commit hook for an already-active session
 * (e.g. on reload). Safe to call when no clip is active.
 */
export function syncAuthoringStateFromSession(): void {
	const doc = boardDoc.current;
	const clip = getActiveClip(doc);
	if (clip) {
		installAuthoringCommitHook();
		// Ensure the board reflects the persisted active step on restore.
		const idx = clampedStepIndex(clip, get(authoringSession).activeStepIndex);
		if (idx >= 0) loadStepOntoBoard(idx);
	} else if (get(authoringSession).activeClipId !== null) {
		// Stale session referencing a clip that no longer exists.
		authoringSession.set({ activeClipId: null, activeStepIndex: -1 });
	}
}
