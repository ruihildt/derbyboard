import Konva from 'konva';

import { KonvaTeamPlayer, TeamPlayerRole, TeamPlayerTeam } from './KonvaTeamPlayer';
import { KonvaSkatingOfficial, SkatingOfficialRole } from './KonvaSkatingOfficial';
import type { KonvaPlayer } from './KonvaPlayer';
import type { KonvaTrackGeometry } from './KonvaTrackGeometry';
import { get } from 'svelte/store';
import { boardState, type KonvaBoardState } from '$lib/stores/konvaBoardState';
import { CollisionSystem } from './CollisionSystem';
import defaultLineup from '$lib/data/start-flat.json';

export class KonvaPlayerManager {
	private layer: Konva.Layer;
	private trackGeometry: KonvaTrackGeometry;
	private collisionSystem: CollisionSystem;

	private teamPlayers: KonvaTeamPlayer[] = [];
	private skatingOfficials: KonvaSkatingOfficial[] = [];

	constructor(layer: Konva.Layer, trackGeometry: KonvaTrackGeometry) {
		this.layer = layer;
		this.trackGeometry = trackGeometry;
		this.collisionSystem = new CollisionSystem(layer);
	}

	/**
	 * Delegated handler for player drag/touch movement.
	 * Resolves collisions and refreshes the dragged player's in-bounds status.
	 */
	handleDragMove(e: Konva.KonvaEventObject<unknown>): void {
		const target = e.target as Konva.Node;
		if (target.hasName('playerGroup')) {
			this.collisionSystem.resolveCollisions();

			const player = target.getAttr('player');
			if (player instanceof KonvaTeamPlayer) {
				player.updateInBounds(this.trackGeometry);
			}
		}
	}

	/**
	 * Delegated handler for collision events fired by CollisionSystem.
	 * Refreshes in-bounds status for both colliding players.
	 */
	handleCollision(e: Konva.KonvaEventObject<unknown>): void {
		const evt = e as Konva.KonvaEventObject<unknown> & { otherPlayer?: KonvaPlayer };
		const target = e.target as Konva.Node;
		const player = target.getAttr('player');
		const otherPlayer = evt.otherPlayer;

		if (player instanceof KonvaTeamPlayer) {
			player.updateInBounds(this.trackGeometry);
		}
		if (otherPlayer instanceof KonvaTeamPlayer) {
			otherPlayer.updateInBounds(this.trackGeometry);
		}
	}

	addTeamPlayer(x: number, y: number, team: TeamPlayerTeam, role: TeamPlayerRole) {
		const player = new KonvaTeamPlayer(x, y, this.layer, team, role, this.trackGeometry);
		this.teamPlayers.push(player);
		return player;
	}

	addSkatingOfficial(x: number, y: number, role: SkatingOfficialRole) {
		const official = new KonvaSkatingOfficial(x, y, this.layer, role);
		this.skatingOfficials.push(official);
		return official;
	}

	getBlockers() {
		return this.teamPlayers.filter(
			(player) => player.role === TeamPlayerRole.blocker || player.role === TeamPlayerRole.pivot
		);
	}

	getTeamPlayers() {
		return this.teamPlayers;
	}

	getSkatingOfficials() {
		return this.skatingOfficials;
	}

	initialLoad() {
		const state = get(boardState);
		const centerX = this.layer.getStage()!.width() / 2;
		const centerY = this.layer.getStage()!.height() / 2;

		if (state.teamPlayers.length > 0) {
			state.teamPlayers.forEach((player) => {
				this.addTeamPlayer(
					centerX + player.relative.x,
					centerY + player.relative.y,
					player.team as TeamPlayerTeam,
					player.role
				);
			});

			state.skatingOfficials.forEach((official) => {
				this.addSkatingOfficial(
					centerX + official.relative.x,
					centerY + official.relative.y,
					official.role
				);
			});
		} else {
			this.loadDefaultLineup();
		}
	}

	loadDefaultLineup() {
		// Type conversion for the predefined lineup
		const typedLineup: KonvaBoardState = {
			...defaultLineup,
			teamPlayers: defaultLineup.teamPlayers.map((player) => ({
				...player,
				role: player.role as TeamPlayerRole,
				team: player.team as TeamPlayerTeam
			})),
			skatingOfficials: defaultLineup.skatingOfficials.map((official) => ({
				...official,
				role: official.role as SkatingOfficialRole
			}))
		};

		// Update the store with the predefined lineup
		boardState.set(typedLineup);

		// Load the players from the updated store
		this.initialLoad();
	}
}
