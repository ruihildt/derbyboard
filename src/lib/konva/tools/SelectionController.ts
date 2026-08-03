import { get } from 'svelte/store';
import type Konva from 'konva';

import { toolMode } from '$lib/stores/toolMode';
import {
	selectedEntityId,
	selectedAnnotationId,
	directionControlActive
} from '$lib/stores/selection';
import { deleteAnnotation, deletePath } from '$lib/doc/clipOps';
import type { Step } from '$lib/doc/types';
import { playerIdFromEvent, annotationIdFromEvent, pathIdFromEvent } from './hitTest';

export interface SelectionDeps {
	stage: Konva.Stage;
	isReplayMode: () => boolean;
	/** Swallow the click that follows an annotation gesture (see AnnotationGestures). */
	consumeClickSuppression: () => boolean;
	/** Focus/dim tap-to-select state (P3 task 9), armed by the UI. Click taps
	 * require a callback; double-click is suppressed whenever armed. */
	focusTap: { isArmed: () => boolean; hasCallback: () => boolean; notify: (id: string) => void };
	getActiveStep: () => Step | undefined;
	getAdjacentSteps: () => { prevStep: Step | undefined; nextStep: Step | undefined };
	renderAnnotations: (step: Step | undefined) => void;
	renderPaths: (
		step: Step | undefined,
		selectedEntityId: string | null,
		prevStep: Step | undefined,
		nextStep: Step | undefined
	) => void;
}

/**
 * Tap/click selection dispatch (P3 task 9, P4 task 6):
 *  - single click on a skater → select it (dotted halo), direction control OFF
 *  - double click on a skater → select it AND activate the direction control
 *    (knob + dashed guide line)
 *  - click another skater → select that one, direction control OFF
 *  - click empty canvas → deselect, direction control OFF
 *  - erase tool: tap an annotation or an active-step path to delete it
 *  - focus/dim mode: taps toggle entities into the focus set instead
 * Single click resolves immediately (no delay): a double-click simply
 * upgrades the just-selected skater to direction-control mode.
 */
export class SelectionController {
	constructor(private deps: SelectionDeps) {}

	/** Registers the stage click/tap and double-click handlers. */
	attach(): void {
		const { stage } = this.deps;
		stage.on('click tap', (e) => this.handleClick(e));
		stage.on('dblclick dbltap', (e) => this.handleDoubleClick(e));
	}

	private handleClick(e: Konva.KonvaEventObject<unknown>): void {
		if (this.deps.isReplayMode()) return;
		// Swallow the click that follows a gesture (mouse fires one even
		// after a drag) so it doesn't deselect the just-manipulated mark.
		if (this.deps.consumeClickSuppression()) return;
		// In hand mode the canvas is a pan surface — taps must not select.
		if (get(toolMode) === 'hand') return;

		// Erase tool: tap an annotation or an active-step movement path to
		// delete it. Players are never affected; only the active step's own
		// paths are erasable (ghost/adjacent-step paths are read-only).
		if (get(toolMode) === 'erase') {
			const annId = annotationIdFromEvent(e);
			if (annId) {
				deleteAnnotation(annId);
				selectedAnnotationId.set(null);
				this.deps.renderAnnotations(this.deps.getActiveStep());
				return;
			}
			const pathHit = pathIdFromEvent(e);
			if (pathHit) {
				const active = this.deps.getActiveStep();
				if (active && pathHit.stepId === active.id) {
					deletePath(active.id, pathHit.pathId);
					const { prevStep, nextStep } = this.deps.getAdjacentSteps();
					this.deps.renderPaths(active, get(selectedEntityId), prevStep, nextStep);
				}
			}
			return;
		}

		const id = playerIdFromEvent(e);
		if (id) {
			if (this.deps.focusTap.isArmed() && this.deps.focusTap.hasCallback()) {
				// Focus/dim mode (P3): use callback.
				this.deps.focusTap.notify(id);
				return;
			}
			// Single-select: select the entity, direction control inactive.
			// Mutual exclusion: selecting a skater clears any mark.
			selectedEntityId.set(id);
			directionControlActive.set(false);
			selectedAnnotationId.set(null);

			// In the path tool, selecting a player that already has a path in
			// the current step drops into Select so its editing nodes appear.
			// A player with no path stays the tool armed so the user can draw one.
			if (get(toolMode) === 'drawPath') {
				const step = this.deps.getActiveStep();
				const hasPath = step?.paths?.some((p) => p.entityId === id) ?? false;
				if (hasPath) toolMode.set('select');
			}
		} else {
			const annId = annotationIdFromEvent(e);
			if (annId && get(toolMode) === 'select') {
				// Select the annotation; mutual exclusion clears the entity.
				selectedEntityId.set(null);
				selectedAnnotationId.set(annId);
				directionControlActive.set(false);
				e.cancelBubble = true;
			} else {
				// Any other non-skater click (empty canvas, track lines, …) or a
				// non-select tool: deselect everything and exit direction mode.
				selectedEntityId.set(null);
				selectedAnnotationId.set(null);
				directionControlActive.set(false);
			}
		}
	}

	private handleDoubleClick(e: Konva.KonvaEventObject<unknown>): void {
		if (this.deps.isReplayMode()) return;
		if (this.deps.focusTap.isArmed()) return; // don't interfere with focus mode
		if (get(toolMode) === 'hand') return; // hand is a pan surface only
		const id = playerIdFromEvent(e);
		if (id) {
			selectedEntityId.set(id);
			directionControlActive.set(true);
			selectedAnnotationId.set(null);
		} else {
			selectedEntityId.set(null);
			directionControlActive.set(false);
			selectedAnnotationId.set(null);
		}
	}
}
