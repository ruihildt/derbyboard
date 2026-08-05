import { get } from 'svelte/store';
import Konva from 'konva';

import { toolMode, isDrawingTool } from '$lib/stores/toolMode';
import { selectedEntityId } from '$lib/stores/selection';
import { addAnnotation, setEntityPath } from '$lib/doc/clipOps';
import { simplify } from '$lib/track/pathMath';
import { MAX_PATH_LENGTH_M, MAX_PATH_POINTS } from '$lib/track/tween';
import type { Annotation, PlanarPoint, Step } from '$lib/doc/types';
import { entityColorFor } from '../entityColors';
import type { BoardProjection } from '../paths/projection';

// Thin, elongated crosshair cursor for drawing tools (pen, arrow, zone, label, gap, drawPath).
// 32x32 SVG with 28px arms, 1px stroke, centered hotspot at (16,16).
const CROSSHAIR_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><line x1="2" y1="16" x2="30" y2="16" stroke="%230f172a" stroke-width="1"/><line x1="16" y1="2" x2="16" y2="30" stroke="%230f172a" stroke-width="1"/></svg>') 16 16, crosshair`;

// Eraser cursor: small circle matching the canvas background color.
// 16x16 SVG with 7px diameter circle, 1px stroke, centered hotspot at (8,8).
const ERASE_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.25" fill="%23f0f0f0" stroke="%230f172a" stroke-width="0.75"/></svg>') 12 12, auto`;

export interface DrawingToolDeps {
	stage: Konva.Stage;
	projection: BoardProjection;
	pathLayer: Konva.Layer;
	annotationLayer: Konva.Layer;
	getActiveStep: () => Step | undefined;
	/** Re-render overlays after a gesture commits (paths/annotations changed). */
	onAfterCommit: (step: Step | undefined) => void;
}

/**
 * Input handling for the drawing tools (pen, arrow, zone, gap, label,
 * drawPath): freehand point capture with rAF-coalesced preview, the movement
 * path length budget (amber/red cue near/at MAX_PATH_LENGTH_M), discrete
 * label/gap anchors, and the per-tool cursors.
 *
 * The owner's stage pointermove/pointerup handlers must consult the
 * annotation gesture controller first, then call {@link handlePointerMove} /
 * {@link handlePointerUp} — gesture state always wins over drawing.
 */
export class DrawingToolController {
	private drawingPoints: PlanarPoint[] = [];
	private firstAnchor: PlanarPoint | null = null;
	private previewLine: Konva.Line | null = null;
	/** The gap tool's first-anchor→pointer preview, reused in place each frame. */
	private gapPreview: Konva.Line | null = null;
	private rafId: number | null = null;
	private pathLengthAccum = 0; // running arc-length for path cap enforcement

	constructor(private deps: DrawingToolDeps) {}

	/** Registers the stage pointerdown handler that arms a draw gesture. */
	attach(): void {
		const { stage } = this.deps;
		stage.on('pointerdown', (e) => this.handlePointerDown(e));
	}

	/** Helper to create an annotation. Annotations are always board-wide on
	 * creation (no scope); pin one to a step afterwards via setAnnotationScope. */
	private createAnnotation(ann: Annotation): void {
		addAnnotation(ann as Annotation & { id?: string });
	}

	private handlePointerDown(e: Konva.KonvaEventObject<unknown>): void {
		const { stage, projection } = this.deps;
		const tool = get(toolMode);
		if (!isDrawingTool(tool)) return;

		// Only handle on stage or overlay layers, not on UI controls.
		// Annotation shapes and active-step path lines are hittable content
		// (for selection in Select / targeting in Erase), but a new draw
		// should still start when the pointer lands on one — treat either
		// like the empty canvas.
		const drawTarget = e.target as Konva.Node;
		const passthrough =
			drawTarget.findAncestors('.annotation', true).length > 0 ||
			drawTarget.findAncestors('.lineShape', true).length > 0;
		if (!passthrough && drawTarget !== stage && drawTarget.parent !== stage) return;

		e.cancelBubble = true;

		const pos = stage.getPointerPosition();
		if (!pos) return;

		const planePos = projection.pointerToPlane(pos);

		if (tool === 'drawPath') {
			const selectedId = get(selectedEntityId);
			if (!selectedId) {
				// Need a selected entity to draw a path
				return;
			}
			this.pathLengthAccum = 0;
			// Prepend the entity's current pose so the path always starts at
			// the skater, with a straight segment to the first click.
			const step = this.deps.getActiveStep();
			const entityPose = step?.entities.find((en) => en.id === selectedId);
			if (entityPose) {
				this.drawingPoints = [
					{ x: entityPose.x, y: entityPose.y },
					{ x: planePos.x, y: planePos.y }
				];
				// Account for the initial straight segment in the length budget.
				this.pathLengthAccum = Math.hypot(planePos.x - entityPose.x, planePos.y - entityPose.y);
			} else {
				this.drawingPoints = [{ x: planePos.x, y: planePos.y }];
			}
		} else if (tool === 'pen' || tool === 'zone' || tool === 'arrow') {
			this.drawingPoints = [{ x: planePos.x, y: planePos.y }];
		} else if (tool === 'gap') {
			this.firstAnchor = { x: planePos.x, y: planePos.y };
		} else if (tool === 'label') {
			const text = prompt('Label text:');
			if (text && text.trim()) {
				// Create label annotation
				this.createAnnotation({
					id: crypto.randomUUID(),
					kind: 'label',
					at: { x: planePos.x, y: planePos.y },
					text: text.trim(),
					style: { color: '#e11d48', width: 2 }
				});
				// Auto-return to select after discrete tools
				toolMode.set('select');
			}
			return;
		}

		// Create preview for freehand tools. The preview is always an OPEN
		// stroke — the zone tool only closes/fills on release, so while
		// drawing it reads as a freehand outline, not a forming zone.
		if (tool === 'pen' || tool === 'drawPath' || tool === 'zone' || tool === 'arrow') {
			this.previewLine = new Konva.Line({
				points: projection.projectSmoothed(this.drawingPoints, false).flatMap((p) => [p.x, p.y]),
				stroke: tool === 'drawPath' ? entityColorFor(get(selectedEntityId) ?? '') : '#e11d48',
				strokeWidth: 2,
				lineCap: 'round',
				lineJoin: 'round',
				tension: 0,
				opacity: 0.5,
				listening: false
			});
			const layer = tool === 'drawPath' ? this.deps.pathLayer : this.deps.annotationLayer;
			layer.add(this.previewLine);
			layer.batchDraw();
		}
	}

	/** rAF-coalesced freehand capture; call from the owner's stage pointermove. */
	handlePointerMove(): void {
		const { stage, projection } = this.deps;
		const tool = get(toolMode);
		if (!isDrawingTool(tool) || (!this.firstAnchor && this.drawingPoints.length === 0)) return;

		if (this.rafId) return;
		this.rafId = requestAnimationFrame(() => {
			const pos = stage.getPointerPosition();
			if (!pos) return;

			const planePos = projection.pointerToPlane(pos);

			if (tool === 'pen' || tool === 'drawPath' || tool === 'zone' || tool === 'arrow') {
				// Enforce path-length cap for movement paths. Don't early-return
				// (that would skip `rafId = null` and freeze all further drawing).
				let acceptPoint = true;
				if (tool === 'drawPath' && this.drawingPoints.length > 0) {
					const last = this.drawingPoints[this.drawingPoints.length - 1];
					const segLen = Math.hypot(planePos.x - last.x, planePos.y - last.y);
					if (this.pathLengthAccum + segLen > MAX_PATH_LENGTH_M) {
						acceptPoint = false;
					} else {
						this.pathLengthAccum += segLen;
					}
				}

				if (acceptPoint) {
					this.drawingPoints.push({ x: planePos.x, y: planePos.y });
				}

				// Update preview (open stroke for all freehand tools, incl. zone)
				if (this.previewLine) {
					this.previewLine.points(
						projection.projectSmoothed(this.drawingPoints, false).flatMap((p) => [p.x, p.y])
					);
					// Visual cue: turn amber near the cap, red at the cap.
					if (tool === 'drawPath') {
						const ratio = this.pathLengthAccum / MAX_PATH_LENGTH_M;
						if (ratio >= 0.9) this.previewLine.stroke('#ef4444');
						else if (ratio >= 0.7) this.previewLine.stroke('#f59e0b');
					}
					this.deps.pathLayer.batchDraw();
				}
			} else if (tool === 'gap' && this.firstAnchor) {
				// Update preview line from first anchor to current. Reuse the node
				// and update its points in place — destroying + recreating it (and
				// the find() tree walk) every frame is the same churn that stalled
				// the rotate gesture.
				const layer = this.deps.annotationLayer;
				const firstPx = projection.projectPoint(this.firstAnchor.x, this.firstAnchor.y);
				const currentPx = { x: pos.x, y: pos.y };

				if (this.gapPreview) {
					this.gapPreview.points([firstPx.x, firstPx.y, currentPx.x, currentPx.y]);
				} else {
					this.gapPreview = new Konva.Line({
						name: 'arrowPreview',
						points: [firstPx.x, firstPx.y, currentPx.x, currentPx.y],
						stroke: '#e11d48',
						strokeWidth: 2,
						opacity: 0.5,
						dash: [8, 8],
						listening: false
					});
					layer.add(this.gapPreview);
				}
				layer.batchDraw();
			}

			this.rafId = null;
		});
	}

	/** Commits the draw gesture; call from the owner's stage pointerup/cancel. */
	handlePointerUp(): void {
		const { stage, projection } = this.deps;
		const tool = get(toolMode);
		if (!isDrawingTool(tool)) return;

		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}

		// Clear preview (surgical — renderAnnotations rebuilds the layer next)
		if (this.previewLine) {
			this.previewLine.destroy();
			this.previewLine = null;
		}
		if (this.gapPreview) {
			this.gapPreview.destroy();
			this.gapPreview = null;
		}

		const step = this.deps.getActiveStep();

		// Commit the gesture. `drawPath` is step-scoped (Free Play never arms
		// it, and it needs a step to attach the path to); the annotation tools
		// commit to the active step in Drill or to the board in Free Play.
		if (tool === 'drawPath' && step) {
			const selectedId = get(selectedEntityId);
			if (selectedId && this.drawingPoints.length >= 2) {
				// Simplify and cap to MAX_PATH_POINTS (most significant points kept).
				const simplified = simplify(this.drawingPoints, 0.15, MAX_PATH_POINTS);
				if (simplified.length >= 2) {
					setEntityPath(step.id, selectedId, simplified);
				}
			}
		} else if (tool === 'pen' && this.drawingPoints.length >= 2) {
			const simplified = simplify(this.drawingPoints, 0.15);
			if (simplified.length >= 2) {
				this.createAnnotation({
					id: crypto.randomUUID(),
					kind: 'pen',
					points: simplified,
					style: { color: '#e11d48', width: 2 }
				});
			}
		} else if (tool === 'arrow' && this.drawingPoints.length >= 2) {
			const simplified = simplify(this.drawingPoints, 0.15);
			if (simplified.length >= 2) {
				this.createAnnotation({
					id: crypto.randomUUID(),
					kind: 'arrow',
					points: simplified,
					style: { color: '#e11d48', width: 2 }
				});
			}
		} else if (tool === 'zone' && this.drawingPoints.length >= 3) {
			const simplified = simplify(this.drawingPoints, 0.15);
			if (simplified.length >= 3) {
				this.createAnnotation({
					id: crypto.randomUUID(),
					kind: 'zone',
					points: simplified,
					style: { color: '#e11d48', width: 2 }
				});
			}
		} else if (tool === 'gap' && this.firstAnchor) {
			const pos = stage.getPointerPosition();
			if (pos) {
				const planePos = projection.pointerToPlane(pos);

				this.createAnnotation({
					id: crypto.randomUUID(),
					kind: 'gap',
					from: this.firstAnchor,
					to: { x: planePos.x, y: planePos.y },
					style: { color: '#e11d48', width: 2 }
				});
			}
		}

		// Reset
		this.drawingPoints = [];
		this.firstAnchor = null;
		this.pathLengthAccum = 0;

		// Auto-return to select after gesture tools so the path's editing
		// nodes appear immediately — in Select the previous/current/next
		// paths for the selected entity all show their draggable handles.
		if (tool === 'gap' || tool === 'label' || tool === 'drawPath') {
			toolMode.set('select');
		}

		// Re-render overlays
		this.deps.onAfterCommit(step);
	}

	/** Updates the OS cursor based on the active tool.
	 * - Erase tool: shows eraser circle cursor
	 * - Drawing tools: shows crosshair cursor
	 * - Other tools: default cursor */
	updateCursor(replayMode: boolean): void {
		const tool = get(toolMode);
		const el = this.deps.stage.container();
		if (!el) return;

		if (tool === 'erase' && !replayMode) {
			el.style.cursor = ERASE_CURSOR;
		} else if (isDrawingTool(tool) && !replayMode) {
			el.style.cursor = CROSSHAIR_CURSOR;
		} else {
			el.style.cursor = '';
		}
	}
}
