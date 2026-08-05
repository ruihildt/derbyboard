import { get } from 'svelte/store';
import type Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { toolMode } from '$lib/stores/toolMode';
import {
	selectedAnnotationId,
	selectedEntityId,
	directionControlActive
} from '$lib/stores/selection';
import { boardDoc } from '$lib/doc/store';
import { setAnnotationTransform } from '$lib/doc/clipOps';
import type { Annotation, AnnotationTransform, PlanarPoint } from '$lib/doc/types';
import {
	baseBox,
	resolvedTransform,
	moveTransform,
	resizeTransform,
	rotateTransform
} from '../annotationTransform';
import { annotationIdFromEvent } from '../tools/hitTest';
import type { BoardProjection } from '../paths/projection';
import type { AnnotationRenderer, AnnotationGestureType } from './AnnotationRenderer';

/** State of an active move/resize/rotate gesture. */
interface AnnotationGestureState {
	type: AnnotationGestureType;
	annId: string;
	ann: Annotation;
	baseHw: number;
	baseHh: number;
	start: AnnotationTransform;
	startPointer: PlanarPoint;
	su: number;
	sv: number;
	/** Cached group ref for the move path (avoids a per-frame `.find`). */
	moveGroup?: Konva.Group;
}

/**
 * Move/resize/rotate gesture state machine for annotations. Started from the
 * selection chrome (see {@link AnnotationRenderer.onGestureStart}), driven by
 * the owner's stage pointermove/pointerup handlers, and committed to the
 * document (one undo entry) on pointer-up.
 */
export class AnnotationGestures {
	private gesture: AnnotationGestureState | null = null;
	/** Pending rAF for the coalesced gesture redraw. */
	private rafId: number | null = null;
	/** Suppresses the click that follows a gesture so it doesn't deselect.
	 * Timestamp (not a flag) so a touch drag — which fires no click — can't
	 * leave a lingering flag that swallows the next genuine tap. */
	private lastGestureEnd = 0;
	/** An armed direct grab: a pointerdown landed on an (unselected)
	 * annotation shape. A move beyond {@link GRAB_THRESHOLD_PX} promotes it to
	 * a real move gesture AND auto-selects the mark; a plain click (release
	 * under threshold) leaves selection to the click handler. */
	private pendingMove: { annId: string; startX: number; startY: number } | null = null;
	/** Drag threshold (px) before a press on an annotation becomes a move. */
	private static readonly GRAB_THRESHOLD_PX = 4;

	constructor(
		private stage: Konva.Stage,
		private projection: BoardProjection,
		private renderer: AnnotationRenderer,
		/** Re-render everything after a commit (owner supplies the active step). */
		private onSettled: () => void
	) {}

	/** True while a move/resize/rotate gesture is in flight. */
	isActive(): boolean {
		return this.gesture !== null;
	}

	/**
	 * Returns true (once) when a click lands within 400ms of a gesture end,
	 * so the owner can swallow it instead of deselecting the mark.
	 */
	consumeClickSuppression(): boolean {
		if (this.lastGestureEnd && Date.now() - this.lastGestureEnd < 400) {
			this.lastGestureEnd = 0;
			return true;
		}
		return false;
	}

	/**
	 * Arms a direct grab from a stage `pointerdown` on an annotation shape
	 * (the selection chrome's own pointerdown cancels bubbling, so it never
	 * reaches here). Only annotations are armed — players drag via Konva and
	 * auto-select on their own `dragstart`. Call from the owner's pointerdown.
	 */
	armDirectMove(e: Konva.KonvaEventObject<unknown>): void {
		this.pendingMove = null;
		if (get(toolMode) !== 'select') return;
		const target = e.target as Konva.Node;
		// Skip chrome nodes (they carry a cursorHint and start gestures directly).
		if (target.getAttr('cursorHint')) return;
		const annId = annotationIdFromEvent(e);
		if (!annId) return;
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		this.pendingMove = { annId, startX: pos.x, startY: pos.y };
	}

	/**
	 * Promotes an armed direct grab to a real move gesture once the pointer
	 * crosses the drag threshold, auto-selecting the mark first. Returns true
	 * when a gesture just began (so the owner can drive its first update).
	 * Call from the owner's pointermove when no gesture is active yet.
	 */
	maybeBeginDirectMove(): boolean {
		const p = this.pendingMove;
		if (!p) return false;
		const pos = this.stage.getPointerPosition();
		if (!pos) return false;
		const dx = pos.x - p.startX;
		const dy = pos.y - p.startY;
		if (dx * dx + dy * dy < AnnotationGestures.GRAB_THRESHOLD_PX ** 2) return false;
		this.pendingMove = null;
		const ann = boardDoc.current.annotations?.find((a) => a.id === p.annId);
		if (!ann) return false;
		// Auto-select first (rebuilds the chrome), then start the move from the
		// current pointer so there's no jump. Mutual exclusion clears the entity.
		selectedAnnotationId.set(p.annId);
		selectedEntityId.set(null);
		directionControlActive.set(false);
		this.start('move', ann);
		return true;
	}

	/** Clears an armed direct grab (pointerup without a drag → it was a click). */
	clearArmed(): void {
		this.pendingMove = null;
	}

	/** Begins a move/resize/rotate gesture for an annotation. `e` is optional:
	 * the selection chrome passes its pointerdown event (to stop the click that
	 * follows), while a direct grab started from pointermove supplies none. */
	start(
		type: AnnotationGestureType,
		ann: Annotation,
		e?: Konva.KonvaEventObject<unknown>,
		su = 0,
		sv = 0
	): void {
		if (get(toolMode) !== 'select') return;
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		const b = baseBox(ann);
		this.gesture = {
			type,
			annId: ann.id,
			ann,
			baseHw: b.hw,
			baseHh: b.hh,
			start: resolvedTransform(ann),
			startPointer: this.projection.pointerToPlane(pos),
			su,
			sv
		};
		if (e) e.cancelBubble = true;
		// Every gesture marks the mark's shapes and the selection chrome
		// non-listening so batchDraw skips the hit-canvas repaint each frame —
		// otherwise a move drag of a many-point stroke repaints its entire
		// (thick hitStrokeWidth) hit path per frame and saturates the main
		// thread. Listening is restored by the commit render
		// (updateAnnotationGroup / fresh selection chrome).
		this.renderer.beginGesture(ann);
		if (type === 'move') {
			// Cache the dragged group's ref once so the per-frame move path
			// skips the `.find('.annotation')` tree traversal.
			this.gesture.moveGroup = this.renderer.groupFor(ann.id);
		}
	}

	/** rAF-coalesced live update; call from the owner's stage pointermove. */
	scheduleUpdate(): void {
		// pointermove fires faster than the display refresh (especially
		// coalesced touch events), but only the latest pointer position
		// before paint matters.
		if (this.rafId !== null) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			this.update();
		});
	}

	/** Commits the gesture's final transform (one undo entry) and re-renders. */
	commit(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		const g = this.gesture;
		this.gesture = null;
		this.lastGestureEnd = Date.now();
		// Exit the live in-place edit; onSettled runs the full render which
		// rebuilds the canonical, hittable scene (listening restored).
		if (g) this.renderer.endGesture();
		if (!g) return;
		const pos = this.stage.getPointerPosition();
		const t = pos ? this.gestureTransform(g, this.projection.pointerToPlane(pos)) : g.start;
		if (transformsDiffer(t, g.start)) {
			setAnnotationTransform(g.annId, t);
		}
		this.onSettled();
	}

	/** Cancels any pending rAF (owner teardown). */
	destroy(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		// A gesture torn down mid-flight must still end the renderer's live edit.
		if (this.gesture) {
			this.gesture = null;
			this.renderer.endGesture();
		}
	}

	/** Applies the live transform during a drag and redraws the mark + box. */
	private update(): void {
		const g = this.gesture;
		if (!g) return;
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		const t = this.gestureTransform(g, this.projection.pointerToPlane(pos));

		if (g.type === 'move') {
			// Cheap path: a move is a uniform translation, so just offset the
			// existing nodes (they're built at origin) instead of destroying
			// and rebuilding every shape — and the selection box with its five
			// handles — on every frame of the drag. Both node refs are cached
			// at gesture start to skip the per-frame `.find` traversals.
			const dx = (t.cx - g.start.cx) * TRACK_SCALE;
			const dy = (t.cy - g.start.cy) * TRACK_SCALE;
			g.moveGroup?.position({ x: dx, y: dy });
			this.renderer.moveSelectionBy(dx, dy);
			this.renderer.batchDraw();
			return;
		}

		// Resize/rotate: sync the existing shapes and selection chrome IN
		// PLACE (no destroy/create churn, no hit-canvas repaint). Previously
		// this destroyed and rebuilt the whole mark + box + 6 handles every
		// frame, whose allocation churn drove multi-hundred-ms GC spikes.
		this.renderer.liveUpdate(g.ann, t);
		this.renderer.updateSelectionGeometry(g.ann, t);
	}

	/** Computes the transform for the active gesture from the live pointer. */
	private gestureTransform(g: AnnotationGestureState, pointer: PlanarPoint): AnnotationTransform {
		if (g.type === 'move') {
			return moveTransform(g.start, {
				x: pointer.x - g.startPointer.x,
				y: pointer.y - g.startPointer.y
			});
		}
		if (g.type === 'resize') {
			return resizeTransform(g.start, g.baseHw, g.baseHh, g.su, g.sv, pointer);
		}
		return rotateTransform(g.start, { x: g.start.cx, y: g.start.cy }, g.startPointer, pointer);
	}
}

function transformsDiffer(a: AnnotationTransform, b: AnnotationTransform): boolean {
	return a.cx !== b.cx || a.cy !== b.cy || a.angle !== b.angle || a.sx !== b.sx || a.sy !== b.sy;
}
