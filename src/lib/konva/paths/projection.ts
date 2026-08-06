import type Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { buildArcLength, catmullRom, catmullRomClosed } from '$lib/track/pathMath';
import type { PlanarPoint } from '$lib/doc/types';

/**
 * Coordinate conversion between stage pixels and planar world metres (the
 * canonical stored coordinate system). Shared by the path, annotation,
 * onion-skin and trail renderers.
 *
 * The viewport size is read lazily through `getViewportSize` so the
 * projection stays correct across board resizes without an explicit update.
 */
export class BoardProjection {
	/** Whole-board view rotation in degrees (0/90/180/270), applied around the
	 * stage centre. The layers themselves are rotated to match (see
	 * KonvaGame.applyBoardRotation); this value only governs the inverse maps
	 * (screen→planar input, planar→screen DOM HUD) so pointer/drag math and the
	 * floating HUDs stay aligned with the rotated content. */
	private boardRotationDeg = 0;

	constructor(
		private stage: Konva.Stage,
		private getViewportSize: () => { width: number; height: number }
	) {}

	/** Sets the board view rotation (degrees). Identity at 0. */
	setRotation(deg: number): void {
		this.boardRotationDeg = deg;
	}

	/** Current board view rotation in degrees. */
	rotationDeg(): number {
		return this.boardRotationDeg;
	}

	/**
	 * Stage-space centre of the board content (track centring offset). All
	 * planar coordinates are relative to this point.
	 */
	stageCenter(): { x: number; y: number } {
		const { width, height } = this.getViewportSize();
		return { x: width / 2, y: height / 2 };
	}

	/**
	 * Converts a stage-space pointer position to planar world metres. The
	 * canonical stored coordinate system is planar, so drawing/storing a point
	 * needs no track conversion — `(S, u)` is derived on demand elsewhere.
	 *
	 * `stage.getPointerPosition()` returns the pointer relative to the stage's
	 * top-left in raw viewport pixels — it does NOT undo the stage's own
	 * zoom/pan transform (stage.scale / stage.position, set by fitToTrack,
	 * wheel/pinch zoom, and panning). Undo that transform first so the planar
	 * coordinate matches what is actually under the cursor at any zoom/pan.
	 * Without this, a zoomed/panned board places drawn points off the cursor
	 * (radially toward the transform's origin), which reads as a consistent
	 * angular offset.
	 *
	 * The board view rotation (set on every content layer) is then undone here
	 * too, so drawing/dragging lands on the planar point actually under the
	 * cursor even when the board is rotated 90/180/270°.
	 */
	pointerToPlane(pos: { x: number; y: number }): PlanarPoint {
		const center = this.stageCenter();
		const scale = this.stage.scaleX();
		const parentX = (pos.x - this.stage.x()) / scale;
		const parentY = (pos.y - this.stage.y()) / scale;
		// Undo the layer rotation: parent-space point → layer-local (content)
		// point by rotating −θ around the centre.
		const a = (-this.boardRotationDeg * Math.PI) / 180;
		const cos = Math.cos(a);
		const sin = Math.sin(a);
		const dx = parentX - center.x;
		const dy = parentY - center.y;
		return {
			x: (dx * cos - dy * sin) / TRACK_SCALE,
			y: (dx * sin + dy * cos) / TRACK_SCALE
		};
	}

	/**
	 * Projects a planar world-metre point to stage pixel coordinates.
	 * Used by path/annotation/onion-skin renderers.
	 */
	projectPoint(x: number, y: number): { x: number; y: number } {
		const center = this.stageCenter();
		return { x: center.x + x * TRACK_SCALE, y: center.y + y * TRACK_SCALE };
	}

	/**
	 * Projects a planar world-metre point to viewport (screen) pixels through
	 * the current stage pan/zoom AND the board view rotation. Used by the DOM
	 * HUD overlays, which track positions per frame but compute everything else
	 * reactively.
	 */
	planeToScreen(p: PlanarPoint): { x: number; y: number } {
		const center = this.stageCenter();
		const scale = this.stage.scaleX();
		// Layer-local offset from centre, then apply the board rotation so the
		// HUD tracks the rotated content.
		const lx = p.x * TRACK_SCALE;
		const ly = p.y * TRACK_SCALE;
		const a = (this.boardRotationDeg * Math.PI) / 180;
		const cos = Math.cos(a);
		const sin = Math.sin(a);
		const parentX = center.x + lx * cos - ly * sin;
		const parentY = center.y + lx * sin + ly * cos;
		return {
			x: this.stage.x() + parentX * scale,
			y: this.stage.y() + parentY * scale
		};
	}

	/**
	 * Smooths planar points via Catmull-Rom and projects them to stage
	 * pixels. Returns null if the arc length is zero (degenerate path).
	 */
	smoothProject(points: PlanarPoint[]): { x: number; y: number }[] | null {
		if (buildArcLength(points).total === 0) return null;
		return catmullRom(points, 8).map((pt) => this.projectPoint(pt.x, pt.y));
	}

	/**
	 * Smooths planar points with Catmull-Rom and projects them to stage pixels
	 * for annotation rendering (pen = open curve, zone = closed loop). Unlike
	 * smoothProject this never returns null — it falls back to straight
	 * projection for degenerate (< 2 point) input — so a stroke always renders.
	 */
	projectSmoothed(points: PlanarPoint[], closed = false): { x: number; y: number }[] {
		if (points.length < 2) return points.map((p) => this.projectPoint(p.x, p.y));
		const smoothed = closed ? catmullRomClosed(points, 8) : catmullRom(points, 8);
		return smoothed.map((p) => this.projectPoint(p.x, p.y));
	}
}
