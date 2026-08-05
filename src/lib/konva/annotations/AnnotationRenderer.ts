import { get } from 'svelte/store';
import Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { boardDoc } from '$lib/doc/store';
import { annotationVisibleOnStep } from '$lib/doc/annotationScope';
import { selectedAnnotationId } from '$lib/stores/selection';
import { toolMode } from '$lib/stores/toolMode';
import { LEGACY_LABEL_PX } from '$lib/stores/labelSettings';
import type { Annotation, AnnotationTransform, PlanarPoint, Step } from '$lib/doc/types';
import {
	effectiveAnchors,
	boxCorners,
	halfSizes,
	resizeCursorFor,
	rotateHandlePos,
	resolvedTransform,
	MIN_HALF
} from '../annotationTransform';
import { annotationIdFromEvent } from '../tools/hitTest';
import type { BoardProjection } from '../paths/projection';

/** Gesture kinds the selection chrome can start; handled by AnnotationGestures. */
export type AnnotationGestureType = 'move' | 'resize' | 'rotate';

/** The hand-drawn font used for label text on the canvas. */
export const LABEL_FONT_FAMILY = 'Excalifont';

/** Shared 2D context for measuring label text width without allocating Konva
 * nodes (used for the label background and selection ring sizing). */
let measureCtx: CanvasRenderingContext2D | null = null;

/** Measures the pixel width of `text` at `fontSize` in the label font. */
function measureLabelWidth(text: string, fontSize: number): number {
	if (!measureCtx) {
		const canvas = document.createElement('canvas');
		measureCtx = canvas.getContext('2d');
	}
	if (measureCtx) {
		measureCtx.font = `${fontSize}px ${LABEL_FONT_FAMILY}`;
		return measureCtx.measureText(text).width;
	}
	return text.length * fontSize * 0.6;
}

/**
 * Resolves a label's on-screen (CSS-pixel) font size: the annotation's stamped
 * `fontSize`, else the legacy default so pre-existing boards render unchanged.
 * Callers divide by the stage scale to get the stage-space size used by Konva.
 */
function labelScreenPx(ann: Extract<Annotation, { kind: 'label' }>): number {
	return ann.fontSize ?? LEGACY_LABEL_PX;
}

/**
 * Renders board annotations (pen / arrow / zone / label / gap) onto the
 * annotation layer, plus the selection affordance (oriented box, corner
 * resize handles, rotation handle) onto the top control layer.
 *
 * Gesture handling lives in {@link AnnotationGestures}; the selection chrome
 * reports handle pointerdowns through {@link onGestureStart}.
 */
export class AnnotationRenderer {
	/** Wired by the owner once the gesture controller exists. */
	onGestureStart:
		| ((
				type: AnnotationGestureType,
				ann: Annotation,
				e: Konva.KonvaEventObject<unknown>,
				su?: number,
				sv?: number
		  ) => void)
		| null = null;

	constructor(
		private annotationLayer: Konva.Layer,
		private controlLayer: Konva.Layer,
		private stage: Konva.Stage,
		private projection: BoardProjection
	) {}

	/**
	 * Live-gesture state for rotate/resize. While set, the annotation's shapes
	 * and the selection chrome are updated IN PLACE each frame (no node churn,
	 * no hit-canvas repaint) instead of being destroyed and rebuilt. Cleared by
	 * {@link endGesture}; the commit path's full {@link render} then rebuilds
	 * the canonical, hittable scene.
	 */
	private liveAnnId: string | null = null;
	/** Cached selection-chrome nodes, updated in place during a gesture. */
	private selChrome: {
		box: Konva.Rect;
		edges: Konva.Rect[];
		corners: Konva.Circle[];
		rot: Konva.Circle | null;
	} | null = null;
	/** The selection-chrome group on the control layer (cached so the move
	 * gesture's per-frame offset skips a `.findOne` tree traversal). */
	private selGroup: Konva.Group | null = null;
	/** Map of annotation ID to its group node for efficient updates. */
	private groups: Map<string, Konva.Group> = new Map();

	/**
	 * Renders annotations for a step. With step undefined (Live) only
	 * board-wide marks are shown; a scoped mark (single step or step range)
	 * appears only while the active step falls within its scope (see
	 * `annotationVisibleOnStep`). Each visible mark is wrapped in a hittable
	 * Group (name `annotation`, attr `annId`) so Select can target it; a dashed
	 * selection ring for the currently selected mark is drawn on the top
	 * control layer. `steps` is the active clip's ordered step array, used to
	 * resolve range bounds.
	 */
	render(step: Step | undefined, steps: Step[]): void {
		const activeStepId = step?.id;
		const selectedId = get(selectedAnnotationId);
		let selectedAnn: Annotation | undefined;

		// Process all annotations in a single pass
		const visibleIds = new Set<string>();
		const allAnnotations = boardDoc.current.annotations ?? [];

		for (const ann of allAnnotations) {
			// Check if annotation is visible for current step
			if (annotationVisibleOnStep(ann, activeStepId, steps)) {
				visibleIds.add(ann.id);
				const existingGroup = this.groups.get(ann.id);
				if (existingGroup) {
					// Update existing group in place
					this.updateAnnotationGroup(existingGroup, ann, effectiveAnchors(ann));
				} else {
					// Create new group
					const group = new Konva.Group({ name: 'annotation', listening: true });
					group.setAttr('annId', ann.id);
					this.appendShapes(group, ann, effectiveAnchors(ann));
					this.annotationLayer.add(group);
					this.groups.set(ann.id, group);
				}
				if (ann.id === selectedId) selectedAnn = ann;
			}
		}

		// Remove groups for annotations that are no longer visible
		for (const [annId, group] of this.groups) {
			if (!visibleIds.has(annId)) {
				group.destroy();
				this.groups.delete(annId);
			}
		}

		// Selection box + handles on the top control layer — Select tool only.
		this.renderSelection(selectedAnn);

		this.annotationLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/**
	 * Updates an existing annotation group to match the annotation and its
	 * effective anchors. This avoids destroying and recreating nodes.
	 */
	private updateAnnotationGroup(group: Konva.Group, ann: Annotation, eff: PlanarPoint[]): void {
		// Children hold absolute stage-local coordinates, so the group must sit
		// at the origin. The move gesture's cheap path offsets the group by the
		// drag delta (AnnotationGestures) — without resetting it here the next
		// render would double-apply the translation, leaving the mark offset
		// from its selection frame in the drag direction.
		group.position({ x: 0, y: 0 });
		// Update the annotation ID attribute (should be same, but just in case)
		group.setAttr('annId', ann.id);

		// Update children based on annotation kind
		const children = group.getChildren();
		// A finished gesture left the shapes non-listening (beginGesture
		// inerts them so drags skip the hit-canvas repaint). Restore the
		// authored hit state here — this is the only path that re-renders an
		// existing group, so without it the mark would stay unselectable
		// forever after its first drag. Label text stays inert (authored
		// listening:false in appendShapes so clicks fall through to the bg).
		children.forEach((c, i) => {
			const inert = ann.kind === 'label' && i === 1;
			c.listening(!inert);
		});
		switch (ann.kind) {
			case 'label': {
				if (children.length !== 2) {
					// Unexpected structure, fallback to full rebuild
					this.rebuildAnnotationGroup(group, ann, eff);
					return;
				}
				this.applyLabelNodes(group, this.labelMetrics(ann), ann);
				break;
			}
			case 'pen':
			case 'arrow':
			case 'zone': {
				// These have one or two lines; the first child is always the main line
				// For arrow, there is a second child for the head
				const line = children[0] as Konva.Line;
				const points = this.projection
					.projectSmoothed(eff, ann.kind === 'zone')
					.flatMap((p) => [p.x, p.y]);
				line.points(points);
				// Update visual properties
				line.stroke(ann.style.color);
				line.strokeWidth(ann.style.width ?? 2);
				if (ann.kind === 'arrow' && children.length === 2) {
					const headLine = children[1] as Konva.Line;
					if (eff.length >= 2) {
						const headPoints = this.arrowHeadPoints(eff);
						headLine.points(headPoints);
						headLine.fill(ann.style.color);
					} else {
						// Not enough points to draw head, hide it?
						headLine.points([]);
					}
				}
				break;
			}
			case 'gap': {
				if (children.length !== 3) {
					// Unexpected structure, fallback to full rebuild
					this.rebuildAnnotationGroup(group, ann, eff);
					return;
				}
				const [mainLine, tick1, tick2] = children as [Konva.Line, Konva.Line, Konva.Line];
				const fromPx = this.projection.projectPoint(eff[0].x, eff[0].y);
				const toPx = this.projection.projectPoint(eff[1].x, eff[1].y);
				const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
				const tickOffset = 8;
				// Update main line
				mainLine.points([fromPx.x, fromPx.y, toPx.x, toPx.y]);
				mainLine.stroke(ann.style.color);
				mainLine.strokeWidth(ann.style.width ?? 2);
				mainLine.dash([8, 8]);
				// Update tick 1 (at from)
				const t1 = {
					x: fromPx.x + tickOffset * Math.cos(angle + Math.PI / 2),
					y: fromPx.y + tickOffset * Math.sin(angle + Math.PI / 2)
				};
				const t2 = {
					x: fromPx.x + tickOffset * Math.cos(angle - Math.PI / 2),
					y: fromPx.y + tickOffset * Math.sin(angle - Math.PI / 2)
				};
				tick1.points([t1.x, t1.y, t2.x, t2.y]);
				tick1.stroke(ann.style.color);
				tick1.strokeWidth(ann.style.width ?? 2);
				// Update tick 2 (at to)
				const t3 = {
					x: toPx.x + tickOffset * Math.cos(angle + Math.PI / 2),
					y: toPx.y + tickOffset * Math.sin(angle + Math.PI / 2)
				};
				const t4 = {
					x: toPx.x + tickOffset * Math.cos(angle - Math.PI / 2),
					y: toPx.y + tickOffset * Math.sin(angle - Math.PI / 2)
				};
				tick2.points([t3.x, t3.y, t4.x, t4.y]);
				tick2.stroke(ann.style.color);
				tick2.strokeWidth(ann.style.width ?? 2);
				break;
			}
			default:
				// Unknown kind, fallback to full rebuild
				this.rebuildAnnotationGroup(group, ann, eff);
		}
	}

	/**
	 * Fallback to destroy and rebuild the group's children. Used when the
	 * structure is unexpected or we need to reset.
	 */
	private rebuildAnnotationGroup(group: Konva.Group, ann: Annotation, eff: PlanarPoint[]): void {
		group.destroyChildren();
		this.appendShapes(group, ann, eff);
	}

	/**
	 * Draws one annotation's shapes into `group` from effective (transformed)
	 * anchor points. The per-kind geometry lives in {@link lineSpecs} so the
	 * live gesture path can sync the SAME shapes in place instead of destroying
	 * and recreating them every frame.
	 */
	private appendShapes(group: Konva.Group, ann: Annotation, eff: PlanarPoint[]): void {
		if (ann.kind === 'label') {
			// bg is hittable (the move/selection target); text is inert so taps
			// fall through to the bg. Geometry is applied via applyLabelNodes.
			group.add(new Konva.Rect({ listening: true }));
			group.add(new Konva.Text({ listening: false }));
			this.applyLabelNodes(group, this.labelMetrics(ann), ann);
			return;
		}
		for (const spec of this.lineSpecs(ann, eff)) {
			group.add(new Konva.Line({ points: spec.points, ...spec.config }));
		}
	}

	/**
	 * Per-kind Line specs (pixel point arrays + configs) in a stable order.
	 * Shared by {@link appendShapes} (create) and the live gesture sync
	 * (update `.points()` in place). Only stroke/fill/dash configs are set
	 * here — they never change during a gesture, only the geometry does.
	 */
	private lineSpecs(
		ann: Annotation,
		eff: PlanarPoint[]
	): Array<{ points: number[]; config: Konva.LineConfig }> {
		const stroke = ann.style.color;
		const width = ann.style.width ?? 2;
		const base: Konva.LineConfig = {
			stroke,
			strokeWidth: width,
			tension: 0,
			hitStrokeWidth: 12,
			listening: true
		};
		const line: Konva.LineConfig = { ...base, lineCap: 'round', lineJoin: 'round' };
		switch (ann.kind) {
			case 'pen':
				return [
					{
						points: this.projection.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]),
						config: line
					}
				];
			case 'arrow': {
				const specs = [
					{
						points: this.projection.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]),
						config: line
					}
				];
				if (eff.length >= 2) {
					specs.push({
						points: this.arrowHeadPoints(eff),
						config: { ...base, fill: stroke, closed: true }
					});
				}
				return specs;
			}
			case 'zone':
				return [
					{
						points: this.projection.projectSmoothed(eff, true).flatMap((p) => [p.x, p.y]),
						config: { ...line, closed: true, fill: stroke, opacity: 0.15 }
					}
				];
			case 'gap':
				return this.gapLineSpecs(eff, base);
			case 'label':
				return [];
		}
	}

	/** Arrowhead polyline (pixel) from the last two effective anchors. */
	private arrowHeadPoints(eff: PlanarPoint[]): number[] {
		const last = this.projection.projectPoint(eff[eff.length - 1].x, eff[eff.length - 1].y);
		const prev = this.projection.projectPoint(eff[eff.length - 2].x, eff[eff.length - 2].y);
		const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
		const headLength = 15;
		const base1 = {
			x: last.x - headLength * Math.cos(angle - 0.5),
			y: last.y - headLength * Math.sin(angle - 0.5)
		};
		const base2 = {
			x: last.x - headLength * Math.cos(angle + 0.5),
			y: last.y - headLength * Math.sin(angle + 0.5)
		};
		return [last.x, last.y, base1.x, base1.y, base2.x, base2.y, last.x, last.y];
	}

	/** Gap specs: the dashed span + two perpendicular end ticks (pixel). */
	private gapLineSpecs(
		eff: PlanarPoint[],
		base: Konva.LineConfig
	): Array<{ points: number[]; config: Konva.LineConfig }> {
		const fromPx = this.projection.projectPoint(eff[0].x, eff[0].y);
		const toPx = this.projection.projectPoint(eff[1].x, eff[1].y);
		const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
		const tickOffset = 8;
		const specs: Array<{ points: number[]; config: Konva.LineConfig }> = [
			{ points: [fromPx.x, fromPx.y, toPx.x, toPx.y], config: { ...base, dash: [8, 8] } }
		];
		for (const t of [fromPx, toPx]) {
			const t1 = {
				x: t.x + tickOffset * Math.cos(angle + Math.PI / 2),
				y: t.y + tickOffset * Math.sin(angle + Math.PI / 2)
			};
			const t2 = {
				x: t.x + tickOffset * Math.cos(angle - Math.PI / 2),
				y: t.y + tickOffset * Math.sin(angle - Math.PI / 2)
			};
			specs.push({ points: [t1.x, t1.y, t2.x, t2.y], config: { ...base } });
		}
		return specs;
	}

	/** The annotation group on the annotation layer for a given id, if present. */
	groupFor(annId: string): Konva.Group | undefined {
		return Array.from(this.annotationLayer.find<Konva.Group>('.annotation')).find(
			(g) => g.getAttr('annId') === annId
		);
	}

	/** Offsets the selection chrome (cheap move-gesture path). Uses the
	 * cached group ref so a per-frame call skips the `.findOne` traversal. */
	moveSelectionBy(dx: number, dy: number): void {
		this.selGroup?.position({ x: dx, y: dy });
	}

	/** Repaints both layers (cheap move-gesture path). */
	batchDraw(): void {
		this.annotationLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/**
	 * Begins a rotate/resize live edit for an annotation. Marks the mark's
	 * shapes and the selection chrome non-listening so the hit canvas isn't
	 * repainted each frame (the gesture is already in flight, so neither needs
	 * to be hittable mid-edit). The canonical, hittable scene is rebuilt by the
	 * full {@link render} on commit.
	 */
	beginGesture(ann: Annotation): void {
		this.liveAnnId = ann.id;
		// Shapes inert: skip the annotation hit-canvas repaint during the drag.
		this.groupFor(ann.id)
			?.getChildren()
			.forEach((s) => s.listening(false));
		// Selection chrome inert: skip the control hit-canvas repaint too.
		if (this.selChrome) {
			const { box, edges, corners, rot } = this.selChrome;
			[box, ...edges, ...corners, rot].forEach((s) => s?.listening(false));
		}
		// NOTE: do NOT disable listening on the layers themselves (e.g. via
		// the deprecated hitGraphEnabled, which aliases layer.listening).
		// Layer.getIntersection() early-returns for non-listening layers
		// WITHOUT reading their (stale, still-painted) hit canvas, so Konva's
		// per-pointermove hit detection falls through to the player/path/track
		// layers and performs several getImageData GPU readbacks + spiral
		// searches per raw event — saturating the main thread and stuttering
		// the drag. With only the shapes inerted, hit detection is answered
		// from the top layers' stale hit canvas in a single readback, exactly
		// as without a gesture.
	}

	/**
	 * Live in-place redraw of the gesture annotation from a working transform.
	 * Syncs each Line's `.points()` on the existing nodes (no destroy/create,
	 * no listener churn, no hit-canvas key reallocation); rebuilds only if the
	 * shape structure changed (it shouldn't during a single gesture, but the
	 * guard keeps it correct if the group was empty at gesture start).
	 */
	liveUpdate(ann: Annotation, t: AnnotationTransform): void {
		if (this.liveAnnId !== ann.id) return;
		const group = this.groupFor(ann.id);
		if (!group) return;
		const eff = effectiveAnchors(ann, t);
		const specs = this.lineSpecs(ann, eff);
		const lines = group.getChildren().filter((c): c is Konva.Line => c instanceof Konva.Line);
		if (lines.length === specs.length) {
			for (let i = 0; i < lines.length; i++) lines[i].points(specs[i].points);
		} else {
			group.destroyChildren();
			this.appendShapes(group, ann, eff);
			// Re-apply inert listening after a rebuild (see beginGesture).
			group.getChildren().forEach((s) => s.listening(false));
		}
		this.annotationLayer.batchDraw();
	}

	/**
	 * Live in-place update of the selection chrome geometry (box centre/size/
	 * rotation, the four corner handles, the rotation handle) from a working
	 * transform. No destroy/recreate, no listener re-attach. Falls back to a
	 * full {@link renderSelection} if the chrome refs aren't present.
	 */
	updateSelectionGeometry(ann: Annotation, t: AnnotationTransform): void {
		const chrome = this.selChrome;
		if (!chrome) {
			this.renderSelection({ ...ann, transform: t });
			return;
		}
		const scale = this.stage.scaleX() || 1;
		const corners = boxCorners(ann, t).map((p) => this.projection.projectPoint(p.x, p.y));
		const { hw, hh } = halfSizes(ann, t);
		const centerPx = this.projection.projectPoint(t.cx, t.cy);
		const boxW = Math.max(hw, MIN_HALF) * 2 * TRACK_SCALE;
		const boxH = Math.max(hh, MIN_HALF) * 2 * TRACK_SCALE;

		chrome.box.position({ x: centerPx.x, y: centerPx.y });
		chrome.box.size({ width: boxW, height: boxH });
		chrome.box.offsetX(boxW / 2);
		chrome.box.offsetY(boxH / 2);
		chrome.box.rotation((t.angle * 180) / Math.PI);
		for (let i = 0; i < chrome.corners.length; i++) {
			chrome.corners[i].position(corners[i] ?? { x: 0, y: 0 });
		}
		// Edge handles track the box midpoints. Order matches renderSelection:
		// top, bottom (horizontal — width tracks boxW); left, right (vertical —
		// height tracks boxH).
		if (chrome.edges.length === 4 && corners.length === 4) {
			const mid = (a: PlanarPoint, b: PlanarPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
			const edgeMids = [
				mid(corners[2], corners[3]), // top
				mid(corners[0], corners[1]), // bottom
				mid(corners[1], corners[2]), // left
				mid(corners[0], corners[3]) // right
			];
			for (let i = 0; i < 4; i++) {
				chrome.edges[i].position(edgeMids[i]);
				if (i < 2) {
					// horizontal edges: long axis is width
					chrome.edges[i].width(boxW);
					chrome.edges[i].offsetX(boxW / 2);
				} else {
					// vertical edges: long axis is height
					chrome.edges[i].height(boxH);
					chrome.edges[i].offsetY(boxH / 2);
				}
			}
		}
		const rotOffsetPlane = 22 / (TRACK_SCALE * scale);
		const rot = this.projection.projectPoint(
			rotateHandlePos(ann, rotOffsetPlane, t).x,
			rotateHandlePos(ann, rotOffsetPlane, t).y
		);
		chrome.rot?.position(rot);

		this.controlLayer.batchDraw();
	}

	/** Ends the live edit; the owner then commits and runs the full render. */
	endGesture(): void {
		this.liveAnnId = null;
	}

	// --- label geometry (screen-space; text dims come from canvas measurement,
	//     so this lives in the renderer rather than the pure transform module) --

	/**
	 * Screen-space metrics for a label's text box: the placement point (the
	 * moved anchor), the box centre (the rotate/resize pivot), half-sizes and
	 * the rotation angle. `fontSize`/`angle` overrides drive the live resize/
	 * rotate gestures without touching the document.
	 */
	labelMetrics(
		ann: Extract<Annotation, { kind: 'label' }>,
		fontSizeOverride?: number,
		angleOverride?: number
	): {
		placementPx: PlanarPoint;
		centerPx: PlanarPoint;
		fontSize: number;
		textWidth: number;
		hw: number;
		hh: number;
		angle: number;
	} {
		const scale = this.stage.scaleX() || 1;
		const eff = effectiveAnchors(ann);
		const placementPx = this.projection.projectPoint(eff[0].x, eff[0].y);
		const fontSize = fontSizeOverride ?? Math.max(12, labelScreenPx(ann) / scale);
		const textWidth = measureLabelWidth(ann.text, fontSize);
		const pad = 4;
		return {
			placementPx,
			centerPx: { x: placementPx.x + textWidth / 2, y: placementPx.y + fontSize * 0.45 },
			fontSize,
			textWidth,
			hw: textWidth / 2 + pad,
			hh: fontSize * 0.7,
			angle: angleOverride ?? resolvedTransform(ann).angle
		};
	}

	/** The label's committed (CSS-px) font size — the unit stored on the doc. */
	labelFontSizeCss(ann: Extract<Annotation, { kind: 'label' }>): number {
		return labelScreenPx(ann);
	}

	/** Rotates the four local box corners (±hw, ±hh) around `center` by `angle`. */
	private rotatedBoxCorners(
		center: PlanarPoint,
		hw: number,
		hh: number,
		angle: number
	): PlanarPoint[] {
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const rot = (lx: number, ly: number) => ({
			x: center.x + lx * c - ly * s,
			y: center.y + lx * s + ly * c
		});
		return [rot(hw, hh), rot(-hw, hh), rot(-hw, -hh), rot(hw, -hh)];
	}

	/** Applies label metrics to the bg + text nodes (centre-based, rotated). */
	private applyLabelNodes(
		group: Konva.Group,
		m: ReturnType<AnnotationRenderer['labelMetrics']>,
		ann: Extract<Annotation, { kind: 'label' }>
	): void {
		const children = group.getChildren();
		const [bg, text] = children as [Konva.Rect, Konva.Text];
		const deg = (m.angle * 180) / Math.PI;
		bg.setAttrs({
			x: m.centerPx.x,
			y: m.centerPx.y,
			width: m.hw * 2,
			height: m.hh * 2,
			offsetX: m.hw,
			offsetY: m.hh,
			rotation: deg,
			cornerRadius: 4,
			fill: 'rgba(255,255,255,0.8)'
		});
		text.setAttrs({
			x: m.centerPx.x,
			y: m.centerPx.y,
			offsetX: m.textWidth / 2,
			offsetY: m.fontSize * 0.45,
			rotation: deg,
			text: ann.text,
			fontSize: m.fontSize,
			fontFamily: LABEL_FONT_FAMILY,
			fill: ann.style.color
		});
	}

	/** Live in-place update of a label's text box AND its selection chrome from
	 *  working font-size / angle values (resize / rotate gestures). */
	liveLabel(ann: Extract<Annotation, { kind: 'label' }>, fontSize?: number, angle?: number): void {
		if (this.liveAnnId !== ann.id) return;
		const group = this.groupFor(ann.id);
		if (!group) return;
		const m = this.labelMetrics(ann, fontSize, angle);
		this.applyLabelNodes(group, m, ann);
		this.applyLabelChrome(m);
		this.annotationLayer.batchDraw();
	}

	/** Repositions the cached selection chrome for a label from its metrics. */
	private applyLabelChrome(m: ReturnType<AnnotationRenderer['labelMetrics']>): void {
		const chrome = this.selChrome;
		if (!chrome) return;
		const scale = this.stage.scaleX() || 1;
		const deg = (m.angle * 180) / Math.PI;
		const boxW = m.hw * 2;
		const boxH = m.hh * 2;
		chrome.box.position({ x: m.centerPx.x, y: m.centerPx.y });
		chrome.box.size({ width: boxW, height: boxH });
		chrome.box.offsetX(boxW / 2);
		chrome.box.offsetY(boxH / 2);
		chrome.box.rotation(deg);
		const corners = this.rotatedBoxCorners(m.centerPx, m.hw, m.hh, m.angle);
		for (let i = 0; i < chrome.corners.length; i++) {
			chrome.corners[i].position(corners[i] ?? { x: 0, y: 0 });
		}
		if (chrome.edges.length === 4 && corners.length === 4) {
			const mid = (a: PlanarPoint, b: PlanarPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
			const edgeMids = [
				mid(corners[2], corners[3]),
				mid(corners[0], corners[1]),
				mid(corners[1], corners[2]),
				mid(corners[0], corners[3])
			];
			for (let i = 0; i < 4; i++) {
				chrome.edges[i].position(edgeMids[i]);
				if (i < 2) {
					chrome.edges[i].width(boxW);
					chrome.edges[i].offsetX(boxW / 2);
				} else {
					chrome.edges[i].height(boxH);
					chrome.edges[i].offsetY(boxH / 2);
				}
			}
		}
		if (chrome.rot) {
			const off = 22 / scale;
			chrome.rot.position({
				x: m.centerPx.x + (m.hh + off) * Math.sin(m.angle),
				y: m.centerPx.y - (m.hh + off) * Math.cos(m.angle)
			});
		}
		this.controlLayer.batchDraw();
	}

	/**
	 * Draws the selection affordance for an annotation on the control layer:
	 * an oriented thin-line box (also the move grab) with four edge + four
	 * corner resize handles and one rotation handle above the top edge. Labels
	 * use the SAME chrome (sized to their text box, rotated by their angle);
	 * their resize preserves the text's aspect ratio (a single font size), so
	 * every handle shows a uniform resize cursor.
	 */
	renderSelection(ann: Annotation | undefined): void {
		this.controlLayer.find('.annotationSelection').forEach((n) => n.destroy());
		// Cached chrome refs are invalidated whenever the chrome is rebuilt.
		this.selChrome = null;
		this.selGroup = null;
		if (!ann || get(toolMode) !== 'select') return;

		const scale = this.stage.scaleX() || 1;
		const sel = new Konva.Group({ name: 'annotationSelection', listening: true });
		this.controlLayer.add(sel);
		this.selGroup = sel;

		// Resolve the box geometry (screen) for either kind into a common shape.
		// Labels compute their box from text metrics; others from the transform.
		const isLabel = ann.kind === 'label';
		let centerPx: PlanarPoint;
		let boxW: number;
		let boxH: number;
		let angleDeg: number;
		let rotPx: PlanarPoint;
		let corners: PlanarPoint[];
		if (isLabel) {
			const m = this.labelMetrics(ann);
			centerPx = m.centerPx;
			boxW = m.hw * 2;
			boxH = m.hh * 2;
			angleDeg = (m.angle * 180) / Math.PI;
			corners = this.rotatedBoxCorners(m.centerPx, m.hw, m.hh, m.angle);
			const off = 22 / scale;
			rotPx = {
				x: m.centerPx.x + (m.hh + off) * Math.sin(m.angle),
				y: m.centerPx.y - (m.hh + off) * Math.cos(m.angle)
			};
		} else {
			const xform = resolvedTransform(ann);
			corners = boxCorners(ann, xform).map((p) => this.projection.projectPoint(p.x, p.y));
			const { hw, hh } = halfSizes(ann, xform);
			centerPx = this.projection.projectPoint(xform.cx, xform.cy);
			boxW = Math.max(hw, MIN_HALF) * 2 * TRACK_SCALE;
			boxH = Math.max(hh, MIN_HALF) * 2 * TRACK_SCALE;
			angleDeg = (xform.angle * 180) / Math.PI;
			const rotOffsetPlane = 22 / (TRACK_SCALE * scale);
			rotPx = this.projection.projectPoint(
				rotateHandlePos(ann, rotOffsetPlane, xform).x,
				rotateHandlePos(ann, rotOffsetPlane, xform).y
			);
		}

		// Continuous thin-line box, also the move grab. The fill is fully
		// transparent (not coloured) yet still hittable — Konva's hit canvas
		// fills the region with the shape's hit key whenever a fill is set,
		// independent of its alpha.
		const box = new Konva.Rect({
			x: centerPx.x,
			y: centerPx.y,
			width: boxW,
			height: boxH,
			offsetX: boxW / 2,
			offsetY: boxH / 2,
			rotation: angleDeg,
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			fill: 'rgba(0,0,0,0)',
			listening: true
		});
		sel.add(box);
		box.setAttr('cursorHint', 'grabbing');
		box.on('pointerdown', (e) => this.onGestureStart?.('move', ann, e));

		// Four edge resize handles: thin transparent strips along each box edge
		// (added above the box so the perimeter resizes while the interior
		// stays the move grab). The long axis follows the edge (boxW for
		// top/bottom, boxH for left/right); the short axis is a constant hit
		// thickness. Corners are added last, so they win hit detection at the
		// corners.
		const edgeT = Math.max(8, 10 / scale);
		const edgeDefs: Array<{ su: number; sv: number; a: number; b: number }> = [
			{ su: 0, sv: -1, a: 2, b: 3 }, // top    (-- , +-)
			{ su: 0, sv: 1, a: 0, b: 1 }, // bottom (++ , -+)
			{ su: -1, sv: 0, a: 1, b: 2 }, // left   (-+ , --)
			{ su: 1, sv: 0, a: 0, b: 3 } // right  (++ , +-)
		];
		const edgeHandles: Konva.Rect[] = [];
		for (const def of edgeDefs) {
			const cA = corners[def.a] ?? { x: 0, y: 0 };
			const cB = corners[def.b] ?? { x: 0, y: 0 };
			const mid = { x: (cA.x + cB.x) / 2, y: (cA.y + cB.y) / 2 };
			// sv != 0 → top/bottom, a horizontal edge (long axis = width).
			// su != 0 → left/right, a vertical edge (long axis = height).
			const horizontal = def.sv !== 0;
			const w = horizontal ? boxW : edgeT;
			const h = horizontal ? edgeT : boxH;
			const edge = new Konva.Rect({
				x: mid.x,
				y: mid.y,
				width: w,
				height: h,
				offsetX: w / 2,
				offsetY: h / 2,
				rotation: angleDeg,
				listening: true
			});
			// Labels resize uniformly (aspect locked) → a single resize cursor.
			edge.setAttr(
				'cursorHint',
				isLabel ? 'nwse-resize' : resizeCursorFor(def.su, def.sv, (angleDeg * Math.PI) / 180)
			);
			sel.add(edge);
			edgeHandles.push(edge);
			edge.on('pointerdown', (e) => this.onGestureStart?.('resize', ann, e, def.su, def.sv));
		}

		// Four corner resize handles (circles). boxCorners order: ++, -+, --, +-.
		const signs: Array<[number, number]> = [
			[1, 1],
			[-1, 1],
			[-1, -1],
			[1, -1]
		];
		const cornerHandles: Konva.Circle[] = [];
		corners.forEach((c, i) => {
			const handle = new Konva.Circle({
				x: c.x,
				y: c.y,
				radius: Math.max(6, 8 / scale),
				fill: 'white',
				stroke: '#0ea5e9',
				strokeWidth: 2 / scale,
				listening: true
			});
			const [su, sv] = signs[i];
			handle.setAttr(
				'cursorHint',
				isLabel ? 'nwse-resize' : resizeCursorFor(su, sv, (angleDeg * Math.PI) / 180)
			);
			sel.add(handle);
			cornerHandles.push(handle);
			handle.on('pointerdown', (e) => this.onGestureStart?.('resize', ann, e, su, sv));
		});

		// Rotation handle: centred above the top edge.
		const rotHandle = new Konva.Circle({
			x: rotPx.x,
			y: rotPx.y,
			radius: Math.max(6, 8 / scale),
			fill: 'white',
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			listening: true
		});
		rotHandle.setAttr('cursorHint', 'grab');
		sel.add(rotHandle);
		rotHandle.on('pointerdown', (e) => this.onGestureStart?.('rotate', ann, e));

		// Cache the chrome nodes so a live gesture can update them in place
		// instead of tearing down and rebuilding them every frame.
		this.selChrome = { box, edges: edgeHandles, corners: cornerHandles, rot: rotHandle };
		this.controlLayer.batchDraw();
	}

	/**
	 * Sets the stage container cursor for hover affordances in the Select tool.
	 * Selection-chrome nodes carry a `cursorHint` attr (set at build time); a
	 * hovered unselected annotation shows a grab cursor; anything else resets
	 * to the default. Called from the owner's stage `mousemove` handler.
	 */
	updateHoverCursor(e: Konva.KonvaEventObject<unknown>): void {
		const el = this.stage.container();
		if (!el) return;
		const target = e.target as Konva.Node;
		const hint = target.getAttr('cursorHint') as string | undefined;
		if (hint) {
			el.style.cursor = hint;
			return;
		}
		const annId = annotationIdFromEvent(e);
		if (annId && annId !== get(selectedAnnotationId)) {
			el.style.cursor = 'grabbing';
			return;
		}
		el.style.cursor = '';
	}
}
