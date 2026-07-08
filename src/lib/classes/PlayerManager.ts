import { get } from 'svelte/store';
import { panMode } from '$lib/stores/panMode';

import { PlayerTeam, TeamPlayer, TeamPlayerRole } from '$lib/classes/TeamPlayer';
import { PackManager } from '$lib/classes/PackManager';
import { Renderer } from '$lib/render/Renderer';
import type { Point } from '$lib/types';
import { TrackGeometry } from './TrackGeometry';
import { Player } from './Player';
import { SkatingOfficial, SkatingOfficialRole } from './SkatingOfficial';
import { boardState, type BoardState } from '$lib/stores/boardState';
import type { Game } from './Game';

export class PlayerManager {
	private game: Game;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	points: Record<string, Point>;
	players: TeamPlayer[];
	skatingOfficials: SkatingOfficial[];
	selectedPlayer: Player | null;
	trackGeometry: TrackGeometry;
	renderer: Renderer;
	straight1Area: Path2D;
	straight2Area: Path2D;
	turn1Area: Path2D;
	turn2Area: Path2D;
	startZone: Path2D;
	jammerStartZone: Path2D;
	packManager: PackManager;
	positions: Record<string, Point>;
	activeTouches: Map<number, { player: Player; touch: Touch }>;

	constructor(
		game: Game,
		canvas: HTMLCanvasElement,
		ctx: CanvasRenderingContext2D,
		points: Record<string, Point>,
		renderer: Renderer,
		isInitialLoad: boolean
	) {
		this.game = game;
		this.canvas = canvas;
		this.ctx = ctx;
		this.points = points;
		Player.setCanvasWidth();
		this.players = [];
		this.skatingOfficials = [];
		this.selectedPlayer = null;
		this.trackGeometry = new TrackGeometry(canvas, ctx, points);
		this.renderer = renderer;
		this.straight1Area = renderer.straight1Area;
		this.straight2Area = renderer.straight2Area;
		this.turn1Area = renderer.turn1Area;
		this.turn2Area = renderer.turn2Area;
		this.startZone = this.trackGeometry.startZone;
		this.jammerStartZone = this.trackGeometry.createJammerStartZone();

		this.packManager = new PackManager(points, this.trackGeometry);
		this.positions = {
			OPR1: { x: 0.347, y: 0.115 },
			OPR2: { x: 0.535, y: 0.11 },
			OPR3: { x: 0.61, y: 0.11 },
			FPR: { x: 0.46, y: 0.44 },
			BPR: { x: 0.616, y: 0.44 },
			JRTeamA: { x: 0.631, y: 0.359 },
			JRTeamB: { x: 0.61, y: 0.38 }
		};

		if (isInitialLoad) {
			const savedState: BoardState = get(boardState);

			if (savedState?.teamPlayers?.length > 0) {
				this.players = savedState.teamPlayers.map((p) => {
					const absoluteX = p.absolute.x * this.canvas.width;
					const absoluteY = p.absolute.y * this.canvas.height;
					const player = new TeamPlayer(absoluteX, absoluteY, p.team!, p.role);
					player.inBounds = this.trackGeometry.isPlayerInBounds(player);
					this.trackGeometry.updatePlayerZone(player);
					this.trackGeometry.updatePlayerCoordinates(player);
					return player;
				});

				this.skatingOfficials = savedState.skatingOfficials.map((o) => {
					const absoluteX = o.absolute.x * this.canvas.width;
					const absoluteY = o.absolute.y * this.canvas.height;
					return new SkatingOfficial(absoluteX, absoluteY, o.role);
				});

				this.packManager.updatePlayers(this.players);
			} else {
				this.initializeSkatingOfficials();
				this.initializeTeamPlayers();
			}
			this.packManager.updatePlayers(this.players);
		}

		this.activeTouches = new Map();
	}

	addTeamPlayer(x: number, y: number, team: string, role: TeamPlayerRole) {
		const player = new TeamPlayer(x, y, team, role);
		player.inBounds = this.trackGeometry.isPlayerInBounds(player);
		this.trackGeometry.updatePlayerZone(player);
		this.trackGeometry.updatePlayerCoordinates(player);
		this.players.push(player);
		this.packManager.updatePlayers(this.players);
	}

	initializeTeamPlayers(): void {
		// Create 4 blockers for Team A
		for (let i = 0; i < 4; i++) {
			const role = i < 3 ? TeamPlayerRole.blocker : TeamPlayerRole.pivot;
			const pos = this.getRandomBlockerPosition(role);
			this.addTeamPlayer(pos.x, pos.y, 'A', role);
		}

		// Create 4 blockers for Team B
		for (let i = 0; i < 4; i++) {
			const role = i < 3 ? TeamPlayerRole.blocker : TeamPlayerRole.pivot;
			const pos = this.getRandomBlockerPosition(role);
			this.addTeamPlayer(pos.x, pos.y, 'B', role);
		}

		// Add jammers
		const jammerPosA = this.getRandomJammerPosition();
		this.addTeamPlayer(jammerPosA.x, jammerPosA.y, 'A', TeamPlayerRole.jammer);
		const jammerPosB = this.getRandomJammerPosition();
		this.addTeamPlayer(jammerPosB.x, jammerPosB.y, 'B', TeamPlayerRole.jammer);
	}

	initializeSkatingOfficials(): void {
		const positions = {
			OPR1: {
				x: this.positions.OPR1.x * this.canvas.width,
				y: this.positions.OPR1.y * this.canvas.height
			},
			OPR2: {
				x: this.positions.OPR2.x * this.canvas.width,
				y: this.positions.OPR2.y * this.canvas.height
			},
			OPR3: {
				x: this.positions.OPR3.x * this.canvas.width,
				y: this.positions.OPR3.y * this.canvas.height
			},
			FPR: {
				x: this.positions.FPR.x * this.canvas.width,
				y: this.positions.FPR.y * this.canvas.height
			},
			BPR: {
				x: this.positions.BPR.x * this.canvas.width,
				y: this.positions.BPR.y * this.canvas.height
			},
			JRTeamA: {
				x: this.positions.JRTeamA.x * this.canvas.width,
				y: this.positions.JRTeamA.y * this.canvas.height
			},
			JRTeamB: {
				x: this.positions.JRTeamB.x * this.canvas.width,
				y: this.positions.JRTeamB.y * this.canvas.height
			}
		};

		// Add jam refs
		const jamRefTeamA = new SkatingOfficial(
			positions.JRTeamA.x,
			positions.JRTeamA.y,
			SkatingOfficialRole.jamRefA
		);

		const jamRefTeamB = new SkatingOfficial(
			positions.JRTeamB.x,
			positions.JRTeamB.y,
			SkatingOfficialRole.jamRefB
		);

		this.skatingOfficials.push(jamRefTeamA);
		this.skatingOfficials.push(jamRefTeamB);

		// Add pack refs
		this.skatingOfficials.push(
			new SkatingOfficial(positions.FPR.x, positions.FPR.y, SkatingOfficialRole.backPackRef)
		);
		this.skatingOfficials.push(
			new SkatingOfficial(positions.BPR.x, positions.BPR.y, SkatingOfficialRole.frontPackRef)
		);

		// Add outside pack refs
		this.skatingOfficials.push(
			new SkatingOfficial(positions.OPR1.x, positions.OPR1.y, SkatingOfficialRole.outsidePackRef)
		);
		this.skatingOfficials.push(
			new SkatingOfficial(positions.OPR2.x, positions.OPR2.y, SkatingOfficialRole.outsidePackRef)
		);
		this.skatingOfficials.push(
			new SkatingOfficial(positions.OPR3.x, positions.OPR3.y, SkatingOfficialRole.outsidePackRef)
		);
	}

	resetPlayers(): void {
		this.players = [];
		this.skatingOfficials = [];
		this.selectedPlayer = null;

		// Update all track zones before initializing new players
		this.straight1Area = this.renderer.straight1Area;
		this.startZone = this.trackGeometry.startZone;
		this.jammerStartZone = this.trackGeometry.createJammerStartZone();

		this.initializeSkatingOfficials();
		this.initializeTeamPlayers();
	}

	loadFromState(state: BoardState): void {
		// Clear existing players
		this.players = [];
		this.skatingOfficials = [];

		// Create new players from state
		state.teamPlayers.forEach((teamPlayer) => {
			const x = teamPlayer.absolute.x * this.canvas.width;
			const y = teamPlayer.absolute.y * this.canvas.height;
			const player = new TeamPlayer(
				x,
				y,
				teamPlayer.team as PlayerTeam,
				teamPlayer.role as TeamPlayerRole
			);
			this.trackGeometry.updatePlayerCoordinates(player);
			player.inBounds = this.trackGeometry.isPlayerInBounds(player);
			this.trackGeometry.updatePlayerZone(player);
			this.players.push(player);
		});

		// Create new skating officials from state
		state.skatingOfficials.forEach((skatingOfficial) => {
			const x = skatingOfficial.absolute.x * this.canvas.width;
			const y = skatingOfficial.absolute.y * this.canvas.height;
			const official = new SkatingOfficial(x, y, skatingOfficial.role as SkatingOfficialRole);
			this.skatingOfficials.push(official);
		});

		// Check track boundaries for each player
		this.players.forEach((player) => {
			player.inBounds = this.trackGeometry.isPlayerInBounds(player);
		});

		// Update pack status
		this.packManager.updatePlayers(this.players);
	}

	getRandomBlockerPosition(role: TeamPlayerRole): Point {
		let attempts = 0;
		const maxAttempts = 1000;

		while (attempts < maxAttempts) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;

			const pointsToCheck = [
				{ x, y }, // Center
				{ x: x + Player.playerRadius, y }, // Right
				{ x: x - Player.playerRadius, y }, // Left
				{ x, y: y + Player.playerRadius }, // Bottom
				{ x, y: y - Player.playerRadius } // Top
			];

			const allPointsValid = pointsToCheck.every(
				(point) =>
					this.ctx.isPointInPath(this.startZone, point.x, point.y) &&
					this.trackGeometry.isPlayerInBounds(new TeamPlayer(point.x, point.y, 'A', role))
			);

			const noCollisions = this.players.every(
				(player) => Math.hypot(player.x - x, player.y - y) > Player.playerRadius * 2
			);

			if (allPointsValid && noCollisions) {
				return { x, y };
			}

			attempts++;
		}

		throw new Error('Could not find a valid position for the blocker after maximum attempts');
	}

	getRandomJammerPosition(): Point {
		let attempts = 0;
		const maxAttempts = 1000;

		while (attempts < maxAttempts) {
			const x = Math.random() * this.canvas.width;
			const y = Math.random() * this.canvas.height;

			const pointsToCheck = [
				{ x, y },
				{ x: x + Player.playerRadius, y },
				{ x: x - Player.playerRadius, y },
				{ x, y: y + Player.playerRadius },
				{ x, y: y - Player.playerRadius }
			];

			const allPointsValid = pointsToCheck.every(
				(point) =>
					this.ctx.isPointInPath(this.jammerStartZone, point.x, point.y) &&
					this.trackGeometry.isPlayerInBounds(
						new TeamPlayer(point.x, point.y, 'A', TeamPlayerRole.jammer)
					)
			);

			const noCollisions = this.players.every(
				(player) => Math.hypot(player.x - x, player.y - y) > Player.playerRadius * 2
			);

			if (allPointsValid && noCollisions) {
				return { x, y };
			}

			attempts++;
		}

		throw new Error('Could not find a valid position for the jammer after maximum attempts');
	}

	checkCollision(player1: Player, player2: Player): boolean {
		const dx = player2.x - player1.x;
		const dy = player2.y - player1.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const collisionThreshold = player1.radius + player2.radius;
		return distance < collisionThreshold;
	}

	handlePush(pusher: Player, target: Player): void {
		const dx = target.x - pusher.x;
		const dy = target.y - pusher.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		const dirX = dx / distance;
		const dirY = dy / distance;

		const pushForce = 1;

		target.x = pusher.x + dirX * (pusher.radius + target.radius + pushForce);
		target.y = pusher.y + dirY * (pusher.radius + target.radius + pushForce);

		// Check for chain reactions with ALL entities
		const allEntities = [...this.players, ...this.skatingOfficials];
		allEntities.forEach((otherEntity) => {
			if (
				otherEntity !== target &&
				otherEntity !== pusher &&
				this.checkCollision(target, otherEntity)
			) {
				this.handlePush(target, otherEntity);
			}
		});

		if (target instanceof TeamPlayer) {
			target.inBounds = this.trackGeometry.isPlayerInBounds(target);
			this.trackGeometry.updatePlayerZone(target);
			this.trackGeometry.updatePlayerCoordinates(target);
		}
	}

	handleMouseMove(event: MouseEvent): void {
		const entity = this.selectedPlayer;
		if (entity?.isDragging) {
			const rect = this.canvas.getBoundingClientRect();
			const screenX = event.clientX - rect.left;
			const screenY = event.clientY - rect.top;
			const worldCoords = this.game.scalingManager.screenToWorld(screenX, screenY);

			entity.x = worldCoords.x;
			entity.y = worldCoords.y;

			const allEntities = [...this.players, ...this.skatingOfficials];
			allEntities.forEach((otherEntity) => {
				if (otherEntity !== entity && this.checkCollision(entity, otherEntity)) {
					this.handlePush(entity, otherEntity);
				}
			});

			if (entity instanceof TeamPlayer) {
				entity.inBounds = this.trackGeometry.isPlayerInBounds(entity);
				this.trackGeometry.updatePlayerZone(entity);
				this.trackGeometry.updatePlayerCoordinates(entity);
				this.packManager.updatePlayers(this.players);
			}
		}
	}

	handleMouseDown(event: MouseEvent): void {
		if (get(panMode)) return;

		const rect = this.canvas.getBoundingClientRect();
		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;
		const worldCoords = this.game.scalingManager.screenToWorld(screenX, screenY);

		const draggableEntities = [...this.players, ...this.skatingOfficials];

		for (const entity of draggableEntities) {
			const dx = worldCoords.x - entity.x;
			const dy = worldCoords.y - entity.y;
			const distance = Math.sqrt(dx * dx + dy * dy);
			if (distance < entity.radius) {
				this.selectedPlayer = entity;
				entity.isDragging = true;
				break;
			}
		}
	}

	handleMouseUp(): void {
		if (this.selectedPlayer) {
			this.selectedPlayer.isDragging = false;
			this.selectedPlayer = null;
		}
	}

	handleTouchStart(event: TouchEvent): void {
		if (get(panMode)) return;

		event.preventDefault();
		const rect = this.canvas.getBoundingClientRect();

		Array.from(event.changedTouches).forEach((touch) => {
			const screenX = touch.clientX - rect.left;
			const screenY = touch.clientY - rect.top;
			const worldCoords = this.game.scalingManager.screenToWorld(screenX, screenY);
			const x = worldCoords.x * this.canvas.width;
			const y = worldCoords.y * this.canvas.height;

			const draggableEntities = [...this.players, ...this.skatingOfficials];
			for (const entity of draggableEntities) {
				if (entity.containsPoint(x, y)) {
					entity.isDragging = true;
					this.activeTouches.set(touch.identifier, {
						player: entity,
						touch: touch
					});
					break;
				}
			}
		});
	}

	handleTouchMove(event: TouchEvent): void {
		event.preventDefault();
		const rect = this.canvas.getBoundingClientRect();

		Array.from(event.changedTouches).forEach((touch) => {
			const activeTouch = this.activeTouches.get(touch.identifier);
			if (activeTouch) {
				const entity = activeTouch.player;
				const screenX = touch.clientX - rect.left;
				const screenY = touch.clientY - rect.top;
				const worldCoords = this.game.scalingManager.screenToWorld(screenX, screenY);
				const x = worldCoords.x * this.canvas.width;
				const y = worldCoords.y * this.canvas.height;

				entity.x = Math.max(entity.radius, Math.min(this.canvas.width - entity.radius, x));
				entity.y = Math.max(entity.radius, Math.min(this.canvas.height - entity.radius, y));

				// Handle collisions and updates
				const allEntities = [...this.players, ...this.skatingOfficials];
				allEntities.forEach((otherEntity) => {
					if (otherEntity !== entity && this.checkCollision(entity, otherEntity)) {
						this.handlePush(entity, otherEntity);
					}
				});

				if (entity instanceof TeamPlayer) {
					entity.inBounds = this.trackGeometry.isPlayerInBounds(entity);
					this.trackGeometry.updatePlayerZone(entity);
					this.trackGeometry.updatePlayerCoordinates(entity);
					this.packManager.updatePlayers(this.players);
				}
			}
		});
	}

	handleTouchEnd(event: TouchEvent): void {
		Array.from(event.changedTouches).forEach((touch) => {
			const activeTouch = this.activeTouches.get(touch.identifier);
			if (activeTouch) {
				activeTouch.player.isDragging = false;
				this.activeTouches.delete(touch.identifier);
			}
		});
	}

	updatePlayers(): void {
		for (const player of this.players) {
			player.update();
		}
	}
}
