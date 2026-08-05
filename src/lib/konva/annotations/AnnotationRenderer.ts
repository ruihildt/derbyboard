import { get } from 'svelte/store';
import Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { boardDoc } from '$lib/doc/store';
import { selectedAnnotationId } from '$lib/stores/selection';
import { toolMode } from '$lib/stores/toolMode';
import { LEGACY_LABEL_PX } from '$lib/stores/labelSettings';
import type { Annotation, AnnotationTransform, PlanarPoint, Step } from '$lib/doc/types';
import {
	effectiveAnchors,
	boxCorners,
	halfSizes,
	rotateHandlePos,
	resolvedTransform,
	MIN_HALF
} from '../annotationTransform';
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
    corners: Konva.Circle[];
    rot: Konva.Circle;
  } | null = null;
  /** Map of annotation ID to its group node for efficient updates. */
  private groups: Map<string, Konva.Group> = new Map();

  /**
   * Renders annotations for a step. With step undefined (Free Play) only
   * board-wide marks are shown; a step-scoped mark (scope.stepId) appears only
   * on its own step (decision #6: visible iff `!scope || scope.stepId ===
   * activeStep?.id`). Each visible mark is wrapped in a hittable Group (name
   * `annotation`, attr `annId`) so Select can target it; a dashed selection
   * ring for the currently selected mark is drawn on the top control layer.
   */
  render(step: Step | undefined): void {
    const activeStepId = step?.id;
    const selectedId = get(selectedAnnotationId);
    let selectedAnn: Annotation | undefined;

    // Process all annotations in a single pass
    const visibleIds = new Set<string>();
    const allAnnotations = boardDoc.current.annotations ?? [];
    
    for (const ann of allAnnotations) {
      // Check if annotation is visible for current step
      if (!ann.scope || ann.scope.stepId === activeStepId) {
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
  private updateAnnotationGroup(
    group: Konva.Group,
    ann: Annotation,
    eff: PlanarPoint[]
  ): void {
    // Update the annotation ID attribute (should be same, but just in case)
    group.setAttr('annId', ann.id);

    // Update children based on annotation kind
    const children = group.getChildren();
    switch (ann.kind) {
      case 'label': {
        if (children.length !== 2) {
          // Unexpected structure, fallback to full rebuild
          this.rebuildAnnotationGroup(group, ann, eff);
          return;
        }
        const [rect, text] = children as [Konva.Rect, Konva.Text];
        const atPx = this.projection.projectPoint(eff[0].x, eff[0].y);
        const fontSize = Math.max(12, labelScreenPx(ann) / this.stage.scaleX());
        const pad = 4;
        const textWidth = measureLabelWidth(ann.text, fontSize);
        const bgHeight = fontSize * 1.4;
        // Update rect
        rect.x(atPx.x - pad);
        rect.y(atPx.y - fontSize * 0.25);
        rect.width(textWidth + pad * 2);
        rect.height(bgHeight);
        rect.cornerRadius(4);
        // Update text
        text.x(atPx.x);
        text.y(atPx.y);
        text.text(ann.text);
        text.fontSize(fontSize);
        text.fontFamily(LABEL_FONT_FAMILY);
        text.fill(ann.style.color);
        // Update visual properties (cheap)
        rect.fill('rgba(255,255,255,0.8)');
        break;
      }
      case 'pen':
      case 'arrow':
      case 'zone': {
        // These have one or two lines; the first child is always the main line
        // For arrow, there is a second child for the head
        const line = children[0] as Konva.Line;
        const points = this.projection.projectSmoothed(eff, ann.kind === 'zone').flatMap(
          (p) => [p.x, p.y]
        );
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
  private rebuildAnnotationGroup(
    group: Konva.Group,
    ann: Annotation,
    eff: PlanarPoint[]
  ): void {
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
			const atPx = this.projection.projectPoint(eff[0].x, eff[0].y);
			const fontSize = Math.max(12, labelScreenPx(ann) / this.stage.scaleX());
			const pad = 4;
			const textWidth = measureLabelWidth(ann.text, fontSize);
			const bgHeight = fontSize * 1.4;
			group.add(
				new Konva.Rect({
					x: atPx.x - pad,
					y: atPx.y - fontSize * 0.25,
					width: textWidth + pad * 2,
					height: bgHeight,
					cornerRadius: 4,
					fill: 'rgba(255,255,255,0.8)',
					listening: true
				})
			);
			group.add(
				new Konva.Text({
					x: atPx.x,
					y: atPx.y,
					text: ann.text,
					fontSize,
					fontFamily: LABEL_FONT_FAMILY,
					fill: ann.style.color,
					listening: false
				})
			);
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

	/** Offsets the selection chrome (cheap move-gesture path). */
	moveSelectionBy(dx: number, dy: number): void {
		this.controlLayer.findOne('.annotationSelection')?.position({ x: dx, y: dy });
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
			const { box, corners, rot } = this.selChrome;
			[box, ...corners, rot].forEach((s) => s.listening(false));
		}
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
		const rotOffsetPlane = 22 / (TRACK_SCALE * scale);
		const rot = this.projection.projectPoint(
			rotateHandlePos(ann, rotOffsetPlane, t).x,
			rotateHandlePos(ann, rotOffsetPlane, t).y
		);
		chrome.rot.position(rot);

		this.controlLayer.batchDraw();
	}

	/** Ends the live edit; the owner then commits and runs the full render. */
	endGesture(): void {
		this.liveAnnId = null;
	}

	/**
	 * Draws the selection affordance for an annotation on the control layer:
	 * an oriented thin-line box (also the move grab) with four corner resize
	 * handles and one rotation handle above the top edge. Select-tool only;
	 * labels get a simple non-interactive ring (they are move-only via the
	 * annotation body, not yet transformable).
	 */
	renderSelection(ann: Annotation | undefined): void {
		this.controlLayer.find('.annotationSelection').forEach((n) => n.destroy());
		// Cached chrome refs are invalidated whenever the chrome is rebuilt.
		this.selChrome = null;
		if (!ann || get(toolMode) !== 'select') return;

		const scale = this.stage.scaleX() || 1;
		const sel = new Konva.Group({ name: 'annotationSelection', listening: true });
		this.controlLayer.add(sel);

		if (ann.kind === 'label') {
			const atPx = this.projection.projectPoint(
				effectiveAnchors(ann)[0].x,
				effectiveAnchors(ann)[0].y
			);
			const fontSize = Math.max(12, labelScreenPx(ann) / scale);
			const pad = 4;
			const textWidth = measureLabelWidth(ann.text, fontSize);
			sel.add(
				new Konva.Rect({
					x: atPx.x - pad,
					y: atPx.y - fontSize * 0.25,
					width: textWidth + pad * 2,
					height: fontSize * 1.4,
					stroke: '#0ea5e9',
					strokeWidth: 2 / scale,
					dash: [4, 4],
					listening: false
				})
			);
			this.controlLayer.batchDraw();
			return;
		}

		const xform = resolvedTransform(ann);
		const corners = boxCorners(ann, xform).map((p) => this.projection.projectPoint(p.x, p.y));
		const { hw, hh } = halfSizes(ann, xform);
		const centerPx = this.projection.projectPoint(xform.cx, xform.cy);
		const boxW = Math.max(hw, MIN_HALF) * 2 * TRACK_SCALE;
		const boxH = Math.max(hh, MIN_HALF) * 2 * TRACK_SCALE;

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
			rotation: (xform.angle * 180) / Math.PI,
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			fill: 'rgba(0,0,0,0)',
			listening: true
		});
		sel.add(box);
		box.on('pointerdown', (e) => this.onGestureStart?.('move', ann, e));

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
			sel.add(handle);
			cornerHandles.push(handle);
			const [su, sv] = signs[i];
			handle.on('pointerdown', (e) => this.onGestureStart?.('resize', ann, e, su, sv));
		});

		// Rotation handle: centred above the top edge.
		const rotOffsetPlane = 22 / (TRACK_SCALE * scale);
		const rot = this.projection.projectPoint(
			rotateHandlePos(ann, rotOffsetPlane, xform).x,
			rotateHandlePos(ann, rotOffsetPlane, xform).y
		);
		const rotHandle = new Konva.Circle({
			x: rot.x,
			y: rot.y,
			radius: Math.max(6, 8 / scale),
			fill: 'white',
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			listening: true
		});
		sel.add(rotHandle);
		rotHandle.on('pointerdown', (e) => this.onGestureStart?.('rotate', ann, e));

		// Cache the chrome nodes so a live gesture can update them in place
		// instead of tearing down and rebuilding them every frame.
		this.selChrome = { box, corners: cornerHandles, rot: rotHandle };
		this.controlLayer.batchDraw();
	}
}
