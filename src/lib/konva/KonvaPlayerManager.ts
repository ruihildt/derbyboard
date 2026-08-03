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
import { resolveHeading } from '$lib/track/heading';
import { boardSettings } from '$lib/stores/boardSettings';
import { TRACK_SCALE } from '$lib/constants';
import { migrateBoardState } from '$lib/doc/migrate';

export class KonvaPlayerManager {
	private layer: Konva.Layer;
	private collisionSystem: CollisionSystem;

	private teamPlayers: KonvaTeamPlayer[] = [];
	private skatingOfficials: KonvaSkatingOfficial[] = [];
	/** Cached blocker/pivot subset (invalidated on every roster mutation). */
	private blockersCache: KonvaTeamPlayer[] | null = null;
	private docUnsubscribe: (() => void) | null = null;
	/** Whether the facing marker (brace) is drawn. Driven by board settings. */
	private headingVisible = true;
	/** Currently selected entity id (drives the red selection halo). */
	private selectedId: string | null = null;

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

	/** Projects a planar pose to absolute stage pixels. */
	private projectPose(pose: Pose): { x: number; y: number } {
		const center = this.center();
		return { x: center.x + pose.x * TRACK_SCALE, y: center.y + pose.y * TRACK_SCALE };
	}

	/**
	 * Reconciles Konva nodes to a set of entities, correlating by id: create
	 * missing nodes, reposition/recreate existing ones (via `poseStore`, so a
	 * live gesture's poses are respected rather than overwritten), and remove
	 * nodes for entities no longer present. This is the single rendering path
	 * used both for full loads and for incremental document updates.
	 */
	private reconcileToEntities(entities: Entity[]): void {
		this.blockersCache = null;
		const entityIds = new Set(entities.map((e) => e.id));
		const autoFace = get(boardSettings).autoFace ?? true;

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
			const live = poseStore.effective(entity.id);
			const pose = live ?? { x: entity.x, y: entity.y, heading: entity.heading };
			const { x, y } = this.projectPose(pose);
			// Resolve facing: manual override (or autoFace off) ⇒ stored heading;
			// otherwise the track tangent at this position = the skater's looking
			// direction. Independent of motion, so it never snaps mid-move.
			const heading = resolveHeading(
				{
					id: entity.id,
					...pose,
					manualHeading: entity.manualHeading,
					headingMode: entity.headingMode,
					headingDelta: entity.headingDelta,
					lookAt: entity.lookAt
				},
				autoFace
			);

			if (entity.kind === 'skater') {
				const existing = this.findTeamPlayerById(entity.id);
				if (existing) {
					if (existing.role !== entity.role || existing.team !== entity.team) {
						const idx = this.teamPlayers.indexOf(existing);
						existing.destroy();
						const created = new KonvaTeamPlayer(
							x,
							y,
							this.layer,
							entity.team as TeamPlayerTeam,
							entity.role as TeamPlayerRole,
							entity.id
						);
						created.setHeading(heading);
						created.setHeadingVisible(this.headingVisible);
						this.teamPlayers[idx] = created;
					} else {
						existing.setPosition({ x, y });
						existing.setHeading(heading);
					}
				} else {
					const created = this.addTeamPlayer(
						x,
						y,
						entity.team as TeamPlayerTeam,
						entity.role as TeamPlayerRole,
						entity.id
					);
					created.setHeading(heading);
					created.setHeadingVisible(this.headingVisible);
				}
			} else {
				const existing = this.findOfficialById(entity.id);
				if (existing) {
					if (existing.role !== entity.role) {
						const idx = this.skatingOfficials.indexOf(existing);
						existing.destroy();
						const created = new KonvaSkatingOfficial(
							x,
							y,
							this.layer,
							entity.role as SkatingOfficialRole,
							entity.id
						);
						created.setHeading(heading);
						created.setHeadingVisible(this.headingVisible);
						this.skatingOfficials[idx] = created;
					} else {
						existing.setPosition({ x, y });
						existing.setHeading(heading);
					}
				} else {
					const created = this.addSkatingOfficial(
						x,
						y,
						entity.role as SkatingOfficialRole,
						entity.id
					);
					created.setHeading(heading);
					created.setHeadingVisible(this.headingVisible);
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
		this.blockersCache = null;
		this.layer.batchDraw();
	}

	/**
	 * Mirrors one Konva node's current pixel position into the pose store's
	 * live tier (planar world metres), preserving its existing heading. Called
	 * for every entity actually moved during a gesture — the dragged node and
	 * any collision-nudged neighbours — so `poseStore.effective*` stays a true
	 * reflection of what is on screen without touching the document.
	 *
	 * The canonical coordinate system is planar, so this is a direct pixel →
	 * metre conversion. There is no lap index to preserve: a full lap maps to
	 * the same world point, so the position is fully captured by `(x, y)`.
	 */
	private captureLivePose(player: KonvaPlayer & { id: string }): void {
		const center = this.center();
		const pos = player.getPosition();
		// Reject non-finite positions: a destroyed/NaN node would otherwise
		// poison the pose store (and, on commit, the document) with NaN,
		// which survives into persisted state and bricks the board on reload.
		if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
		const x = (pos.x - center.x) / TRACK_SCALE;
		const y = (pos.y - center.y) / TRACK_SCALE;
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;

		poseStore.setLive(player.id, { x, y });
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
	handleDragMove(e: Konva.KonvaEventObject<unknown>): number | null {
		const target = e.target as Konva.Node;
		if (!target.hasName('playerGroup')) return null;
		this.collisionSystem.resolveCollisions(this.teamPlayers, this.skatingOfficials);

		const player = target.getAttr('player');
		const identifiable = this.asIdentifiable(player);
		let heading: number | null = null;
		if (identifiable) {
			this.captureLivePose(identifiable);
			// Keep the facing marker aimed along the (new) track tangent while
			// the skater is dragged, so it always points at the direction
			// control which orbits along the heading.
			heading = this.refreshHeadingFor(identifiable.id);
		}
		if (player instanceof KonvaTeamPlayer) {
			player.updateInBounds();
		}
		// The resolved heading is returned so the caller (the rotation handle)
		// doesn't resolve the SAME heading a second time for this event.
		return heading;
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
		this.blockersCache = null;
		return player;
	}

	addSkatingOfficial(x: number, y: number, role: SkatingOfficialRole, id?: string) {
		const official = new KonvaSkatingOfficial(x, y, this.layer, role, id);
		this.skatingOfficials.push(official);
		return official;
	}

	getBlockers() {
		// Cached: determinePack calls this every animation frame during
		// playback, and the filter allocation is pure waste while the roster
		// is unchanged.
		if (!this.blockersCache) {
			this.blockersCache = this.teamPlayers.filter(
				(player) => player.role === TeamPlayerRole.blocker || player.role === TeamPlayerRole.pivot
			);
		}
		return this.blockersCache;
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
	 * Updates a single entity's chevron to face `rad` immediately. Used by the
	 * rotation handle so the facing indicator tracks the drag in real time
	 * (the document/reconcile path does not fire mid-gesture, so without this
	 * the chevron would only jump on drag-end).
	 */
	setHeadingFor(id: string, rad: number): void {
		const player = this.findTeamPlayerById(id) ?? this.findOfficialById(id);
		if (player) {
			player.setHeading(rad);
			this.layer.batchDraw();
		}
	}

	/**
	 * Toggles the facing marker on every entity. Called when the board setting
	 * flips so existing markers appear/disappear immediately.
	 */
	setAllHeadingVisible(visible: boolean): void {
		this.headingVisible = visible;
		for (const p of this.teamPlayers) p.setHeadingVisible(visible);
		for (const p of this.skatingOfficials) p.setHeadingVisible(visible);
		this.layer.batchDraw();
	}

	/**
	 * Sets the single selected entity, showing a red halo on it and clearing the
	 * halo on everyone else. `null` clears selection.
	 */
	setSelection(id: string | null): void {
		this.selectedId = id;
		for (const p of this.teamPlayers) p.setSelected(p.id === id);
		for (const p of this.skatingOfficials) p.setSelected(p.id === id);
		// Bring the selected entity above its peers so its dotted halo and
		// facing marker read on top of overlapping players.
		if (id) {
			const sel = this.findTeamPlayerById(id) ?? this.findOfficialById(id);
			sel?.getNode().moveToTop();
		}
		this.layer.batchDraw();
	}

	getSelectedId(): string | null {
		return this.selectedId;
	}

	/**
	 * Recomputes and applies the resolved heading for one entity from its
	 * CURRENT effective pose. Used during a position drag so the facing marker
	 * tracks the track tangent live (and thereby points at the direction
	 * control, which orbits along the heading).
	 */
	refreshHeadingFor(id: string): number | null {
		const heading = this.resolvedHeadingFor(id);
		if (heading !== null) this.setHeadingFor(id, heading);
		return heading;
	}

	/**
	 * Returns the resolved (displayed) heading for one entity from its CURRENT
	 * effective pose, honouring the heading mode (auto / relative / locked).
	 * Pure read — does not mutate nodes. Used by the direction control to
	 * position the knob along the actual facing.
	 */
	resolvedHeadingFor(id: string): number | null {
		const entity = boardDoc.current.entities.find((e) => e.id === id);
		if (!entity) return null;
		const pose = poseStore.effective(id) ?? { x: entity.x, y: entity.y, heading: entity.heading };
		const autoFace = get(boardSettings).autoFace ?? true;
		return resolveHeading(
			{
				id,
				...pose,
				manualHeading: entity.manualHeading,
				headingMode: entity.headingMode,
				headingDelta: entity.headingDelta,
				lookAt: entity.lookAt
			},
			autoFace
		);
	}

	/**
	 * Repositions every node to its CURRENT effective pose (live override if
	 * present, else committed) and refreshes in-bounds status. This is the
	 * authored-playback render path: the player sets all entity poses into the
	 * PoseStore live tier each frame, then calls this to move the nodes to
	 * match — so pack/in-bounds/snapshot all read the tweened positions through
	 * the single `poseStore.effective` accessor, exactly as they do mid-drag.
	 * Roster is assumed stable (a clip is one lineup evolving); missing nodes
	 * are skipped rather than created.
	 */
	applyEffectivePoses(draw = true): void {
		// Hoist the stage read: projectPose→center() does getStage() + two
		// dimension reads — per entity per frame without this.
		const center = this.center();
		for (const p of this.teamPlayers) {
			const pose = poseStore.effective(p.id);
			if (pose) {
				p.setPosition({
					x: center.x + pose.x * TRACK_SCALE,
					y: center.y + pose.y * TRACK_SCALE
				});
				p.setHeading(pose.heading);
			}
			p.updateInBounds(center);
		}
		for (const p of this.skatingOfficials) {
			const pose = poseStore.effective(p.id);
			if (pose) {
				p.setPosition({
					x: center.x + pose.x * TRACK_SCALE,
					y: center.y + pose.y * TRACK_SCALE
				});
				p.setHeading(pose.heading);
			}
		}
		// Composite frame paths (applyAuthoredPoses/applySampleOverrides) pass
		// draw=false and draw the layer once at the end of the frame.
		if (draw) this.layer.batchDraw();
	}

	/**
	 * Focus/dim (P3 task 9): dims every entity not in `focusIds` to make the
	 * selected one or two stand out. Pass `null` to clear (all fully opaque).
	 * Applied as group opacity so all role markings dim together.
	 */
	setFocus(focusIds: string[] | null): void {
		const focus = focusIds && focusIds.length > 0 ? new Set(focusIds) : null;
		for (const p of this.teamPlayers) {
			p.getNode().opacity(focus ? (focus.has(p.id) ? 1 : 0.3) : 1);
		}
		for (const p of this.skatingOfficials) {
			p.getNode().opacity(focus ? (focus.has(p.id) ? 1 : 0.3) : 1);
		}
		this.layer.batchDraw();
	}

	/**
	 * Reconciles team players to match a set of positions, correlating by id:
	 * remove players no longer present, add new ones, and update/replace the rest.
	 */
	reconcileTeamPlayers(positions: TeamPlayerPosition[], centerX: number, centerY: number): void {
		this.blockersCache = null;
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
