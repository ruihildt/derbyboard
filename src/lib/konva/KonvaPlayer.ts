import Konva from 'konva';
import { type Point } from './KonvaTrackGeometry';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH, colors } from '$lib/constants';

/** Hit-area enlargement over the visible circle, for thumb-viable touches. */
const HIT_SCALE = 1.6;

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
	protected baseCircle: Konva.Circle;
	protected facingGroup: Konva.Group;
	/** The facing-indicator path (a short brace hugging the rim). */
	protected chevronPath: Konva.Path;
	/** Selection halo — same red as the rotation knob (direction control). */
	private selectionRing: Konva.Circle;

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

		// Selection halo (drawn first/behind so it frames the circle). Rendered
		// as small dots (round caps on near-zero dashes), same red as the rotation
		// knob so the selected skater is unmistakable without obscuring status.
		this.selectionRing = new Konva.Circle({
			x: 0,
			y: 0,
			radius: PLAYER_RADIUS + 7,
			stroke: colors.outOfBounds,
			strokeWidth: 1,
			lineCap: 'round',
			dash: [0.1, 3.5],
			fillEnabled: false,
			listening: false,
			visible: false,
			name: 'selectionRing',
			perfectDrawEnabled: false
		});
		this.group.add(this.selectionRing);

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

		// Facing indicator (P4): a rotatable sub-group holding a short brace that
		// hugs the player's rim. It represents where the skater is LOOKING
		// (independent of motion). The brace points along +x at rotation 0, which
		// matches the atan2 convention; the whole group rotates to the heading.
		this.facingGroup = new Konva.Group({
			rotation: 0,
			listening: false,
			name: 'facingGroup'
		});
		this.group.add(this.facingGroup);

		this.chevronPath = this.buildChevron();
		this.facingGroup.add(this.chevronPath);

		// Touch-viable grab area (P3 task 12): a larger, effectively-invisible
		// circle whose only purpose is hit detection, so fingers reliably grab
		// entities on a phone. It resolves to the same draggable group, and the
		// near-zero alpha keeps it visually imperceptible while remaining
		// hittable in Konva's hit graph (a fully transparent/null fill would
		// NOT be hittable in the interior).
		this.group.add(
			new Konva.Circle({
				x: 0,
				y: 0,
				radius: PLAYER_RADIUS * HIT_SCALE,
				fill: 'rgba(0,0,0,0.005)',
				listening: true,
				name: 'hitArea',
				perfectDrawEnabled: false
			})
		);

		layer.add(this.group);
		layer.batchDraw();
	}

	/**
	 * Builds the facing indicator: a short typographical-brace shape that bends
	 * along the player's rim. Two arcs hugging the circle meet at a small
	 * outward point, giving a low-profile directional marker (much shorter and
	 * less pointy than a triangle). Transparent fill, thin stroke coloured to
	 * match the outer status ring (see {@link setHeadingColor}).
	 */
	private buildChevron(): Konva.Path {
		const r = PLAYER_RADIUS;
		const R = r + 1.5; // radius the brace hugs (just outside the rim)
		const th = 0.6; // half-arc angle (rad) → ~69° span, short and low
		const tip = r + 5; // outward meeting point of the two brace curls

		const px = R * Math.cos(th);
		const py = R * Math.sin(th);
		// Two arcs (upper → tip → lower), sweep 1 = clockwise in screen space.
		const data = `M ${px} ${-py} A ${R} ${R} 0 0 1 ${tip} 0 A ${R} ${R} 0 0 1 ${px} ${py}`;

		return new Konva.Path({
			data,
			fillEnabled: false,
			stroke: colors.playerDefault,
			strokeWidth: 1.5,
			lineCap: 'round',
			lineJoin: 'round',
			listening: false,
			perfectDrawEnabled: false
		});
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
		return this.baseCircle;
	}

	/**
	 * Returns the Konva group node representing this player
	 */
	getNode(): Konva.Group {
		return this.group;
	}

	/**
	 * Sets the heading (facing/looking direction) in radians.
	 * Converts to degrees for Konva rotation (Konva uses degrees, clockwise-positive).
	 */
	setHeading(rad: number): void {
		const degrees = (rad * 180) / Math.PI;
		this.facingGroup.rotation(degrees);
	}

	/**
	 * Sets the heading indicator visibility.
	 */
	setHeadingVisible(visible: boolean): void {
		this.facingGroup.visible(visible);
	}

	/**
	 * Sets the facing indicator's stroke colour. Mirrors the outer status ring
	 * (pack / out-of-bounds / etc.) so the marker reads as part of the player.
	 */
	setHeadingColor(color: string): void {
		this.chevronPath.stroke(color);
	}

	/**
	 * Shows or hides the red selection halo.
	 */
	setSelected(selected: boolean): void {
		this.selectionRing.visible(selected);
	}

	/**
	 * Removes the player from the layer and cleans up resources
	 */
	destroy() {
		if (this.group) {
			this.group.off();
			this.group.destroy();
		}
	}
}
