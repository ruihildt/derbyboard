import Konva from 'konva';
import { KonvaPlayer } from './KonvaPlayer';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH } from '$lib/constants';

export class CollisionSystem {
	private layer: Konva.Layer;
	private iterationCount = 3;

	constructor(layer: Konva.Layer) {
		this.layer = layer;
	}

	/**
	 * Separates all overlapping pairs, synchronously within the dragmove
	 * event. Synchronous is deliberate: Konva snaps the dragged node to the
	 * pointer BEFORE firing dragmove and paints right after — deferring the
	 * solve to rAF lets the pointer-overlap state reach the screen first, so
	 * the dragged player visibly penetrates its neighbour and then springs
	 * back out every frame (the "rebound" regression). The solve itself is
	 * cheap arithmetic; the real costs were the tree-wide `layer.find` (now
	 * the manager's tracked arrays) and the 3× event storm (now final
	 * iteration only), both of which stay fixed.
	 */
	resolveCollisions(teamPlayers: KonvaPlayer[], skatingOfficials: KonvaPlayer[]) {
		const a = teamPlayers;
		const b = skatingOfficials;
		const total = a.length + b.length;
		const at = (i: number): KonvaPlayer => (i < a.length ? a[i] : b[i - a.length]);

		for (let iter = 0; iter < this.iterationCount; iter++) {
			// Collision events (which mirror nudged positions into the pose
			// store and refresh in-bounds) only fire on the final iteration:
			// intermediate nudges are invisible, and each event bubbles to the
			// layer handler doing store writes — 3 iterations meant 3× the
			// event/store churn per event.
			const fireEvents = iter === this.iterationCount - 1;
			let moved = false;
			for (let i = 0; i < total; i++) {
				for (let j = i + 1; j < total; j++) {
					if (this.resolveConstraint(at(i), at(j), fireEvents)) moved = true;
				}
			}
			// Converged early: no pair overlapped, further iterations are no-ops.
			if (!moved) break;
		}
		this.layer.batchDraw();
	}

	/**
	 * Separates one overlapping pair. Returns true when either node moved.
	 * `fireEvents` gates the `collision` Konva events (see resolveCollisions).
	 */
	private resolveConstraint(
		player1: KonvaPlayer,
		player2: KonvaPlayer,
		fireEvents = true
	): boolean {
		const group1 = player1.getNode();
		const group2 = player2.getNode();

		const pos1 = group1.position();
		const pos2 = group2.position();

		const dx = pos2.x - pos1.x;
		const dy = pos2.y - pos1.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		// If either node already carries a non-finite position, bail out:
		// `NaN < minDistance` is false anyway, but being explicit keeps a
		// poisoned node from re-entering the solver.
		if (!Number.isFinite(distance)) return false;

		const minDistance = PLAYER_RADIUS * 2 + PLAYER_STROKE_WIDTH;

		if (distance >= minDistance) return false;

		{
			// Coincident (distance ≈ 0) nodes would give dirX/dirY = 0/0 = NaN,
			// poisoning both nodes' positions. Fall back to a deterministic
			// separation axis so the solver always emits finite coordinates.
			// This is a degenerate recovery path — under normal play two players
			// never occupy the exact same point — but solver finiteness must be
			// invariant regardless of input.
			let dirX: number;
			let dirY: number;
			if (distance < 1e-6) {
				dirX = 0;
				dirY = -1;
			} else {
				dirX = dx / distance;
				dirY = dy / distance;
			}
			const force = (minDistance - distance) / 2;

			group1.position({
				x: pos1.x - dirX * force,
				y: pos1.y - dirY * force
			});

			group2.position({
				x: pos2.x + dirX * force,
				y: pos2.y + dirY * force
			});

			// Fire Konva custom events (final iteration only — see solvePending)
			if (fireEvents) {
				group1.fire(
					'collision',
					{
						target: group1,
						otherPlayer: player2,
						force
					},
					true
				);

				group2.fire(
					'collision',
					{
						target: group2,
						otherPlayer: player1,
						force
					},
					true
				);
			}
		}
		return true;
	}
}
