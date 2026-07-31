import { get } from 'svelte/store';
import { boardDoc } from './store';
import { poseStore, type Pose, type CommitGestureOptions, applyHeadingModeOpts } from './poses';
import { authoringSession } from '$lib/stores/session';
import type {
	AuthoredClip,
	BoardDoc,
	Entity,
	EntityPose,
	Step,
	PlanarPoint,
	Annotation
} from './types';
import { MAX_STEPS_PER_CLIP } from './types';

/** Captures the live board's poses (id + x/y/heading) as a step payload. */
export function snapshotPoses(entities: Entity[]): EntityPose[] {
	return entities.map((e) => ({
		id: e.id,
		x: e.x,
		y: e.y,
		heading: e.heading,
		manualHeading: e.manualHeading,
		headingMode: e.headingMode,
		headingDelta: e.headingDelta,
		lookAt: e.lookAt
	}));
}

/**
 * Computes where each entity ENDS up after a step — i.e. the path's last
 * point if a path exists, or the step's start pose if not. Used when adding
 * a new step so it starts where the previous step's movement finishes.
 */
function arrivalPosesFromStep(step: Step): EntityPose[] {
	return step.entities.map((e) => {
		const path = step.paths?.find((p) => p.entityId === e.id);
		if (path && path.points.length > 0) {
			const last = path.points[path.points.length - 1];
			return { ...e, x: last.x, y: last.y };
		}
		return { ...e };
	});
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
	if (clip.steps.length >= MAX_STEPS_PER_CLIP) return null;
	const stepId = newId();
	// The new step starts where the previous step's movement ends — at the
	// path endpoint, not the previous step's start pose.
	const lastStep = clip.steps[clip.steps.length - 1];
	const poses = lastStep
		? arrivalPosesFromStep(lastStep)
		: snapshotPoses(boardDoc.current.entities);
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
	if (clip.steps.length >= MAX_STEPS_PER_CLIP) return null;
	const source = clip.steps[idx];
	const stepId = newId();
	const insertAt = idx + 1;
	// The duplicate starts where the source step ENDS (at path endpoints),
	// not where it started. Paths are NOT inherited — the duplicate is a
	// fresh starting point for the next movement.
	const arrivalPoses = arrivalPosesFromStep(source);
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const copy: Step = {
			id: stepId,
			title: source.title,
			entities: arrivalPoses.map((p) => ({ ...p })),
			annotations: source.annotations?.map((a) => ({
				...a,
				...(a.kind === 'pen' || a.kind === 'zone'
					? { points: a.points.map((pt) => ({ ...pt })) }
					: {})
			})),
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
 * Sets (replaces) the path for `entityId` on `stepId`. One undo entry.
 *
 * **Chain propagation:** the path's last point is also written onto the next
 * step's entity pose so the visual endpoint always matches what was drawn.
 * Without this, endpoint injection at resolve time would snap the visual end
 * to whatever pose step i+1 happens to have, ignoring the drawn destination.
 */
export function setEntityPath(stepId: string, entityId: string, points: PlanarPoint[]): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const stepIdx = c.steps.findIndex((s) => s.id === stepId);
		if (stepIdx < 0) return;
		const step = c.steps[stepIdx];

		if (!step.paths) step.paths = [];
		const finitePoints = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

		const existingIdx = step.paths.findIndex((p) => p.entityId === entityId);
		if (existingIdx >= 0) {
			step.paths[existingIdx] = {
				id: step.paths[existingIdx].id,
				entityId,
				points: finitePoints.map((pt) => ({ ...pt }))
			};
		} else {
			step.paths.push({
				id: newId(),
				entityId,
				points: finitePoints.map((pt) => ({ ...pt }))
			});
		}

		// Chain: propagate the path's last point to the next step's entity pose
		// so the drawn endpoint and the stored arrival pose agree.
		if (finitePoints.length >= 2 && stepIdx < c.steps.length - 1) {
			const endPoint = finitePoints[finitePoints.length - 1];
			const nextStep = c.steps[stepIdx + 1];
			const nextEntity = nextStep.entities.find((e) => e.id === entityId);
			if (nextEntity) {
				nextEntity.x = endPoint.x;
				nextEntity.y = endPoint.y;
			}
		}
	}, 'Draw path');
}

/** Removes the path for `entityId` from `stepId`. No-op if absent. */
export function clearEntityPath(stepId: string, entityId: string): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step || !step.paths) return;
		step.paths = step.paths.filter((p) => p.entityId !== entityId);
	}, 'Clear path');
}

/** Deletes the path object with `pathId` from `stepId`. No-op if absent. */
export function deletePath(stepId: string, pathId: string): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step || !step.paths) return;
		step.paths = step.paths.filter((p) => p.id !== pathId);
	}, 'Delete path');
}

/** Appends an annotation to `stepId`. Returns the new annotation id (caller may pass its own id). */
export function addAnnotation(
	stepId: string,
	ann: Omit<Annotation, 'id'> & { id?: string }
): string {
	const id = ann.id ?? newId();
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step) return;

		if (!step.annotations) step.annotations = [];

		const filtered: Annotation = { ...ann, id } as Annotation;

		if ('points' in filtered && Array.isArray(filtered.points)) {
			(filtered as Extract<Annotation, { kind: 'pen' | 'zone' }>).points = filtered.points.filter(
				(p) => Number.isFinite(p.x) && Number.isFinite(p.y)
			);
		}

		step.annotations.push(filtered);
	}, 'Add annotation');
	return id;
}

/** Replaces an annotation by id (full replacement; used after a reshape/edit). */
export function updateAnnotation(stepId: string, annId: string, ann: Annotation): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step || !step.annotations) return;

		const idx = step.annotations.findIndex((a) => a.id === annId);
		if (idx >= 0) {
			const filtered: Annotation = { ...ann, id: annId };

			if ('points' in filtered && Array.isArray(filtered.points)) {
				(filtered as Extract<Annotation, { kind: 'pen' | 'zone' }>).points = filtered.points.filter(
					(p) => Number.isFinite(p.x) && Number.isFinite(p.y)
				);
			}

			step.annotations[idx] = filtered;
		}
	}, 'Edit annotation');
}

/** Deletes an annotation by id. No-op if absent. */
export function deleteAnnotation(stepId: string, annId: string): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step || !step.annotations) return;
		step.annotations = step.annotations.filter((a) => a.id !== annId);
	}, 'Delete annotation');
}

/** Removes every annotation from `stepId`. */
export function clearAnnotations(stepId: string): void {
	boardDoc.applyEdit((draft) => {
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		if (!c) return;
		const step = c.steps.find((s) => s.id === stepId);
		if (!step) return;
		step.annotations = undefined;
	}, 'Clear annotations');
}

/**
 * Writes the current board poses onto the active step within ONE undo entry
 * that also writes the live poses to the document — so undo reverts the board
 * move and the step snapshot together. Registered as the PoseStore commit
 * hook while authoring is active.
 */
function commitAuthoringGesture(
	poses: Map<string, Pose>,
	label: string,
	opts?: CommitGestureOptions
): boolean {
	return boardDoc.applyEdit((draft) => {
		for (const [id, pose] of poses) {
			if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.heading)) {
				continue;
			}
			const entity = draft.entities.find((e) => e.id === id);
			if (entity) {
				entity.x = pose.x;
				entity.y = pose.y;
				entity.heading = pose.heading;
				if (opts?.setManualHeading) {
					entity.manualHeading = true;
				}
				applyHeadingModeOpts(entity, opts);
			}
		}
		// Mirror the resulting full board onto the active step (poses only).
		const c = findAuthoredClip(draft, get(authoringSession).activeClipId);
		const idx = clampedStepIndex(c, get(authoringSession).activeStepIndex);
		if (c && idx >= 0) {
			c.steps[idx].entities = snapshotPoses(draft.entities);
			// When setManualHeading is true, also set manualHeading on the step's entities.
			if (opts?.setManualHeading) {
				for (const [id] of poses) {
					const stepEntity = c.steps[idx].entities.find((e) => e.id === id);
					if (stepEntity) {
						stepEntity.manualHeading = true;
					}
				}
			}
			// Apply the heading-mode opts to the touched step entities too, so a
			// rotation/lock authored on the board persists into the step.
			for (const [id] of poses) {
				const stepEntity = c.steps[idx].entities.find((e) => e.id === id);
				if (stepEntity) {
					applyHeadingModeOpts(stepEntity, opts);
				}
			}

			// Backward chain propagation: a moved arrival pose must also move the
			// PREVIOUS step's path endpoint for that entity, so the drawn path's
			// last point tracks the new position. setEntityPath does the forward
			// mirror (path endpoint → next step pose); this completes the pair.
			// renderPaths draws the STORED endpoint (not injected, by design), so
			// without this the visual lags the pose even though playback — which
			// re-derives the endpoint from the pose — already follows it.
			if (idx > 0) {
				const prevStep = c.steps[idx - 1];
				if (prevStep.paths) {
					for (const [id, pose] of poses) {
						if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) continue;
						const path = prevStep.paths.find((p) => p.entityId === id);
						if (path && path.points.length >= 2) {
							const last = path.points[path.points.length - 1];
							last.x = pose.x;
							last.y = pose.y;
						}
					}
				}
			}
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
		return p ? { ...e, x: p.x, y: p.y, heading: p.heading } : e;
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
 * Loads a step's ARRIVAL poses (path endpoints) onto the board so entities
 * show where they end up after the step's movement completes. Used after
 * playback so the board doesn't snap back to start poses.
 */
export function loadStepArrivalOntoBoard(index: number): void {
	const doc = boardDoc.current;
	const clip = getActiveClip(doc);
	const step = clip?.steps[index];
	if (!step) return;
	const arrival = arrivalPosesFromStep(step);
	const byId = new Map(arrival.map((p) => [p.id, p]));
	const entities = doc.entities.map((e) => {
		const p = byId.get(e.id);
		return p ? { ...e, x: p.x, y: p.y, heading: p.heading } : e;
	});
	boardDoc.setView({ ...doc, entities });
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
 * Nudges an entity by ±1 lap. Under the planar-coordinate model the lap index
 * is not stored (a full lap maps to the same world point), so this is a no-op
 * for the board/step pose. It is retained for the future lap-readout UI, which
 * will carry an explicit lap counter; until then nothing user-facing calls it.
 */
export function nudgeLap(_id: string, delta: number): void {
	if (delta !== 1 && delta !== -1) return;
	// No-op in the planar model (see docstring).
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
