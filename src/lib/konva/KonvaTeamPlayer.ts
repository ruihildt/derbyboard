import Konva from 'konva';
import { colors, LINE_WIDTH } from '$lib/constants';
import { KonvaPlayer } from './KonvaPlayer';
import type { KonvaTrackGeometry } from './KonvaTrackGeometry';

export enum TeamPlayerRole {
	jammer = 'jammer',
	blocker = 'blocker',
	pivot = 'pivot'
}

export enum TeamPlayerTeam {
	A = 'A',
	B = 'B'
}

export type TeamPlayerPosition = {
	absolute: { x: number; y: number };
	role: TeamPlayerRole;
	team: TeamPlayerTeam;
};

/**
 * Represents a team player on the derby track with specific role and team affiliation
 * Handles team-specific visual elements and status updates
 */
export class KonvaTeamPlayer extends KonvaPlayer {
	public starShape?: Konva.Star;
	public pivotStripeGroup?: Konva.Group;
	team: TeamPlayerTeam;
	role: TeamPlayerRole;
	zone: number;
	isInBounds: boolean;
	isInEngagementZone: boolean;
	isInPack: boolean;
	isRearmost: boolean;
	isForemost: boolean;

	/**
	 * Returns the base circle shape representing the player
	 * Used by child classes to access and modify the player's visual representation
	 */
	protected get circle(): Konva.Circle {
		return this.baseCircle as Konva.Circle;
	}

	constructor(
		x: number,
		y: number,
		layer: Konva.Layer,
		team: TeamPlayerTeam,
		role: TeamPlayerRole,
		trackGeometry: KonvaTrackGeometry
	) {
		super(x, y, layer);

		this.team = team;
		this.role = role;
		this.zone = 0;
		this.isInBounds = false;
		this.isInPack = false;
		this.isRearmost = false;
		this.isForemost = false;
		this.isInEngagementZone = false;

		const circle = this.circle;
		circle.fill(team === TeamPlayerTeam.A ? colors.teamAPrimary : colors.teamBPrimary);
		circle.stroke(colors.outOfBounds);

		this.setupVisualElements();
		this.updateInBounds(trackGeometry);
	}

	/**
	 * Sets up role-specific visual elements (star for jammer, stripe for pivot)
	 */
	private setupVisualElements(): void {
		if (this.role === TeamPlayerRole.jammer) {
			this.setupJammerStar();
		}
		if (this.role === TeamPlayerRole.pivot) {
			this.setupPivotStripe();
		}
	}

	/**
	 * Creates and configures the jammer star
	 */
	private setupJammerStar(): void {
		this.starShape = new Konva.Star({
			x: 0,
			y: 0,
			numPoints: 5,
			innerRadius: this.circle.radius() * 0.33,
			outerRadius: this.circle.radius() * 0.9,
			fill: this.team === TeamPlayerTeam.A ? colors.teamASecondary : colors.teamBSecondary,
			listening: false
		});
		this.group.add(this.starShape);
	}

	/**
	 * Creates and configures the pivot stripe
	 */
	private setupPivotStripe(): void {
		this.pivotStripeGroup = new Konva.Group({
			clipFunc: (ctx) => {
				ctx.beginPath();
				ctx.arc(0, 0, this.circle.radius() * 0.890027, 0, Math.PI * 2);
				ctx.closePath();
			}
		});

		const stripeWidth = this.circle.radius() * 1.8;
		const stripeHeight = this.circle.radius() * 0.47;
		const stripe = new Konva.Rect({
			x: -stripeWidth / 2,
			y: -stripeHeight / 2,
			width: stripeWidth,
			height: stripeHeight,
			fill: this.team === TeamPlayerTeam.A ? colors.teamASecondary : colors.teamBSecondary,
			listening: false
		});

		this.pivotStripeGroup.add(stripe);
		this.group.add(this.pivotStripeGroup);
	}

	/**
	 * Updates the player's in-bounds status and visual appearance
	 */

	public updateInBounds(trackGeometry: KonvaTrackGeometry): void {
		const circle = this.circle;
		if (!circle) return;

		const pos = this.getPosition();
		const radius = circle.radius();
		const strokeWidth = circle.strokeWidth();
		const checkRadius = radius + strokeWidth - LINE_WIDTH * 0.9;

		try {
			for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
				const checkX = pos.x + checkRadius * Math.cos(angle);
				const checkY = pos.y + checkRadius * Math.sin(angle);

				const zoneKey = trackGeometry.determineZone({ x: checkX, y: checkY });
				if (zoneKey === 0) {
					this.isInBounds = false;
					this.circle.stroke(colors.outOfBounds);
					return;
				}
			}

			this.isInBounds = true;
			this.circle.stroke(colors.inBounds);
		} catch (error) {
			console.error('Error checking bounds:', error);
			this.isInBounds = false;
			this.circle.stroke(colors.outOfBounds);
		}
	}

	/**
	 * Updates the player's engagement zone status and visual appearance
	 */
	public updateEngagementZoneStatus(isInEngagementZone: boolean): void {
		this.isInEngagementZone = isInEngagementZone;

		if (this.isInBounds) {
			if (this.isInPack) {
				this.circle.stroke(colors.inPack);
			} else if (isInEngagementZone) {
				this.circle.stroke(colors.inEngagementZone);
			} else {
				this.circle.stroke(colors.playerDefault);
			}
		} else {
			this.circle.stroke(colors.outOfBounds);
		}
	}

	/**
	 * Removes the player from the layer and cleans up resources
	 * Ensures proper cleanup of all shapes and event listeners
	 */
	destroy(): void {
		// Clear references to shapes
		this.starShape = undefined;
		this.pivotStripeGroup = undefined;

		// Call parent destroy to handle base cleanup
		super.destroy();
	}
}
