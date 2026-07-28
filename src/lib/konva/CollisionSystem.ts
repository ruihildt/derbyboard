import Konva from 'konva';
import { KonvaPlayer } from './KonvaPlayer';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH } from '$lib/constants';

export class CollisionSystem {
	private layer: Konva.Layer;
	private iterationCount = 3;

	constructor(layer: Konva.Layer) {
		this.layer = layer;
	}

	resolveCollisions() {
		const players = this.layer.find('.playerGroup').map((node) => node.getAttr('player'));
		for (let i = 0; i < this.iterationCount; i++) {
			this.resolveIteration(players);
		}
		this.layer.batchDraw();
	}

	private resolveIteration(players: KonvaPlayer[]) {
		for (let i = 0; i < players.length; i++) {
			for (let j = i + 1; j < players.length; j++) {
				this.resolveConstraint(players[i], players[j]);
			}
		}
	}

	private resolveConstraint(player1: KonvaPlayer, player2: KonvaPlayer) {
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
		if (!Number.isFinite(distance)) return;

		const minDistance = PLAYER_RADIUS * 2 + PLAYER_STROKE_WIDTH;

		if (distance < minDistance) {
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

			// Fire Konva custom events
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
}
