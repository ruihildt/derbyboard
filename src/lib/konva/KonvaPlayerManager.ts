import Konva from 'konva';

import { KonvaTeamPlayer, TeamPlayerRole, TeamPlayerTeam } from './KonvaTeamPlayer';
import { KonvaSkatingOfficial, SkatingOfficialRole } from './KonvaSkatingOfficial';
import type { KonvaPlayer } from './KonvaPlayer';
import { get } from 'svelte/store';
import { boardState, type KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TeamPlayerPosition, SkatingOfficialPosition } from '$lib/stores/konvaBoardState';
import { CollisionSystem } from './CollisionSystem';
import defaultLineup from '$lib/data/start-flat.json';
import { boardDoc } from '$lib/doc/store';
import type { Entity } from '$lib/doc/types';
import { poseStore, type Pose } from '$lib/doc/poses';
import { toTrack, fromTrack } from '$lib/track/trackFrame';
import { TRACK_SCALE } from '$lib/constants';
import type { MeterPoint } from '$lib/trackMath';
import { migrateBoardState } from '$lib/doc/migrate';

export class KonvaPlayerManager {
	private layer: Konva.Layer;
	private collisionSystem: CollisionSystem;

	private teamPlayers: KonvaTeamPlayer[] = [];
	private skatingOfficials: KonvaSkatingOfficial[] = [];
	private docUnsubscribe: (() => void) | null = null;

	constructor(layer: Konva.Layer) {
		this.layer = layer;
		this.collisionSystem = new CollisionSystem(layer);
		this.subscribeToDocument();
	}

	/**
	 * Subscribe to document changes to keep Konva nodes in sync.
	 * This fires on committed edits only (undo/redo, migration, gesture
	 * commits) — never mid-gesture, since a gesture doesn't touch the
	 * document until `poseStore.commitGesture` runs on dragend. There is
	 * therefore no need for an `isDragging` guard here: during a drag the
	 * document simply doesn't change, so this subscriber has nothing to do.
	 */
	private subscribeToDocument(): void {
		if (this.docUnsubscribe) {
			this.docUnsubscribe();
		}
		this.docUnsubscribe = boardDoc.subscribe((doc) => {
			this.reconcileToEntities(doc.entities);
		});
	}

	private center(): { x: number; y: number } {
		const stage = this.layer.getStage()!;
		return { x: stage.width() / 2, y: stage.height() / 2 };
	}

	/** Projects a track-space pose to absolute stage pixels. */
	private projectPose(pose: Pose): { x: number; y: number } {
		const center = this.center();
		const meterPos = fromTrack(pose.S, pose.u);
		return { x: center.x + meterPos.x * TRACK_SCALE, y: center.y + meterPos.y * TRACK_SCALE };
	}

	/**
	 * Reconciles Konva nodes to a set of entities, correlating by id: create
	 * missing nodes, reposition/recreate existing ones (via `poseStore`, so a
	 * live gesture's poses are respected rather than overwritten), and remove
	 * nodes for entities no longer present. This is the single rendering path
	 * used both for full loads and for incremental document updates.
	 */
	private reconcileToEntities(entities: Entity[]): void {
		const entityIds = new Set(entities.map((e) => e.id));

		this.teamPlayers = this.teamPlayers.filter((p) => {
			if (!entityIds.has(p.id)) {
				p.destroy();
				return false;
			}
			return true;
		});
		this.skatingOfficials = this.skatingOfficials.filter((p) => {
			if (!entityIds.has(p.id)) {
				p.destroy();
				return false;
			}
			return true;
		});

		for (const entity of entities) {
			const pose = poseStore.effective(entity.id) ?? entity;
			const { x, y } = this.projectPose(pose);

			if (entity.kind === 'skater') {
				const existing = this.findTeamPlayerById(entity.id);
				if (existing) {
					if (existing.role !== entity.role || existing.team !== entity.team) {
						const idx = this.teamPlayers.indexOf(existing);
						existing.destroy();
						this.teamPlayers[idx] = new KonvaTeamPlayer(
							x,
							y,
							this.layer,
							entity.team as TeamPlayerTeam,
							entity.role as TeamPlayerRole,
							entity.id
						);
					} else {
						existing.setPosition({ x, y });
					}
				} else {
					this.addTeamPlayer(
						x,
						y,
						entity.team as TeamPlayerTeam,
						entity.role as TeamPlayerRole,
						entity.id
					);
				}
			} else {
				const existing = this.findOfficialById(entity.id);
				if (existing) {
					if (existing.role !== entity.role) {
						const idx = this.skatingOfficials.indexOf(existing);
						existing.destroy();
						this.skatingOfficials[idx] = new KonvaSkatingOfficial(
							x,
							y,
							this.layer,
							entity.role as SkatingOfficialRole,
							entity.id
						);
					} else {
						existing.setPosition({ x, y });
					}
				} else {
					this.addSkatingOfficial(x, y, entity.role as SkatingOfficialRole, entity.id);
				}
			}
		}

		this.layer.batchDraw();
	}

	destroy(): void {
		if (this.docUnsubscribe) {
			this.docUnsubscribe();
			this.docUnsubscribe = null;
		}
		this.clear();
	}

	/**
	 * Destroys every node this manager owns and empties its tracking arrays,
	 * but keeps the document subscription alive. Use this on board
	 * rebuilds/resets/loads so a single long-lived instance (with one
	 * subscription) survives for the whole game — instead of allocating a new
	 * manager per rebuild and leaking the previous one's subscription. This is
	 * the ONLY place player nodes are destroyed; `layer.destroyChildren()` must
	 * NOT be used on the players layer, since it would orphan the wrapper
	 * objects the manager still tracks.
	 */
	clear(): void {
		this.teamPlayers.forEach((p) => p.destroy());
		this.skatingOfficials.forEach((p) => p.destroy());
		this.teamPlayers = [];
		this.skatingOfficials = [];
		this.layer.batchDraw();
	}

	/**
	 * Mirrors one Konva node's current pixel position into the pose store's
	 * live tier (track-space), preserving its existing heading. Called for
	 * every entity actually moved during a gesture — the dragged node and any
	 * collision-nudged neighbours — so `poseStore.effective*` stays a true
	 * reflection of what is on screen without touching the document.
	 */
	private captureLivePose(player: KonvaPlayer & { id: string }): void {
		const center = this.center();
		const pos = player.getPosition();
		// Reject non-finite positions: a destroyed/NaN node would otherwise
		// poison the pose store (and, on commit, the document) with NaN,
		// which survives into persisted state and bricks the board on reload.
		if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
		const meterPos: MeterPoint = {
			x: (pos.x - center.x) / TRACK_SCALE,
			y: (pos.y - center.y) / TRACK_SCALE
		};
		const { s, u } = toTrack(meterPos);
		if (!Number.isFinite(s) || !Number.isFinite(u)) return;
		poseStore.setLive(player.id, { S: s, u });
	}

	private asIdentifiable(player: KonvaPlayer): (KonvaPlayer & { id: string }) | null {
		if (player instanceof KonvaTeamPlayer || player instanceof KonvaSkatingOfficial) {
			return player;
		}
		return null;
	}

	/**
	 * Delegated handler for drag start. Defensively discards any live poses
	 * left over from an interrupted previous gesture (e.g. a drag that never
	 * fired `dragend` on some touch devices) so a fresh gesture never inherits
	 * stale uncommitted state.
	 */
	handleDragStart(e: Konva.KonvaEventObject<unknown>): void {
		const target = e.target as Konva.Node;
		if (target.hasName('playerGroup')) {
			poseStore.abortGesture();
		}
	}

	/**
	 * Delegated handler for player drag/touch movement. Resolves collisions
	 * (still pixel-space, Konva-node physics — cheap and unchanged), then
	 * mirrors the dragged node and any nudged neighbours into the pose
	 * store's live tier and refreshes in-bounds status.
	 */
	handleDragMove(e: Konva.KonvaEventObject<unknown>): void {
		const target = e.target as Konva.Node;
		if (target.hasName('playerGroup')) {
			this.collisionSystem.resolveCollisions();

			const player = target.getAttr('player');
			const identifiable = this.asIdentifiable(player);
			if (identifiable) {
				this.captureLivePose(identifiable);
			}
			if (player instanceof KonvaTeamPlayer) {
				player.updateInBounds();
			}
		}
	}

	/**
	 * Delegated handler for collision events fired by CollisionSystem.
	 * Mirrors both colliding nodes' post-collision positions into the pose
	 * store's live tier (the neighbour was moved too, and must not be lost
	 * when the gesture commits) and refreshes in-bounds status.
	 */
	handleCollision(e: Konva.KonvaEventObject<unknown>): void {
		const evt = e as Konva.KonvaEventObject<unknown> & { otherPlayer?: KonvaPlayer };
		const target = e.target as Konva.Node;
		const player = target.getAttr('player');
		const otherPlayer = evt.otherPlayer;

		const identifiablePlayer = this.asIdentifiable(player);
		if (identifiablePlayer) this.captureLivePose(identifiablePlayer);
		const identifiableOther = otherPlayer ? this.asIdentifiable(otherPlayer) : null;
		if (identifiableOther) this.captureLivePose(identifiableOther);

		if (player instanceof KonvaTeamPlayer) {
			player.updateInBounds();
		}
		if (otherPlayer instanceof KonvaTeamPlayer) {
			otherPlayer.updateInBounds();
		}
	}

	addTeamPlayer(x: number, y: number, team: TeamPlayerTeam, role: TeamPlayerRole, id?: string) {
		const player = new KonvaTeamPlayer(x, y, this.layer, team, role, id);
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
		const doc = get(boardDoc);

		if (doc.entities.length > 0) {
			this.renderFromDocument();
		} else {
			this.loadDefaultLineup();
		}
	}

	/**
	 * Renders entities from the document to Konva nodes. Called on
	 * initialization and lineup loads; delegates to the same reconcile path
	 * used for incremental document updates.
	 */
	renderFromDocument(): void {
		this.reconcileToEntities(get(boardDoc).entities);
	}

	/**
	 * Handles dragend: commits every pose touched during the gesture (the
	 * dragged entity and any collision-nudged neighbours) to the document in
	 * a single edit. Captures the dragged entity's final position first,
	 * since Konva can report one more position update on dragend than the
	 * last dragmove.
	 */
	handleDragEnd(player: KonvaTeamPlayer | KonvaSkatingOfficial): void {
		this.captureLivePose(player);
		poseStore.commitGesture(`Move ${poseStore.touchedIds().length} player(s)`);
	}

	loadDefaultLineup() {
		// Assign deterministic ids to the predefined lineup so a reset is an
		// idempotent, id-stable operation: the same default player keeps the
		// same id across resets, so reconcile updates nodes in place instead of
		// minting fresh UUIDs (and a leaked/orphaned subscription matching on
		// id would hit existing nodes rather than create duplicates).
		const teamPlayers = defaultLineup.teamPlayers.map((player, i) => ({
			...player,
			id: `default-team-${player.team}-${player.role}-${i}`,
			role: player.role as TeamPlayerRole,
			team: player.team as TeamPlayerTeam
		}));
		const skatingOfficials = defaultLineup.skatingOfficials.map((official, i) => ({
			...official,
			id: `default-official-${official.role}-${i}`,
			role: official.role as SkatingOfficialRole
		}));

		// Type conversion for the predefined lineup
		const typedLineup: KonvaBoardState = {
			...defaultLineup,
			teamPlayers,
			skatingOfficials
		};

		// Update the store with the predefined lineup
		boardState.set(typedLineup);

		// Migrate to document
		const doc = migrateBoardState(typedLineup);
		boardDoc.set(doc);

		// Load the players from the document
		this.renderFromDocument();
	}
}
