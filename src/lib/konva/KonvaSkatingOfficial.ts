import Konva from 'konva';

import { colors } from '$lib/constants';
import { KonvaPlayer } from './KonvaPlayer';

export enum SkatingOfficialRole {
	jamRefA = 'jamRefA',
	jamRefB = 'jamRefB',
	backPackRef = 'backPackRef',
	frontPackRef = 'frontPackRef',
	outsidePackRef = 'outsidePackRef',
	alternate = 'alternate'
}

export class KonvaSkatingOfficial extends KonvaPlayer {
	role: SkatingOfficialRole;

	/**
	 * Returns the base circle shape representing the player
	 * Used by child classes to access and modify the player's visual representation
	 */
	protected get circle(): Konva.Circle {
		return this.baseCircle;
	}

	constructor(x: number, y: number, layer: Konva.Layer, role: SkatingOfficialRole) {
		super(x, y, layer);
		this.role = role;

		const circle = this.circle;
		circle.setAttrs({
			fill: colors.officialPrimary,
			stroke: colors.officialSecondary
		});

		// Add referee stripes for visual distinction
		this.setupStripes();

		// Add star for jam refs
		if (role === SkatingOfficialRole.jamRefA || role === SkatingOfficialRole.jamRefB) {
			this.setupJamRefStar();
		}
	}

	/**
	 * Creates and configures the striped pattern for officials
	 */
	private setupStripes(): void {
		// Create clipping group for stripes
		const stripesGroup = new Konva.Group({
			clipFunc: (ctx) => {
				ctx.beginPath();
				ctx.arc(0, 0, this.circle.radius() * 0.9, 0, Math.PI * 2);
				ctx.closePath();
			}
		});

		// Add vertical stripes
		const stripeCount = 7;
		const stripeWidth = (this.circle.radius() * 2) / stripeCount;

		for (let i = 0; i < stripeCount; i += 2) {
			const stripe = new Konva.Rect({
				x: -this.circle.radius() + i * stripeWidth,
				y: -this.circle.radius(),
				width: stripeWidth,
				height: this.circle.radius() * 2,
				fill: colors.officialSecondary,
				listening: false
			});
			stripesGroup.add(stripe);
		}

		this.group.add(stripesGroup);
	}

	/**
	 * Creates and configures the jam ref star
	 */
	private setupJamRefStar(): void {
		const star = new Konva.Star({
			x: 0,
			y: 0,
			numPoints: 5,
			innerRadius: this.circle.radius() * 0.35,
			outerRadius: this.circle.radius() * 0.9,
			fill: this.role === SkatingOfficialRole.jamRefA ? colors.teamAPrimary : colors.teamBPrimary,
			stroke: colors.officialSecondary,
			strokeWidth: 1.3,
			listening: false
		});
		this.group.add(star);
	}
}
