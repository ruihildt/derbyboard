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
	constructor(
		private stage: Konva.Stage,
		private getViewportSize: () => { width: number; height: number }
	) {}

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
	 */
	pointerToPlane(pos: { x: number; y: number }): PlanarPoint {
		const center = this.stageCenter();
		const scale = this.stage.scaleX();
		const contentX = (pos.x - this.stage.x()) / scale;
		const contentY = (pos.y - this.stage.y()) / scale;
		return {
			x: (contentX - center.x) / TRACK_SCALE,
			y: (contentY - center.y) / TRACK_SCALE
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
	 * the current stage pan/zoom. Used by the DOM HUD overlays, which track
	 * positions per frame but compute everything else reactively.
	 */
	planeToScreen(p: PlanarPoint): { x: number; y: number } {
		const center = this.stageCenter();
		const scale = this.stage.scaleX();
		return {
			x: this.stage.x() + (center.x + p.x * TRACK_SCALE) * scale,
			y: this.stage.y() + (center.y + p.y * TRACK_SCALE) * scale
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
