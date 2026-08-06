import { get } from 'svelte/store';
import Konva from 'konva';
import type { Circle } from 'konva/lib/shapes/Circle';

import { PLAYER_RADIUS, TRACK_SCALE } from '$lib/constants';
import { boardSettings } from '$lib/stores/boardSettings';
import { toolMode } from '$lib/stores/toolMode';
import { MAX_PATH_LENGTH_M } from '$lib/track/tween';
import { clampNodeToBudget } from '$lib/track/pathMath';
import type { EntityPath, PlanarPoint, Step } from '$lib/doc/types';
import type { PathFrame } from '$lib/recording/timeline/types';
import { entityColorFor } from '../entityColors';
import type { BoardProjection } from './projection';

/**
 * Renders movement paths for authored steps onto the path layer, plus the
 * draggable editing handles (top control layer) in Select mode.
 *
 * Two paint paths share the layer:
 *  - {@link renderPaths}: interactive editing view (ghost lines for adjacent
 *    steps + current-step paths filtered by selection/overlay mode).
 *  - {@link renderPathFrame}: replay/export view painting a recorded
 *    PathFrame; lines are cached by path id and updated in place so an
 *    unchanged frame costs zero node allocations.
 */
export class PathRenderer {
	/**
	 * Last-rendered path overlay state. Updated whenever `renderPaths` or
	 * `renderPathFrame` paints, so `getSnapshot()` captures what is actually
	 * on screen (not a stale document lookup that ignores playback step).
	 */
	private currentPathFrame: PathFrame | undefined;

	/**
	 * Reusable replay path lines, keyed by `prev:|next:|cur:` + path id.
	 * Owned by {@link renderPathFrame}; any code that wipes `pathLayer`
	 * directly (renderPaths) must clear this map too.
	 */
	private pathFrameLines = new Map<string, Konva.Line>();

	/** Wired by the owner: live preview while a handle is dragged. */
	onDragMove: ((step: Step, path: EntityPath) => void) | null = null;
	/** Wired by the owner: commit on handle drop. */
	onDragEnd: ((step: Step, path: EntityPath) => void) | null = null;

	constructor(
		private pathLayer: Konva.Layer,
		private controlLayer: Konva.Layer,
		private stage: Konva.Stage,
		private projection: BoardProjection,
		/** During replay the path layer is managed by renderPathFrame. */
		private isReplayMode: () => boolean
	) {}

	/** Current path-frame reference (identity, not a copy) for change detection. */
	getPathFrameRef(): PathFrame | undefined {
		return this.currentPathFrame;
	}

	/**
	 * Renders movement paths for a step. If step is undefined, clears the layer.
	 * Paths are shown for the selected entity or when pathOverlay mode is 'all'.
	 *
	 * In Select the previous/current/next steps' paths for the selected entity
	 * are all rendered with their draggable editing nodes — the adjacent-step
	 * (ghost) lines keep a distinct muted colour and are drawn behind the active
	 * step. In other tools only the lines are shown (no handles).
	 */
	renderPaths(
		step: Step | undefined,
		selectedEntityIds: string[],
		prevStep?: Step | undefined,
		nextStep?: Step | undefined
	): void {
		// During replay, the path layer is managed by renderPathFrame (called
		// from renderSampleTransform). Bail out so the StepStrip Svelte
		// $effect (which fires when the selection is cleared on replay
		// start) can't destroyChildren and wipe the paths just drawn.
		if (this.isReplayMode()) return;

		this.pathLayer.destroyChildren();
		this.pathFrameLines.clear();
		this.clearHandles();

		const editable = get(toolMode) === 'select';
		const selected = new Set(selectedEntityIds);
		// Editing handles only make sense for one path at a time, so they are
		// shown only in a single selection (the primary); a multi-selection
		// still renders every selected path's line, just without drag nodes.
		const single = selected.size === 1;

		// Adjacent-step (ghost) paths for each selected entity, drawn first so
		// they sit behind the active step. In Select a single selection gets
		// editing nodes too.
		for (const id of selectedEntityIds) {
			this.renderGhostPath(prevStep, id, editable && single, 'prev');
			this.renderGhostPath(nextStep, id, editable && single, 'next');
		}

		if (!step?.paths) {
			this.currentPathFrame = undefined;
			this.pathLayer.batchDraw();
			this.controlLayer.batchDraw();
			return;
		}

		const overlayMode = get(boardSettings).pathOverlay ?? 'off';

		for (const path of step.paths) {
			const isSelected = selected.has(path.entityId);
			const shouldRender =
				isSelected || overlayMode === 'all' || (overlayMode === 'selected' && isSelected);

			if (!shouldRender) continue;

			// Handles only for the single selected entity's own path.
			this.renderPathGeometry(
				step,
				path,
				entityColorFor(path.entityId),
				'current',
				editable && single && isSelected
			);
		}

		// Cache the full step path data for getSnapshot() so a recording
		// captures the exact step currently being visualised (not whatever
		// the document's active step happens to be).
		const toEntries = (s: Step | undefined) =>
			s?.paths?.map((p) => ({ id: p.id, entityId: p.entityId, points: p.points }));
		this.currentPathFrame = {
			paths: step.paths.map((p) => ({ id: p.id, entityId: p.entityId, points: p.points })),
			selectedEntityId: selectedEntityIds.length ? selectedEntityIds[0] : null,
			prevPaths: toEntries(prevStep),
			nextPaths: toEntries(nextStep)
		};

		this.pathLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/**
	 * Renders the path overlay from a recorded PathFrame (used by replay and
	 * export so captured recordings include per-step paths). Renders ALL paths
	 * in the frame — the frame already represents the visual state captured at
	 * record time, so no overlay/selection filtering is applied.
	 *
	 * Lines are cached by path id and updated in place (points/stroke), so a
	 * replay frame with unchanged paths costs zero node allocations; only
	 * added/removed paths create/destroy nodes.
	 */
	renderPathFrame(frame: PathFrame | undefined): void {
		this.currentPathFrame = frame;
		if (!frame) {
			if (this.pathFrameLines.size > 0) {
				for (const line of this.pathFrameLines.values()) line.destroy();
				this.pathFrameLines.clear();
				this.pathLayer.batchDraw();
			}
			return;
		}

		const strokeWidth = Math.max(2, (PLAYER_RADIUS * 0.4) / this.stage.scaleX());
		const ghostStrokeWidth = Math.max(1.5, (PLAYER_RADIUS * 0.3) / this.stage.scaleX());
		const seen = new Set<string>();

		const upsertLine = (
			key: string,
			points: PlanarPoint[],
			opts: Konva.LineConfig,
			ghost: boolean
		): void => {
			const projected = this.projection.smoothProject(points);
			if (!projected) return;
			seen.add(key);
			const flat = projected.flatMap((p) => [p.x, p.y]);
			const existing = this.pathFrameLines.get(key);
			if (existing) {
				existing.points(flat);
				existing.setAttrs(opts);
				if (ghost) existing.moveToBottom();
				return;
			}
			const line = new Konva.Line({
				points: flat,
				listening: false,
				...opts
			});
			this.pathFrameLines.set(key, line);
			this.pathLayer.add(line);
			if (ghost) line.moveToBottom();
		};

		const ghostOpts: Konva.LineConfig = {
			stroke: '#dc2626',
			strokeWidth: ghostStrokeWidth,
			dash: [6, 4],
			lineCap: 'round',
			lineJoin: 'round',
			opacity: 0.5
		};
		frame.prevPaths?.forEach((p) => upsertLine(`prev:${p.id}`, p.points, ghostOpts, true));
		frame.nextPaths?.forEach((p) => upsertLine(`next:${p.id}`, p.points, ghostOpts, true));

		for (const path of frame.paths) {
			upsertLine(
				`cur:${path.id}`,
				path.points,
				{
					stroke: entityColorFor(path.entityId),
					strokeWidth,
					tension: 0,
					opacity: 0.85
				},
				false
			);
		}

		// Remove lines whose path is no longer in the frame.
		for (const [key, line] of this.pathFrameLines) {
			if (!seen.has(key)) {
				line.destroy();
				this.pathFrameLines.delete(key);
			}
		}

		this.pathLayer.batchDraw();
	}

	/**
	 * Renders the selected entity's path from an adjacent step as a dashed
	 * ghost line, drawn behind the active step. In Select the path's editing
	 * nodes are added too; the line keeps its distinct muted colour.
	 */
	private renderGhostPath(
		step: Step | undefined,
		entityId: string,
		editable: boolean,
		adjacency: 'prev' | 'next'
	): void {
		const path = step?.paths?.find((p) => p.entityId === entityId);
		if (!path || !step) return;
		this.renderPathGeometry(step, path, '#dc2626', adjacency, editable);
	}

	/**
	 * Renders a single path: its line plus, when editable, control handles.
	 * `mode` is 'current' (active step), 'prev' or 'next' (adjacent ghosts);
	 * ghosts use the muted dashed line. Lines and handles are tagged with
	 * (stepId, pathId) so the drag handlers target the exact path on screen.
	 */
	private renderPathGeometry(
		step: Step,
		path: EntityPath,
		color: string,
		mode: 'current' | 'prev' | 'next',
		editable: boolean
	): void {
		const ghost = mode !== 'current';
		const renderPoints = path.points.map((p) => ({ ...p }));
		// Inject the entity's pose in this step as point 0 so the line always
		// starts at the skater — except for the previous-step ghost, whose first
		// node is a freely draggable control point (injecting would reset it to
		// the entity pose on every re-render).
		if (mode !== 'prev') {
			const startPose = step.entities.find((e) => e.id === path.entityId);
			if (startPose && renderPoints.length > 0) {
				renderPoints[0] = { x: startPose.x, y: startPose.y };
			}
		}

		const projectedPoints = this.projection.smoothProject(renderPoints);
		if (!projectedPoints) return;

		const strokeWidth = ghost
			? Math.max(1.5, (PLAYER_RADIUS * 0.3) / this.stage.scaleX())
			: Math.max(2, (PLAYER_RADIUS * 0.4) / this.stage.scaleX());

		const line = new Konva.Line({
			name: 'lineShape',
			points: projectedPoints.flatMap((p) => [p.x, p.y]),
			stroke: color,
			strokeWidth,
			dash: ghost ? [6, 4] : undefined,
			lineCap: 'round',
			lineJoin: 'round',
			tension: 0,
			opacity: ghost ? 0.5 : 0.85,
			// Active-step lines are tappable so the erase tool can target them;
			// ghost (adjacent-step) lines are not (they aren't erasable).
			listening: !ghost
		});
		line.setAttr('stepId', step.id);
		line.setAttr('pathId', path.id);
		this.pathLayer.add(line);

		if (editable) {
			this.renderPathHandles(step, path, renderPoints, color, mode);
		}
	}

	/**
	 * Adds control handles for one path. Each draggable handle clamps its drag
	 * to the path's remaining length budget so a node can't push it past
	 * MAX_PATH_LENGTH_M. (Path deletion is handled by the erase tool.)
	 *
	 * `mode` shapes which nodes appear:
	 *  - current/next skip index 0 (anchored to a live position — the player,
	 *    or, for next, the current path's endpoint).
	 *  - prev instead skips its LAST index: that endpoint chains to the current
	 *    player, so a handle there would sit on (and hijack) the skater. Its
	 *    first node (index 0) has no live anchor, so it gets a regular draggable
	 *    handle (clamped only by its single segment to the next node).
	 */
	private renderPathHandles(
		step: Step,
		path: EntityPath,
		renderPoints: PlanarPoint[],
		color: string,
		mode: 'current' | 'prev' | 'next'
	): void {
		// Precompute metre-space positions and total length so each handle's
		// budget is cheap to derive. Only the dragged node's incident segment(s)
		// change during a drag.
		const metrePts = renderPoints.map((p) => ({ x: p.x, y: p.y }));
		let totalLen = 0;
		for (let k = 0; k < metrePts.length - 1; k++) {
			totalLen += Math.hypot(metrePts[k + 1].x - metrePts[k].x, metrePts[k + 1].y - metrePts[k].y);
		}

		// Previous step: draw a draggable handle at index 0 too (its start has
		// no live player anchoring it in the current view), but skip the last
		// index — that endpoint chains to the current player and is edited by
		// dragging the skater. Current/next skip index 0 (anchored to the
		// player / the current path's endpoint).
		const lo = mode === 'prev' ? 0 : 1;
		const hi = mode === 'prev' ? path.points.length - 1 : path.points.length;

		for (let i = lo; i < hi; i++) {
			const pt = renderPoints[i];
			const px = this.projection.projectPoint(pt.x, pt.y);
			const handleRadius = Math.max(8, 10 / this.stage.scaleX());

			// aM is null for the path's first node (no previous neighbour).
			const aM = i > 0 ? metrePts[i - 1] : null;
			const bM = i < metrePts.length - 1 ? metrePts[i + 1] : null;
			const incidentStatic =
				(aM ? Math.hypot(metrePts[i].x - aM.x, metrePts[i].y - aM.y) : 0) +
				(bM ? Math.hypot(bM.x - metrePts[i].x, bM.y - metrePts[i].y) : 0);
			const budget = MAX_PATH_LENGTH_M - (totalLen - incidentStatic);

			const handle = new Konva.Circle({
				x: px.x,
				y: px.y,
				radius: handleRadius,
				fill: 'white',
				stroke: color,
				strokeWidth: 2,
				draggable: true,
				name: 'pathHandle',
				listening: true
			});
			handle.setAttr('pointIndex', i);
			handle.setAttr('pathId', path.id);
			handle.setAttr('stepId', step.id);

			// Hard-clamp the drag so the path can't exceed MAX_PATH_LENGTH_M.
			// `pos` arrives in the stage's absolute (content) coordinate space —
			// the same space as `stage.getPointerPosition()`, NOT the stage-local
			// space used by `projectPoint`. Konva's `_setDragPosition` passes the
			// pointer position (content space) to `dragBoundFunc` and then feeds
			// the return value to `setAbsolutePosition` (which also expects content
			// space). Without undoing the stage zoom/pan first (as `pointerToPlane`
			// does), the constraint circle is centred at the wrong point whenever
			// the stage is zoomed or panned — e.g. after a browser resize triggers
			// `fitToTrack` or `loadViewSettings`, making handle dragging appear
			// "completely inconsistent".
			handle.dragBoundFunc((pos) => {
				const center = this.projection.stageCenter();
				const scale = this.stage.scaleX();
				// Absolute → stage-local → world metres (mirrors `pointerToPlane`).
				const localX = (pos.x - this.stage.x()) / scale;
				const localY = (pos.y - this.stage.y()) / scale;
				const pM = {
					x: (localX - center.x) / TRACK_SCALE,
					y: (localY - center.y) / TRACK_SCALE
				};
				const c = clampNodeToBudget(aM, bM, pM, budget);
				// World metres → stage-local → absolute (inverse of above).
				return {
					x: this.stage.x() + (center.x + c.x * TRACK_SCALE) * scale,
					y: this.stage.y() + (center.y + c.y * TRACK_SCALE) * scale
				};
			});

			handle.on('dragmove', () => this.onDragMove?.(step, path));
			handle.on('dragend', () => this.onDragEnd?.(step, path));

			// Handles live on the top control layer so they stay grabbable even
			// where a path passes under a skater (e.g. a previous step's path,
			// whose endpoint chains to the current player's position).
			this.controlLayer.add(handle);
		}
	}

	/** Handles belonging to one path, filtered by step + path id. Handles live
	 * on the top controlLayer (above the players), so the lookup targets it. */
	handlesFor(stepId: string, pathId: string): Circle[] {
		return Array.from(this.controlLayer.find<Circle>('.pathHandle')).filter(
			(h) => h.getAttr('stepId') === stepId && h.getAttr('pathId') === pathId
		);
	}

	/** Removes just the path handles from the top control layer (leaving the
	 * direction/rotation controls untouched). */
	private clearHandles(): void {
		this.controlLayer.find('.pathHandle').forEach((h) => h.destroy());
	}

	/** The line shape for one path, filtered by step + path id. */
	lineFor(stepId: string, pathId: string): Konva.Line | undefined {
		return Array.from(this.pathLayer.find<Konva.Line>('.lineShape')).find(
			(l) => l.getAttr('stepId') === stepId && l.getAttr('pathId') === pathId
		);
	}

	/** Re-projects `points` and redraws the line for one path. */
	redrawLine(stepId: string, pathId: string, points: PlanarPoint[]): void {
		const line = this.lineFor(stepId, pathId);
		if (!line || points.length < 2) return;
		const projected = this.projection.smoothProject(points);
		if (projected) {
			line.points(projected.flatMap((p) => [p.x, p.y]));
			// batchDraw, not draw(): dragmove can fire several times per frame
			// (coalesced touch events), and each synchronous draw() was a
			// blocking full-layer repaint. batchDraw still renders before the
			// next paint, so the line tracks the pointer without lag.
			this.pathLayer.batchDraw();
		}
	}
}
