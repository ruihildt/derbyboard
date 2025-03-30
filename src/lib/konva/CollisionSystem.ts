import Konva from 'konva';
import { KonvaPlayer } from './KonvaPlayer';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH } from '$lib/constants';

export class CollisionSystem {
	private layer: Konva.Layer;
	private iterationCount = 3;
	// Cache the players to avoid repeated queries
	private players: KonvaPlayer[] = [];

	constructor(layer: Konva.Layer) {
		this.layer = layer;

		// Listen for player additions/removals to update the player cache
		this.layer.on('add', (e) => {
			// Check if the added child is a playerGroup
			if (e.child && e.child.hasName && e.child.hasName('playerGroup')) {
				this.refreshPlayers();
			}
		});

		this.layer.on('remove', (e) => {
			if (e.child && e.child.hasName && e.child.hasName('playerGroup')) {
				this.refreshPlayers();
			}
		});

		// Initial player population
		this.refreshPlayers();
	}

	private refreshPlayers() {
		this.players = this.layer.find('.playerGroup').map((node) => node.getAttr('player'));
	}

	resolveCollisions() {
		for (let i = 0; i < this.iterationCount; i++) {
			this.resolveIteration(this.players);
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

		const minDistance = PLAYER_RADIUS * 2 + PLAYER_STROKE_WIDTH;

		if (distance < minDistance) {
			const force = (minDistance - distance) / 2;
			const dirX = dx / distance;
			const dirY = dy / distance;

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
