import Konva from 'konva';

import { PLAYER_RADIUS } from '$lib/constants';
import type { Step } from '$lib/doc/types';
import { entityColorFor } from '../entityColors';
import type { BoardProjection } from '../paths/projection';

/**
 * Renders onion-skin ghosts of neighbouring steps.
 * Ghosts are translucent circles at each entity's pose.
 */
export class OnionSkinRenderer {
	constructor(
		private layer: Konva.Layer,
		private projection: BoardProjection
	) {}

	render(prevStep: Step | undefined, nextStep: Step | undefined, depth: number): void {
		this.layer.destroyChildren();

		const renderGhosts = (step: Step | undefined, offset: number) => {
			if (!step) return;

			const group = new Konva.Group({ listening: false });
			const opacity = depth >= 2 && Math.abs(offset) === 2 ? 0.12 : 0.25;

			for (const pose of step.entities) {
				const { x: cx, y: cy } = this.projection.projectPoint(pose.x, pose.y);

				const color = entityColorFor(pose.id);

				group.add(
					new Konva.Circle({
						x: cx,
						y: cy,
						radius: PLAYER_RADIUS,
						fill: color,
						opacity,
						stroke: 'black',
						strokeWidth: 1,
						listening: false
					})
				);
			}

			this.layer.add(group);
		};

		// ±1 always available
		renderGhosts(prevStep, -1);
		renderGhosts(nextStep, 1);

		// ±2 when depth >= 2
		if (depth >= 2) {
			renderGhosts(undefined, -2); // Placeholder for deeper prev
			renderGhosts(undefined, 2); // Placeholder for deeper next
		}

		this.layer.batchDraw();
	}

	clear(): void {
		this.layer.destroyChildren();
		this.layer.batchDraw();
	}
}
