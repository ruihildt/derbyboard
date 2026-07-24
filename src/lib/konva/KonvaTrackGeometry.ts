import Konva from 'konva';
import {
	LINE_WIDTH,
	TENFEET,
	TENFEETLINE,
	TEN_FEET_LINE_WIDTH,
	THIRTYFEET,
	TURNSEGMENT,
	TWENTYFEET,
	colors
} from '../constants';

export type Point = {
	x: number;
	y: number;
};

export type Zone = {
	innerStart: Point;
	outerStart: Point;
	innerEnd: Point;
	outerEnd: Point;
};

export enum ZoneType {
	STRAIGHT = 'straight',
	TURN = 'turn'
}

type Turn = Zone & {
	type: ZoneType.TURN;
	centerInner: Point;
	centerOuter: Point;
};

type Straight = Zone & {
	type: ZoneType.STRAIGHT;
};

type ZoneKey = 1 | 2 | 3 | 4;
type TurnKey = 2 | 4;
type StraightKey = 1 | 3;

type Zones = {
	1: Straight;
	2: Turn;
	3: Straight;
	4: Turn;
};

export class KonvaTrackGeometry {
	private debugMode: boolean = false;
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;
	private points: Record<string, Point>;
	private straight1Path: Path2D;
	private straight2Path: Path2D;
	private turn1Path: Path2D;
	private turn2Path: Path2D;
	startZonePath: Path2D;

	private trackLinesGroup: Konva.Group;
	private trackZoneGroup: Konva.Group;
	private zonesGroup: Konva.Group;
	private straight1Shape: Konva.Path;
	private straight2Shape: Konva.Path;
	private turn1Shape: Konva.Path;
	private turn2Shape: Konva.Path;
	zones: Zones;

	constructor(points: Record<string, Point>) {
		this.points = points;
		this.zones = {
			1: {
				type: ZoneType.STRAIGHT,
				innerStart: { x: points.C.x, y: points.C.y },
				outerStart: { x: points.I.x, y: points.I.y },
				innerEnd: { x: points.E.x, y: points.E.y },
				outerEnd: { x: points.K.x, y: points.K.y }
			},
			2: {
				type: ZoneType.TURN,
				innerStart: { x: points.E.x, y: points.E.y },
				outerStart: { x: points.K.x, y: points.K.y },
				innerEnd: { x: points.F.x, y: points.F.y },
				outerEnd: { x: points.L.x, y: points.L.y },
				centerInner: { x: points.B.x, y: points.B.y },
				centerOuter: { x: points.H.x, y: points.H.y }
			},
			3: {
				type: ZoneType.STRAIGHT,
				innerStart: { x: points.F.x, y: points.F.y },
				outerStart: { x: points.L.x, y: points.L.y },
				innerEnd: { x: points.D.x, y: points.D.y },
				outerEnd: { x: points.J.x, y: points.J.y }
			},
			4: {
				type: ZoneType.TURN,
				innerStart: { x: points.D.x, y: points.D.y },
				outerStart: { x: points.J.x, y: points.J.y },
				innerEnd: { x: points.C.x, y: points.C.y },
				outerEnd: { x: points.I.x, y: points.I.y },
				centerInner: { x: points.A.x, y: points.A.y },
				centerOuter: { x: points.G.x, y: points.G.y }
			}
		};

		// Initialize canvas and context once
		this.canvas = document.createElement('canvas');
		this.context = this.canvas.getContext('2d')!;

		// Precompute Path2D objects
		this.straight1Path = new Path2D(this.createStraightPath(1).data());
		this.straight2Path = new Path2D(this.createStraightPath(3).data());
		this.turn1Path = new Path2D(this.createTurnPath(2).data());
		this.turn2Path = new Path2D(this.createTurnPath(4).data());
		this.startZonePath = new Path2D(this.createStartZonePath());

		this.zonesGroup = new Konva.Group();

		// Create and add zone paths
		// Needed because paths need to be on the stage to do hit detection
		this.straight1Shape = this.createStraightPath(1);
		this.straight2Shape = this.createStraightPath(3);
		this.turn1Shape = this.createTurnPath(2);
		this.turn2Shape = this.createTurnPath(4);
		this.zonesGroup.add(this.straight1Shape);
		this.zonesGroup.add(this.straight2Shape);
		this.zonesGroup.add(this.turn1Shape);
		this.zonesGroup.add(this.turn2Shape);

		this.trackLinesGroup = new Konva.Group();

		// Create all surface that can be drawn
		this.trackZoneGroup = new Konva.Group();
		const trackSurface = this.createTrackSurfacePath();
		this.trackZoneGroup.add(trackSurface);

		// Now create all track paths
		const boundaries = this.createBoundariesPath();
		const officialLane = this.createOuterOfficialLanePath();
		const pivotLine = this.createPivotLinePath();
		const jammerLine = this.createJammerLinePath();
		const straight1TenFeetLines = this.drawStraight1TenFeetLines();
		const straight2TenFeetLines = this.drawStraight2TenFeetLines();
		const turn1TenFeetLines = this.drawTurn1TenFeetLines();
		const turn2TenFeetLines = this.drawTurn2TenFeetLines();
		this.trackLinesGroup.add(boundaries);
		this.trackLinesGroup.add(officialLane);
		this.trackLinesGroup.add(pivotLine);
		this.trackLinesGroup.add(straight1TenFeetLines);
		this.trackLinesGroup.add(straight2TenFeetLines);
		this.trackLinesGroup.add(turn1TenFeetLines);
		this.trackLinesGroup.add(turn2TenFeetLines);
		this.trackLinesGroup.add(jammerLine);

		this.toggleDebugMode(false);
	}

	addTrackSurfaceToLayer(layer: Konva.Layer) {
		layer.add(this.trackZoneGroup);
	}

	addTrackLinesToLayer(layer: Konva.Layer) {
		layer.add(this.trackLinesGroup);
	}

	createStraightPath(straightKey: StraightKey): Konva.Path {
		const zone = this.zones[straightKey];
		return new Konva.Path({
			data: `
            M ${zone.innerStart.x} ${zone.innerStart.y}
            L ${zone.innerEnd.x} ${zone.innerEnd.y}
            L ${zone.outerEnd.x} ${zone.outerEnd.y}
            L ${zone.outerStart.x} ${zone.outerStart.y}
            Z
        `,
			fill: colors.trackSurface,
			listening: false,
			visible: false
		});
	}

	createTurnPath(turnKey: TurnKey): Konva.Path {
		const turn = this.zones[turnKey];
		const innerRadius = Math.hypot(
			turn.innerStart.x - turn.centerInner.x,
			turn.innerStart.y - turn.centerInner.y
		);
		const outerRadius = Math.hypot(
			turn.outerStart.x - turn.centerOuter.x,
			turn.outerStart.y - turn.centerOuter.y
		);

		return new Konva.Path({
			data: `
            M ${turn.outerStart.x} ${turn.outerStart.y}
            L ${turn.innerStart.x} ${turn.innerStart.y}
            A ${innerRadius} ${innerRadius} 0 0 0 ${turn.innerEnd.x} ${turn.innerEnd.y}
            L ${turn.outerEnd.x} ${turn.outerEnd.y}
            A ${outerRadius} ${outerRadius} 0 0 1 ${turn.outerStart.x} ${turn.outerStart.y}
            Z
        `,
			fill: colors.trackSurface,
			listening: false,
			visible: false
		});
	}

	private createOuterTrackPath(): Konva.Path {
		const zones = this.zones;
		const radius = Math.abs(zones[2].outerStart.y - zones[2].centerOuter.y);

		return new Konva.Path({
			data: `
            M ${zones[1].outerStart.x} ${zones[1].outerStart.y}
            L ${zones[1].outerEnd.x} ${zones[1].outerEnd.y}
            A ${radius} ${radius} 0 0 0 ${zones[2].outerEnd.x} ${zones[2].outerEnd.y}
            L ${zones[3].outerEnd.x} ${zones[3].outerEnd.y}
            A ${radius} ${radius} 0 0 0 ${zones[4].outerEnd.x} ${zones[4].outerEnd.y}
            Z
        `,
			listening: false
		});
	}

	private createInnerTrackPath(): Konva.Path {
		const zones = this.zones;
		const innerRadius = Math.abs(zones[2].innerStart.y - zones[2].centerInner.y);

		return new Konva.Path({
			data: `
            M ${zones[1].innerStart.x} ${zones[1].innerStart.y}
            L ${zones[1].innerEnd.x} ${zones[1].innerEnd.y}
            A ${innerRadius} ${innerRadius} 0 0 0 ${zones[2].innerEnd.x} ${zones[2].innerEnd.y}
            L ${zones[3].innerEnd.x} ${zones[3].innerEnd.y}
            A ${innerRadius} ${innerRadius} 0 0 0 ${zones[4].innerEnd.x} ${zones[4].innerEnd.y}
        `,
			listening: false
		});
	}

	private createTrackSurfacePath(): Konva.Path {
		return new Konva.Path({
			data: this.createOuterTrackPath().data() + ' ' + this.createInnerTrackPath().data(),
			fill: colors.trackSurface,
			fillRule: 'evenodd',
			listening: false
		});
	}

	private createPivotLinePath(): Konva.Path {
		const zone = this.zones[1];
		return new Konva.Path({
			data: `M ${zone.outerEnd.x} ${zone.outerEnd.y} L ${zone.innerEnd.x} ${zone.innerEnd.y}`,
			stroke: colors.trackBoundaries,
			strokeWidth: LINE_WIDTH,
			listening: false
		});
	}

	private createJammerLinePath(): Konva.Path {
		const zone = this.zones[1];
		const midW = {
			x: (zone.outerEnd.x + zone.innerEnd.x) / 2,
			y: (zone.outerEnd.y + zone.innerEnd.y) / 2
		};
		const midX = {
			x: (zone.outerStart.x + zone.innerStart.x) / 2,
			y: (zone.outerStart.y + zone.innerStart.y) / 2
		};
		const directionWX = Math.atan2(midX.y - midW.y, midX.x - midW.x);
		const x = midW.x + THIRTYFEET * Math.cos(directionWX);
		const y = midW.y + THIRTYFEET * Math.sin(directionWX);
		const { innerProjection, outerProjection } = this.projectPointToBoundaries({ x, y }, 1);

		return new Konva.Path({
			data: `M ${innerProjection.x} ${innerProjection.y} L ${outerProjection.x} ${outerProjection.y}`,
			stroke: colors.trackBoundaries,
			strokeWidth: LINE_WIDTH,
			listening: false
		});
	}

	createStartZonePath(): Path2D {
		// 1. Get pivot line points (already exists in zone 1)
		const zone = this.zones[1];
		const pivotInner = zone.innerEnd;
		const pivotOuter = zone.outerEnd;

		// 2. Calculate jammer line position (30 feet from pivot line)
		const midPivot = {
			x: (pivotOuter.x + pivotInner.x) / 2,
			y: (pivotOuter.y + pivotInner.y) / 2
		};
		const midStart = {
			x: (zone.outerStart.x + zone.innerStart.x) / 2,
			y: (zone.outerStart.y + zone.innerStart.y) / 2
		};
		const directionToStart = Math.atan2(midStart.y - midPivot.y, midStart.x - midPivot.x);
		const jammerPoint = {
			x: midPivot.x + THIRTYFEET * Math.cos(directionToStart),
			y: midPivot.y + THIRTYFEET * Math.sin(directionToStart)
		};

		// 3. Project jammer point to track boundaries
		const { innerProjection: jammerInner, outerProjection: jammerOuter } =
			this.projectPointToBoundaries(jammerPoint, 1);

		// 4. Create and return the path
		const path = new Path2D();
		path.moveTo(pivotInner.x, pivotInner.y);
		path.lineTo(pivotOuter.x, pivotOuter.y);
		path.lineTo(jammerOuter.x, jammerOuter.y);
		path.lineTo(jammerInner.x, jammerInner.y);
		path.closePath();

		return path;
	}

	private createBoundariesPath(): Konva.Path {
		return new Konva.Path({
			data: this.createOuterTrackPath().data() + ' ' + this.createInnerTrackPath().data(),
			stroke: colors.trackBoundaries,
			strokeWidth: LINE_WIDTH,
			listening: false
		});
	}

	private createOuterOfficialLanePath(): Konva.Path {
		const zones = this.zones;
		const officialLaneDistance = TENFEET;

		// Calculate angle for straight 1
		const angle1 = Math.atan2(
			zones[1].outerEnd.y - zones[1].outerStart.y,
			zones[1].outerEnd.x - zones[1].outerStart.x
		);

		// Calculate parallel offset points for zone 1
		const start1X = zones[1].outerStart.x - officialLaneDistance * Math.sin(angle1);
		const start1Y = zones[1].outerStart.y + officialLaneDistance * Math.cos(angle1);
		const end1X = zones[1].outerEnd.x - officialLaneDistance * Math.sin(angle1);
		const end1Y = zones[1].outerEnd.y + officialLaneDistance * Math.cos(angle1);

		return new Konva.Path({
			data: `
            M ${start1X} ${start1Y}
            L ${end1X} ${end1Y}
            A ${Math.abs(zones[2].outerStart.y - zones[2].centerOuter.y) + officialLaneDistance} ${
							Math.abs(zones[2].outerStart.y - zones[2].centerOuter.y) + officialLaneDistance
						} 0 0 0 ${zones[2].outerEnd.x} ${zones[2].outerEnd.y + officialLaneDistance}
            L ${zones[3].outerEnd.x} ${zones[3].outerEnd.y + officialLaneDistance}
            A ${Math.abs(zones[4].outerStart.y - zones[4].centerOuter.y) + officialLaneDistance} ${
							Math.abs(zones[4].outerStart.y - zones[4].centerOuter.y) + officialLaneDistance
						} 0 0 0 ${start1X} ${start1Y}
        `,
			stroke: colors.officialLane,
			strokeWidth: LINE_WIDTH / 7,
			dash: [2, 8],
			listening: false
		});
	}

	private drawStraight1TenFeetLines(): Konva.Path {
		const zone = this.zones[1];
		const distances = [TENFEET, TWENTYFEET];
		let pathData = '';

		const midW = {
			x: (zone.outerEnd.x + zone.innerEnd.x) / 2,
			y: (zone.outerEnd.y + zone.innerEnd.y) / 2
		};
		const midX = {
			x: (zone.outerStart.x + zone.innerStart.x) / 2,
			y: (zone.outerStart.y + zone.innerStart.y) / 2
		};
		const directionWX = Math.atan2(midX.y - midW.y, midX.x - midW.x);
		const angleEC = Math.atan2(
			zone.innerStart.y - zone.innerEnd.y,
			zone.innerStart.x - zone.innerEnd.x
		);

		distances.forEach((distance) => {
			const x = midW.x + distance * Math.cos(directionWX);
			const y = midW.y + distance * Math.sin(directionWX);
			pathData += `M ${x - TENFEETLINE * Math.sin(angleEC)} ${y + TENFEETLINE * Math.cos(angleEC)}`;
			pathData += `L ${x + TENFEETLINE * Math.sin(angleEC)} ${y - TENFEETLINE * Math.cos(angleEC)}`;
		});

		return new Konva.Path({
			data: pathData,
			stroke: colors.tenFeetLines,
			strokeWidth: TEN_FEET_LINE_WIDTH,
			listening: false
		});
	}

	private drawStraight2TenFeetLines(): Konva.Path {
		const zone = this.zones[3];
		let pathData = '';

		const midZ = {
			x: (zone.innerEnd.x + zone.outerEnd.x) / 2,
			y: (zone.innerEnd.y + zone.outerEnd.y) / 2
		};
		const midY = {
			x: (zone.innerStart.x + zone.outerStart.x) / 2,
			y: (zone.innerStart.y + zone.outerStart.y) / 2
		};
		const directionZY = Math.atan2(midY.y - midZ.y, midY.x - midZ.x);
		const angleDF = Math.atan2(
			zone.innerStart.y - zone.innerEnd.y,
			zone.innerStart.x - zone.innerEnd.x
		);

		[0, TENFEET, TWENTYFEET, THIRTYFEET].forEach((distance) => {
			const x = midZ.x + distance * Math.cos(directionZY);
			const y = midZ.y + distance * Math.sin(directionZY);
			pathData += `M ${x - TENFEETLINE * Math.sin(angleDF)} ${y + TENFEETLINE * Math.cos(angleDF)}`;
			pathData += `L ${x + TENFEETLINE * Math.sin(angleDF)} ${y - TENFEETLINE * Math.cos(angleDF)}`;
		});

		return new Konva.Path({
			data: pathData,
			stroke: colors.tenFeetLines,
			strokeWidth: TEN_FEET_LINE_WIDTH,
			listening: false
		});
	}

	private drawTurn1TenFeetLines(): Konva.Path {
		return this.drawTurnTenFeetLines(2);
	}

	private drawTurn2TenFeetLines(): Konva.Path {
		return this.drawTurnTenFeetLines(4);
	}

	private drawTurnTenFeetLines(turnKey: TurnKey): Konva.Path {
		const zone = this.zones[turnKey];
		const turnRadius = Math.hypot(
			zone.innerStart.x - zone.centerInner.x,
			zone.innerStart.y - zone.centerInner.y
		);
		let currentAngle = Math.atan2(
			zone.innerStart.y - zone.centerInner.y,
			zone.innerStart.x - zone.centerInner.x
		);

		const pathSegments = [];

		for (let i = 1; i <= 5; i++) {
			const point = {
				x: zone.centerInner.x + turnRadius * Math.cos(currentAngle - TURNSEGMENT / turnRadius),
				y: zone.centerInner.y + turnRadius * Math.sin(currentAngle - TURNSEGMENT / turnRadius)
			};

			const { innerProjection, outerProjection } = this.projectPointToBoundariesInTurn(
				point,
				turnKey
			);

			const midX = (innerProjection.x + outerProjection.x) / 2;
			const midY = (innerProjection.y + outerProjection.y) / 2;
			const lineAngle = Math.atan2(
				outerProjection.y - innerProjection.y,
				outerProjection.x - innerProjection.x
			);

			pathSegments.push(`
            M ${midX - TENFEETLINE * Math.cos(lineAngle)} ${midY - TENFEETLINE * Math.sin(lineAngle)}
            L ${midX + TENFEETLINE * Math.cos(lineAngle)} ${midY + TENFEETLINE * Math.sin(lineAngle)}
        `);

			currentAngle = Math.atan2(point.y - zone.centerInner.y, point.x - zone.centerInner.x);
		}

		return new Konva.Path({
			data: pathSegments.join(' '),
			stroke: colors.tenFeetLines,
			strokeWidth: TEN_FEET_LINE_WIDTH,
			listening: false
		});
	}

	projectPointToBoundaries(
		point: Point,
		zone: ZoneKey
	): { innerProjection: Point; outerProjection: Point } {
		// Use existing turn projection for zones 2 and 4
		if (zone === 2 || zone === 4) {
			return this.projectPointToBoundariesInTurn(point, zone);
		}

		// Use existing straight projection for zones 1 and 3
		return this.projectPointToBoundariesInStraight(point, zone);
	}

	private projectPointToBoundariesInStraight(
		point: Point,
		straightKey: StraightKey
	): {
		innerProjection: Point;
		outerProjection: Point;
	} {
		const zone = this.zones[straightKey];

		// Calculate angle perpendicular to inner track line
		const angleInner = Math.atan2(
			zone.innerStart.y - zone.innerEnd.y,
			zone.innerStart.x - zone.innerEnd.x
		);

		// Define perpendicular line through our point
		const perpendicularPoint = {
			x: point.x - 100 * Math.sin(angleInner),
			y: point.y + 100 * Math.cos(angleInner)
		};

		// Common variables for intersection
		const x1 = point.x;
		const y1 = point.y;
		const x2 = perpendicularPoint.x;
		const y2 = perpendicularPoint.y;

		// Inner track intersection
		const innerX3 = zone.innerEnd.x;
		const innerY3 = zone.innerEnd.y;
		const innerX4 = zone.innerStart.x;
		const innerY4 = zone.innerStart.y;

		// Outer track intersection
		const outerX3 = zone.outerEnd.x;
		const outerY3 = zone.outerEnd.y;
		const outerX4 = zone.outerStart.x;
		const outerY4 = zone.outerStart.y;

		const innerDenominator = (x1 - x2) * (innerY3 - innerY4) - (y1 - y2) * (innerX3 - innerX4);
		const outerDenominator = (x1 - x2) * (outerY3 - outerY4) - (y1 - y2) * (outerX3 - outerX4);

		const innerT =
			((x1 - innerX3) * (innerY3 - innerY4) - (y1 - innerY3) * (innerX3 - innerX4)) /
			innerDenominator;
		const outerT =
			((x1 - outerX3) * (outerY3 - outerY4) - (y1 - outerY3) * (outerX3 - outerX4)) /
			outerDenominator;

		return {
			innerProjection: {
				x: x1 + innerT * (x2 - x1),
				y: y1 + innerT * (y2 - y1)
			},
			outerProjection: {
				x: x1 + outerT * (x2 - x1),
				y: y1 + outerT * (y2 - y1)
			}
		};
	}

	private projectPointToBoundariesInTurn(
		point: Point,
		turnKey: TurnKey
	): { innerProjection: Point; outerProjection: Point } {
		const zone = this.zones[turnKey];
		const angle = Math.atan2(point.y - zone.centerInner.y, point.x - zone.centerInner.x);
		const innerRadius = Math.abs(zone.innerStart.y - zone.centerInner.y);
		const outerRadius = Math.abs(zone.outerStart.y - zone.centerOuter.y);

		return {
			innerProjection: {
				x: zone.centerInner.x + innerRadius * Math.cos(angle),
				y: zone.centerInner.y + innerRadius * Math.sin(angle)
			},
			outerProjection: {
				x: zone.centerOuter.x + outerRadius * Math.cos(angle),
				y: zone.centerOuter.y + outerRadius * Math.sin(angle)
			}
		};
	}

	determineZone(point: Point): ZoneKey | 0 {
		if (this.isPointInPath(this.straight1Path, point)) {
			return 1;
		}
		if (this.isPointInPath(this.turn1Path, point)) {
			return 2;
		}
		if (this.isPointInPath(this.straight2Path, point)) {
			return 3;
		}
		if (this.isPointInPath(this.turn2Path, point)) {
			return 4;
		}
		return 0;
	}

	isPointInPath(path: Path2D, point: Point): boolean {
		return this.context.isPointInPath(path, point.x, point.y);
	}

	// DEBUGGING

	public toggleDebugMode(enabled: boolean) {
		this.debugMode = enabled;

		// Clear existing debug elements
		this.trackLinesGroup.find('.debug-point').forEach((node) => node.destroy());

		if (enabled) {
			// Draw debug points when enabled
			this.drawPoints(this.points);
		}

		// Redraw the layer
		this.trackLinesGroup.getLayer()?.batchDraw();
	}

	private drawPoints(points: Record<string, Point>) {
		Object.entries(points).forEach(([label, point]) => {
			const circle = new Konva.Circle({
				x: point.x,
				y: point.y,
				radius: 5,
				fill: 'red',
				stroke: 'black',
				strokeWidth: 1,
				name: 'debug-point' // Add class name
			});

			const text = new Konva.Text({
				x: point.x + 10,
				y: point.y + 10,
				text: label,
				fontSize: 16,
				fill: 'black',
				name: 'debug-point' // Add class name
			});

			this.trackLinesGroup.add(circle);
			this.trackLinesGroup.add(text);
		});
	}
}
