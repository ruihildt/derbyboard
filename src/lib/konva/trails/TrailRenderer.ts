import Konva from 'konva';

import { PLAYER_RADIUS } from '$lib/constants';
import type { EntityPose } from '$lib/doc/types';
import { entityColorFor } from '../entityColors';
import type { BoardProjection } from '../paths/projection';

/** Max tail points kept per entity for motion trails. */
const TRAIL_MAX_POINTS = 24;

/**
 * Fading team-coloured tails behind entities during authored playback.
 * Owns the trail polylines on the trail layer; the enabled flag and the
 * decision of when to push poses stay with the caller.
 */
export class TrailRenderer {
	private trails = new Map<string, Konva.Line>();

	constructor(
		private layer: Konva.Layer,
		private projection: BoardProjection,
		private getZoom: () => number
	) {}

	/** Appends the current projected position of each entity to its trail. */
	push(poses: EntityPose[]): void {
		const zoom = this.getZoom();
		for (const pose of poses) {
			const { x, y } = this.projection.projectPoint(pose.x, pose.y);
			let line = this.trails.get(pose.id);
			if (!line) {
				line = new Konva.Line({
					points: [x, y],
					stroke: entityColorFor(pose.id),
					strokeWidth: Math.max(1.5, (PLAYER_RADIUS * 0.35) / zoom),
					opacity: 0.5,
					lineCap: 'round',
					lineJoin: 'round',
					listening: false
				});
				this.layer.add(line);
				this.trails.set(pose.id, line);
			}
			const pts = line.points();
			pts.push(x, y);
			while (pts.length > TRAIL_MAX_POINTS * 2) pts.splice(0, 2);
			line.points(pts);
			line.strokeWidth(Math.max(1.5, (PLAYER_RADIUS * 0.35) / zoom));
		}
	}

	/** Removes all trail polylines (e.g. on playback start/stop or board rebuild). */
	clear(): void {
		this.trails.clear();
		this.layer.destroyChildren();
		this.layer.batchDraw();
	}
}
