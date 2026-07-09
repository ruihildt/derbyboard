import Konva from 'konva';

import { KonvaTeamPlayer, TeamPlayerRole, TeamPlayerTeam } from './KonvaTeamPlayer';
import { KonvaSkatingOfficial, SkatingOfficialRole } from './KonvaSkatingOfficial';
import type { KonvaPlayer } from './KonvaPlayer';
import type { KonvaTrackGeometry } from './KonvaTrackGeometry';
import { get } from 'svelte/store';
import { boardState, type KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TeamPlayerPosition, SkatingOfficialPosition } from '$lib/stores/konvaBoardState';
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

	addTeamPlayer(x: number, y: number, team: TeamPlayerTeam, role: TeamPlayerRole, id?: string) {
		const player = new KonvaTeamPlayer(x, y, this.layer, team, role, this.trackGeometry, id);
		this.teamPlayers.push(player);
		return player;
	}

	addSkatingOfficial(x: number, y: number, role: SkatingOfficialRole, id?: string) {
		const official = new KonvaSkatingOfficial(x, y, this.layer, role, id);
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

	private findTeamPlayerById(id: string): KonvaTeamPlayer | undefined {
		return this.teamPlayers.find((p) => p.id === id);
	}

	private findOfficialById(id: string): KonvaSkatingOfficial | undefined {
		return this.skatingOfficials.find((p) => p.id === id);
	}

	/** Toggles draggability on every player/official group (used to lock the board during replay). */
	setPlayersDraggable(draggable: boolean): void {
		this.teamPlayers.forEach((p) => p.getNode().draggable(draggable));
		this.skatingOfficials.forEach((p) => p.getNode().draggable(draggable));
	}

	/**
	 * Reconciles team players to match a set of positions, correlating by id:
	 * remove players no longer present, add new ones, and update/replace the rest.
	 */
	reconcileTeamPlayers(positions: TeamPlayerPosition[], centerX: number, centerY: number): void {
		const desiredIds = new Set(positions.map((p) => p.id).filter((id): id is string => !!id));

		this.teamPlayers = this.teamPlayers.filter((player) => {
			if (!desiredIds.has(player.id)) {
				player.destroy();
				return false;
			}
			return true;
		});

		for (const pos of positions) {
			const id = pos.id ?? crypto.randomUUID();
			const absX = centerX + pos.relative.x;
			const absY = centerY + pos.relative.y;
			const existing = this.findTeamPlayerById(id);
			if (existing) {
				if (existing.role !== pos.role || existing.team !== pos.team) {
					// Role/team change the visual elements; recreate the node.
					const idx = this.teamPlayers.indexOf(existing);
					existing.destroy();
					this.teamPlayers[idx] = new KonvaTeamPlayer(
						absX,
						absY,
						this.layer,
						pos.team as TeamPlayerTeam,
						pos.role,
						this.trackGeometry,
						id
					);
				} else {
					existing.setPosition({ x: absX, y: absY });
				}
			} else {
				this.addTeamPlayer(absX, absY, pos.team as TeamPlayerTeam, pos.role, id);
			}
		}
	}

	/** Reconciles skating officials to match a set of positions, correlating by id. */
	reconcileSkatingOfficials(
		positions: SkatingOfficialPosition[],
		centerX: number,
		centerY: number
	): void {
		const desiredIds = new Set(positions.map((p) => p.id).filter((id): id is string => !!id));

		this.skatingOfficials = this.skatingOfficials.filter((official) => {
			if (!desiredIds.has(official.id)) {
				official.destroy();
				return false;
			}
			return true;
		});

		for (const pos of positions) {
			const id = pos.id ?? crypto.randomUUID();
			const absX = centerX + pos.relative.x;
			const absY = centerY + pos.relative.y;
			const existing = this.findOfficialById(id);
			if (existing) {
				if (existing.role !== pos.role) {
					const idx = this.skatingOfficials.indexOf(existing);
					existing.destroy();
					this.skatingOfficials[idx] = new KonvaSkatingOfficial(
						absX,
						absY,
						this.layer,
						pos.role,
						id
					);
				} else {
					existing.setPosition({ x: absX, y: absY });
				}
			} else {
				this.addSkatingOfficial(absX, absY, pos.role, id);
			}
		}
	}

	initialLoad() {
		const state = get(boardState);
		const centerX = this.layer.getStage()!.width() / 2;
		const centerY = this.layer.getStage()!.height() / 2;

		if (state.teamPlayers.length > 0) {
			// Migration: assign stable ids to persisted entries that predate them.
			let mutated = false;
			state.teamPlayers.forEach((player) => {
				if (!player.id) {
					player.id = crypto.randomUUID();
					mutated = true;
				}
			});
			state.skatingOfficials.forEach((official) => {
				if (!official.id) {
					official.id = crypto.randomUUID();
					mutated = true;
				}
			});
			if (mutated) {
				boardState.set(state);
			}

			state.teamPlayers.forEach((player) => {
				this.addTeamPlayer(
					centerX + player.relative.x,
					centerY + player.relative.y,
					player.team as TeamPlayerTeam,
					player.role,
					player.id
				);
			});

			state.skatingOfficials.forEach((official) => {
				this.addSkatingOfficial(
					centerX + official.relative.x,
					centerY + official.relative.y,
					official.role,
					official.id
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
