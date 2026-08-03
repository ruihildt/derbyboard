import { get } from 'svelte/store';
import Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { boardDoc } from '$lib/doc/store';
import { selectedAnnotationId } from '$lib/stores/selection';
import { toolMode } from '$lib/stores/toolMode';
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
	 * Renders annotations for a step. With step undefined (Free Play) only
	 * board-wide marks are shown; a step-scoped mark (scope.stepId) appears only
	 * on its own step (decision #6: visible iff `!scope || scope.stepId ===
	 * activeStep?.id`). Each visible mark is wrapped in a hittable Group (name
	 * `annotation`, attr `annId`) so Select can target it; a dashed selection
	 * ring for the currently selected mark is drawn on the top control layer.
	 */
	render(step: Step | undefined): void {
		this.annotationLayer.destroyChildren();

		const activeStepId = step?.id;
		const visible = (boardDoc.current.annotations ?? []).filter(
			(ann) => !ann.scope || ann.scope.stepId === activeStepId
		);

		const selectedId = get(selectedAnnotationId);
		let selectedAnn: Annotation | undefined;

		for (const ann of visible) {
			const group = new Konva.Group({ name: 'annotation', listening: true });
			group.setAttr('annId', ann.id);
			this.appendShapes(group, ann, effectiveAnchors(ann));
			this.annotationLayer.add(group);
			if (ann.id === selectedId) selectedAnn = ann;
		}

		// Selection box + handles on the top control layer — Select tool only.
		this.renderSelection(selectedAnn);

		this.annotationLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/** Draws one annotation's shapes into `group` from effective (transformed)
	 * anchor points. Shared by render and the live gesture redraw. */
	private appendShapes(group: Konva.Group, ann: Annotation, eff: PlanarPoint[]): void {
		const stroke = ann.style.color;
		const width = ann.style.width ?? 2;
		switch (ann.kind) {
			case 'pen': {
				const points = this.projection.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				break;
			}
			case 'arrow': {
				const points = this.projection.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				// Draw arrowhead at the end, pointing in the direction of the last segment
				if (eff.length >= 2) {
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
					group.add(
						new Konva.Line({
							points: [last.x, last.y, base1.x, base1.y, base2.x, base2.y, last.x, last.y],
							fill: stroke,
							stroke,
							strokeWidth: width,
							closed: true,
							tension: 0,
							hitStrokeWidth: 12,
							listening: true
						})
					);
				}
				break;
			}
			case 'zone': {
				const points = this.projection.projectSmoothed(eff, true).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						closed: true,
						fill: stroke,
						opacity: 0.15,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				break;
			}
			case 'label': {
				const atPx = this.projection.projectPoint(eff[0].x, eff[0].y);
				const fontSize = Math.max(12, 14 / this.stage.scaleX());
				const estimatedWidth = Math.max(100, ann.text.length * fontSize * 0.6);
				group.add(
					new Konva.Rect({
						x: atPx.x - 4,
						y: atPx.y - fontSize + 4,
						width: estimatedWidth + 8,
						height: fontSize + 8,
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
						fontFamily: 'Arial',
						fill: stroke,
						listening: false
					})
				);
				break;
			}
			case 'gap': {
				const fromPx = this.projection.projectPoint(eff[0].x, eff[0].y);
				const toPx = this.projection.projectPoint(eff[1].x, eff[1].y);
				const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
				const tickOffset = 8;
				group.add(
					new Konva.Line({
						points: [fromPx.x, fromPx.y, toPx.x, toPx.y],
						stroke,
						strokeWidth: width,
						dash: [8, 8],
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				for (const t of [fromPx, toPx]) {
					const t1 = {
						x: t.x + tickOffset * Math.cos(angle + Math.PI / 2),
						y: t.y + tickOffset * Math.sin(angle + Math.PI / 2)
					};
					const t2 = {
						x: t.x + tickOffset * Math.cos(angle - Math.PI / 2),
						y: t.y + tickOffset * Math.sin(angle - Math.PI / 2)
					};
					group.add(
						new Konva.Line({
							points: [t1.x, t1.y, t2.x, t2.y],
							stroke,
							strokeWidth: width,
							tension: 0,
							hitStrokeWidth: 12,
							listening: true
						})
					);
				}
				break;
			}
		}
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

	/** Live redraw of a single annotation from a working transform (gesture). */
	redrawOnly(annId: string, ann: Annotation, t: AnnotationTransform): void {
		const group = this.groupFor(annId);
		if (!group) return;
		group.destroyChildren();
		this.appendShapes(group, ann, effectiveAnchors(ann, t));
		this.annotationLayer.batchDraw();
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
		if (!ann || get(toolMode) !== 'select') return;

		const scale = this.stage.scaleX() || 1;
		const sel = new Konva.Group({ name: 'annotationSelection', listening: true });
		this.controlLayer.add(sel);

		if (ann.kind === 'label') {
			const atPx = this.projection.projectPoint(
				effectiveAnchors(ann)[0].x,
				effectiveAnchors(ann)[0].y
			);
			const fontSize = Math.max(12, 14 / scale);
			const w = Math.max(100, ann.text.length * fontSize * 0.6) + 8;
			const h = fontSize + 8;
			sel.add(
				new Konva.Rect({
					x: atPx.x - 4,
					y: atPx.y - fontSize + 4,
					width: w,
					height: h,
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

		this.controlLayer.batchDraw();
	}
}
