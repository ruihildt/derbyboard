export class Player {
	x: number;
	y: number;

	innerPoint: { x: number; y: number };
	outerPoint: { x: number; y: number };
	team: string;
	role: string;
	color: string;
	radius: number;
	speed: number;
	zone: number;
	direction: number;
	inBounds: boolean;
	isInPack: boolean;
	isRearmost: boolean;
	isForemost: boolean;
	isInEngagementZone: boolean;
	isDragging: boolean;
	dragOffsetX: number;
	dragOffsetY: number;

	constructor(x: number, y: number, team: string, role: string, radius: number) {
		this.x = x;
		this.y = y;
		this.innerPoint = { x, y };
		this.outerPoint = { x, y };

		this.team = team;
		this.role = role;
		this.color = team === 'A' ? 'rebeccapurple' : 'yellow';
		this.radius = radius;
		this.speed = 0;
		this.zone = 0;
		this.direction = 0;
		this.inBounds = false;
		this.isInPack = false;
		this.isRearmost = false;
		this.isForemost = false;
		this.isInEngagementZone = false;
		this.isDragging = false;
		this.dragOffsetX = 0;
		this.dragOffsetY = 0;
	}

	containsPoint(x: number, y: number): boolean {
		const dx = this.x - x;
		const dy = this.y - y;
		return dx * dx + dy * dy <= this.radius * this.radius;
	}

	update(): void {
		// Update player position based on speed and direction
		this.x += Math.cos(this.direction) * this.speed;
		this.y += Math.sin(this.direction) * this.speed;
	}
}
