import Konva from 'konva';
import { type Point } from './KonvaTrackGeometry';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH } from '$lib/constants';

declare module 'konva/lib/Node' {
	interface Node {
		player: KonvaPlayer;
	}
}

interface PlayerGroupConfig {
	x: number;
	y: number;
	draggable: boolean;
	name?: string;
}

interface PlayerCircleConfig {
	x: number;
	y: number;
	radius: number;
	strokeWidth: number;
	listening: boolean;
	name: string;
}

/**
 * Represents a player on the derby track using Konva
 * Handles player movement, collisions and basic visual representation
 */
export class KonvaPlayer {
	group: Konva.Group;
	protected baseCircle: Konva.Circle | null;

	/**
	 * Creates a new player instance
	 * @param x - Initial x position
	 * @param y - Initial y position
	 * @param layer - Konva layer to add the player to
	 * @param trackGeometry - Track geometry for bounds checking
	 */
	constructor(x: number, y: number, layer: Konva.Layer) {
		const groupConfig: PlayerGroupConfig = {
			x,
			y,
			draggable: true,
			name: 'playerGroup'
		};

		this.group = new Konva.Group(groupConfig);
		this.group.setAttr('player', this);

		const circleConfig: PlayerCircleConfig = {
			x: 0,
			y: 0,
			radius: PLAYER_RADIUS,
			strokeWidth: PLAYER_STROKE_WIDTH,
			listening: true,
			name: 'baseCircle'
		};

		this.baseCircle = new Konva.Circle(circleConfig);
		this.group.add(this.baseCircle);

		layer.add(this.group);
		layer.batchDraw();
	}

	/**
	 * Gets the current position of the player
	 */
	getPosition(): Point {
		return {
			x: this.group.x(),
			y: this.group.y()
		};
	}

	/**
	 * Sets the player's position
	 */
	setPosition(position: Point): void {
		this.group.position(position);
	}

	/**
	 * Calculates distance to another player
	 */
	distanceTo(other: KonvaPlayer): number {
		const currentPos = this.getPosition();
		const otherPos = other.getPosition();
		const dx = currentPos.x - otherPos.x;
		const dy = currentPos.y - otherPos.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	/**
	 * Returns the base circle shape representing the player
	 * Used by child classes to access and modify the player's visual representation
	 */
	protected getBaseCircle(): Konva.Circle {
		return this.baseCircle as Konva.Circle;
	}

	/**
	 * Returns the Konva group node representing this player
	 */
	getNode(): Konva.Group {
		return this.group;
	}

	/**
	 * Removes the player from the layer and cleans up resources
	 */
	destroy() {
		if (this.group) {
			this.group.off();
			this.group.destroy();
		}
		this.baseCircle = null;
	}
}
