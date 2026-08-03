import { get } from 'svelte/store';

import { TRACK_SCALE } from '$lib/constants';
import { selectedEntityId } from '$lib/stores/selection';
import { setEntityPath } from '$lib/doc/clipOps';
import type { EntityPath, PlanarPoint, Step } from '$lib/doc/types';
import type { BoardProjection } from './projection';
import type { PathRenderer } from './PathRenderer';

export interface StepQueries {
	getActiveStep(): Step | undefined;
	getAdjacentSteps(): { prevStep: Step | undefined; nextStep: Step | undefined };
}

/**
 * Live editing of movement paths: handle-drag previews (dragmove), document
 * commits (dragend), and keeping path lines anchored to a skater while the
 * skater itself is dragged. All rendering goes through {@link PathRenderer};
 * this class only computes the point arrays.
 */
export class PathEditor {
	constructor(
		private renderer: PathRenderer,
		private projection: BoardProjection,
		private steps: StepQueries
	) {}

	/** Reads handle positions from the layer into a working point array,
	 * preserving index 0 (entity pose, no handle) from stored points. */
	private pointsFromHandles(step: Step, path: EntityPath): PlanarPoint[] | null {
		const handles = this.renderer.handlesFor(step.id, path.id);
		if (handles.length === 0) return null;

		// Start from stored points so index 0 (entity pose) is preserved.
		const newPoints: PlanarPoint[] = path.points.map((p) => ({ ...p }));

		// Inject the entity's pose in THIS step as the first point.
		const entityPose = step.entities.find((e) => e.id === path.entityId);
		if (entityPose && newPoints.length > 0) {
			newPoints[0] = { x: entityPose.x, y: entityPose.y };
		}

		// Overlay handle positions for indices 1..N.
		const center = this.projection.stageCenter();
		handles.forEach((handle) => {
			const pointIndex = handle.getAttr('pointIndex');
			newPoints[pointIndex] = {
				x: (handle.x() - center.x) / TRACK_SCALE,
				y: (handle.y() - center.y) / TRACK_SCALE
			};
		});
		return newPoints;
	}

	/**
	 * Updates the path preview during handle drag (batchDrawn — renders before
	 * the next paint, so it still tracks the handle every move).
	 */
	updatePreview(step: Step, path: EntityPath): void {
		const newPoints = this.pointsFromHandles(step, path);
		if (!newPoints) return;

		this.renderer.redrawLine(step.id, path.id, newPoints);

		// The active step's endpoint chains to the next step's start (index 0),
		// so the two share a node. Keep the next step's line in sync live too —
		// otherwise the shared node only jumps into place on drop.
		const active = this.steps.getActiveStep();
		if (active && step.id === active.id && newPoints.length >= 2) {
			const { nextStep } = this.steps.getAdjacentSteps();
			const nextPath = nextStep?.paths?.find((p) => p.entityId === path.entityId);
			if (nextStep && nextPath) {
				const nextPoints = nextPath.points.map((p) => ({ ...p }));
				nextPoints[0] = { ...newPoints[newPoints.length - 1] };
				this.renderer.redrawLine(nextStep.id, nextPath.id, nextPoints);
			}
		}
	}

	/**
	 * Commits path changes after drag ends (one undo entry), then re-renders
	 * anchored on the active step so prev/current/next realign.
	 */
	commitChanges(step: Step, path: EntityPath): void {
		const newPoints = this.pointsFromHandles(step, path);
		if (!newPoints) return;

		// Commit to the edited step (which may be an adjacent/ghost step).
		setEntityPath(step.id, path.entityId, newPoints);

		const active = this.steps.getActiveStep();
		const { prevStep, nextStep } = this.steps.getAdjacentSteps();
		this.renderer.renderPaths(active, get(selectedEntityId), prevStep, nextStep);
	}

	/**
	 * Live-updates the path lines anchored to a skater while the skater is
	 * dragged. The current step's path starts at the skater (index 0), and the
	 * previous step's path ends at it (the endpoint chains to this pose). Both
	 * are redrawn with `poseMetres` so they track the drag instead of waiting
	 * for the drop commit.
	 */
	updateForEntityPose(entityId: string, poseMetres: PlanarPoint): void {
		const active = this.steps.getActiveStep();
		if (!active) return;

		// Current step: index 0 (start) is the skater's live pose.
		const curPath = active.paths?.find((p) => p.entityId === entityId);
		if (curPath && curPath.points.length >= 2) {
			const pts = curPath.points.map((p) => ({ ...p }));
			pts[0] = { ...poseMetres };
			this.renderer.redrawLine(active.id, curPath.id, pts);
		}

		// Previous-step ghost lines are only rendered for the SELECTED entity
		// (see renderPaths), so the adjacent-step lookup — and its two doc
		// reads — is skipped for every other dragged skater.
		if (entityId !== get(selectedEntityId)) return;

		// Previous step: its endpoint chains to this skater. Index 0 is the prev
		// path's own stored start (not injected — see renderPathGeometry), so we
		// only override the endpoint to follow the drag.
		const { prevStep } = this.steps.getAdjacentSteps();
		const prevPath = prevStep?.paths?.find((p) => p.entityId === entityId);
		if (prevStep && prevPath && prevPath.points.length >= 2) {
			const pts = prevPath.points.map((p) => ({ ...p }));
			pts[pts.length - 1] = { ...poseMetres };
			this.renderer.redrawLine(prevStep.id, prevPath.id, pts);
		}
	}
}
