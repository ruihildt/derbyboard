import type Konva from 'konva';

interface Point {
	x: number;
	y: number;
}

function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Two-finger pinch-zoom (touch) and wheel-zoom (desktop) for the board stage.
 * Both zoom toward the gesture anchor (pinch midpoint / cursor) and persist the
 * resulting view. No-ops while replay drives the board. Relies on the board
 * container's `touch-action: none` so the browser does not steal the gestures.
 */
export class KonvaGestureHandler {
	private stage: Konva.Stage;
	private el: HTMLElement;
	private zoomAt: (point: Point, scale: number) => void;
	private isReplay: () => boolean;
	private persist: () => void;

	private pointers = new Map<number, Point>();
	private pinching = false;
	private startDistance = 0;
	private startScale = 1;
	private prevDraggable = true;
	private persistTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		stage: Konva.Stage,
		zoomAt: (point: Point, scale: number) => void,
		isReplay: () => boolean,
		persist: () => void
	) {
		this.stage = stage;
		this.el = stage.container();
		this.zoomAt = zoomAt;
		this.isReplay = isReplay;
		this.persist = persist;

		this.el.addEventListener('pointerdown', this.onPointerDown);
		window.addEventListener('pointermove', this.onPointerMove);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointercancel', this.onPointerUp);
		this.stage.on('wheel', this.onWheel);
	}

	destroy() {
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.el.removeEventListener('pointerdown', this.onPointerDown);
		window.removeEventListener('pointermove', this.onPointerMove);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointercancel', this.onPointerUp);
		this.stage.off('wheel', this.onWheel);
	}

	private toLocal(e: PointerEvent): Point {
		const rect = this.el.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	private onPointerDown = (e: PointerEvent) => {
		if (this.isReplay()) return;
		this.pointers.set(e.pointerId, this.toLocal(e));
		if (!this.pinching && this.pointers.size === 2) {
			const [a, b] = [...this.pointers.values()];
			if (!this.isOnMovable(a) && !this.isOnMovable(b)) this.beginPinch();
		}
	};

	/** True when a movable target (a player) is under the given stage-space point. */
	private isOnMovable(point: Point): boolean {
		let node: Konva.Node | null = this.stage.getIntersection(point);
		while (node) {
			if (node.hasName('playerGroup')) return true;
			node = node.getParent();
		}
		return false;
	}

	private onPointerMove = (e: PointerEvent) => {
		if (this.isReplay() || !this.pointers.has(e.pointerId)) return;
		this.pointers.set(e.pointerId, this.toLocal(e));
		if (this.pinching) this.updatePinch();
	};

	private onPointerUp = (e: PointerEvent) => {
		if (!this.pointers.has(e.pointerId)) return;
		this.pointers.delete(e.pointerId);
		if (this.pinching && this.pointers.size < 2) this.endPinch();
	};

	private beginPinch() {
		this.pinching = true;
		this.startScale = this.stage.scaleX();
		this.prevDraggable = this.stage.draggable();
		this.stage.draggable(false);
		const [a, b] = [...this.pointers.values()];
		this.startDistance = distance(a, b);
	}

	private updatePinch() {
		if (this.startDistance <= 0) return;
		const pts = [...this.pointers.values()];
		if (pts.length < 2) return;
		const ratio = distance(pts[0], pts[1]) / this.startDistance;
		this.zoomAt(midpoint(pts[0], pts[1]), this.startScale * ratio);
	}

	private endPinch() {
		this.pinching = false;
		this.startDistance = 0;
		this.stage.draggable(this.prevDraggable);
		this.persist();
	}

	private onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
		if (this.isReplay()) return;
		e.evt.preventDefault();
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		const factor = Math.exp(-e.evt.deltaY * 0.001);
		this.zoomAt(pos, this.stage.scaleX() * factor);
		this.schedulePersist();
	};

	private schedulePersist() {
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.persistTimer = setTimeout(() => this.persist(), 200);
	}
}
