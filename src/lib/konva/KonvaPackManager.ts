import Konva from 'konva';
import { colors, TENFEET } from '$lib/constants';
import { KonvaTeamPlayer, TeamPlayerRole } from './KonvaTeamPlayer';
import { KonvaTrackGeometry, ZoneType, type Point } from './KonvaTrackGeometry';
import type { KonvaPlayerManager } from './KonvaPlayerManager';

export class KonvaPackManager {
	private engagementZonePath: Konva.Path;
	private zones: number[] = [];
	private debugMode: boolean = false;

	constructor(
		private playerManager: KonvaPlayerManager,
		private playersLayer: Konva.Layer,
		private engagementZoneLayer: Konva.Layer,
		private trackGeometry: KonvaTrackGeometry
	) {
		// Initialize engagement zone shape
		this.engagementZonePath = new Konva.Path({
			fill: colors.engagementZone,
			listening: false
		});
		this.engagementZoneLayer.add(this.engagementZonePath);

		// Enable/disable debug mode
		this.toggleDebugMode(false);
	}

	determinePack() {
		const blockers = this.playerManager.getBlockers();

		// Reset all players pack related properties first
		blockers.forEach((p) => {
			p.isInPack = false;
			p.isRearmost = false;
			p.isForemost = false;
			p.updateEngagementZoneStatus(false);
		});

		const inBoundsBlockers = blockers.filter(
			(p) => p.isInBounds && (p.role === TeamPlayerRole.blocker || p.role === TeamPlayerRole.pivot)
		);

		const groups = this.groupBlockers(inBoundsBlockers);
		const validGroups = groups.filter(this.isValidGroup);

		const maxSize = Math.max(...validGroups.map((g) => g.length), 0);
		const largestGroups = validGroups.filter((g) => g.length === maxSize);

		if (largestGroups.length === 1) {
			const packGroup = largestGroups[0];
			this.updatePackStatus(blockers, packGroup);
			this.updateRearAndForemostPlayers(packGroup);
			this.updateEngagementZone(packGroup);
		} else {
			// Split pack case - update all players to show no pack
			blockers.forEach((p) => {
				p.isInPack = false;
				p.updateEngagementZoneStatus(false);
			});
			this.engagementZonePath.hide();
		}

		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
	}

	private isValidGroup(group: KonvaTeamPlayer[]): boolean {
		return group.some((p) => p.team === 'A') && group.some((p) => p.team === 'B');
	}

	private groupBlockers(blockers: KonvaTeamPlayer[]): KonvaTeamPlayer[][] {
		const groups: KonvaTeamPlayer[][] = [];
		const ungrouped = [...blockers];

		while (ungrouped.length > 0) {
			const group = [ungrouped.pop()!];
			let i = 0;
			while (i < group.length) {
				const current = group[i];
				const currentNode = current.getNode();

				for (let j = ungrouped.length - 1; j >= 0; j--) {
					const targetNode = ungrouped[j].getNode();
					const dx = currentNode.x() - targetNode.x();
					const dy = currentNode.y() - targetNode.y();
					if (Math.sqrt(dx * dx + dy * dy) <= TENFEET) {
						group.push(ungrouped.splice(j, 1)[0]);
					}
				}
				i++;
			}
			groups.push(group);
		}
		return groups;
	}

	private updatePackStatus(teamPlayers: KonvaTeamPlayer[], packGroup: KonvaTeamPlayer[]) {
		teamPlayers.forEach((player) => {
			player.isInPack = packGroup.includes(player);
			player.updateEngagementZoneStatus(player.isInEngagementZone);
		});
	}

	private updateEngagementZone(packGroup: KonvaTeamPlayer[]) {
		const rearmost = packGroup.find((p) => p.isRearmost);
		const foremost = packGroup.find((p) => p.isForemost);

		if (!rearmost || !foremost) {
			this.engagementZonePath.hide();
			return;
		}

		// Get extended engagement zone points
		const { rearPoint, forePoint } = this.calculateEngagementZonePoints(rearmost, foremost);

		// Update debug point markers
		this.updateDebugPoints(rearPoint, forePoint);

		const rearZone = this.trackGeometry.determineZone(rearPoint);
		const foreZone = this.trackGeometry.determineZone(forePoint);

		if (!rearZone || !foreZone) return;

		// Store zones for pack definition
		this.zones = this.getZonesBetween(rearZone, foreZone);

		// Project points to track boundaries
		const rear = this.trackGeometry.projectPointToBoundaries(rearPoint, rearZone);
		const fore = this.trackGeometry.projectPointToBoundaries(forePoint, foreZone);

		let pathData = `M ${rear.innerProjection.x} ${rear.innerProjection.y}`;

		if (rearZone === foreZone) {
			const zone = this.trackGeometry.zones[rearZone as keyof typeof this.trackGeometry.zones];
			if (zone.type === ZoneType.TURN) {
				const innerRadius = Math.hypot(
					zone.innerStart.x - zone.centerInner.x,
					zone.innerStart.y - zone.centerInner.y
				);
				const outerRadius = Math.hypot(
					zone.outerStart.x - zone.centerOuter.x,
					zone.outerStart.y - zone.centerOuter.y
				);

				pathData += ` A ${innerRadius} ${innerRadius} 1 0 0 ${fore.innerProjection.x} ${fore.innerProjection.y}`;
				pathData += ` L ${fore.outerProjection.x} ${fore.outerProjection.y}`;
				pathData += ` A ${outerRadius} ${outerRadius} 1 0 1 ${rear.outerProjection.x} ${rear.outerProjection.y}`;
			} else {
				pathData += ` L ${fore.innerProjection.x} ${fore.innerProjection.y}`;
				pathData += ` L ${fore.outerProjection.x} ${fore.outerProjection.y}`;
				pathData += ` L ${rear.outerProjection.x} ${rear.outerProjection.y}`;
			}
		} else {
			this.zones.forEach((zoneNumber, index) => {
				const zone = this.trackGeometry.zones[zoneNumber as keyof typeof this.trackGeometry.zones];
				if (zone.type === ZoneType.TURN) {
					const innerRadius = Math.hypot(
						zone.innerStart.x - zone.centerInner.x,
						zone.innerStart.y - zone.centerInner.y
					);
					pathData += ` A ${innerRadius} ${innerRadius} 1 0 0 ${
						index === this.zones.length - 1 ? fore.innerProjection.x : zone.innerEnd.x
					} ${index === this.zones.length - 1 ? fore.innerProjection.y : zone.innerEnd.y}`;
				} else {
					pathData += ` L ${
						index === this.zones.length - 1 ? fore.innerProjection.x : zone.innerEnd.x
					} ${index === this.zones.length - 1 ? fore.innerProjection.y : zone.innerEnd.y}`;
				}
			});

			pathData += ` L ${fore.outerProjection.x} ${fore.outerProjection.y}`;

			[...this.zones].reverse().forEach((zoneNumber, index) => {
				const zone = this.trackGeometry.zones[zoneNumber as keyof typeof this.trackGeometry.zones];
				if (zone.type === ZoneType.TURN) {
					const outerRadius = Math.hypot(
						zone.outerStart.x - zone.centerOuter.x,
						zone.outerStart.y - zone.centerOuter.y
					);
					pathData += ` A ${outerRadius} ${outerRadius} 1 0 1 ${
						index === this.zones.length - 1 ? rear.outerProjection.x : zone.outerStart.x
					} ${index === this.zones.length - 1 ? rear.outerProjection.y : zone.outerStart.y}`;
				} else {
					pathData += ` L ${
						index === this.zones.length - 1 ? rear.outerProjection.x : zone.outerStart.x
					} ${index === this.zones.length - 1 ? rear.outerProjection.y : zone.outerStart.y}`;
				}
			});
		}

		pathData += ' Z';
		this.engagementZonePath.data(pathData);
		this.engagementZonePath.show();

		// After drawing engagement zone, check which players are in it
		this.playerManager.getBlockers().forEach((player) => {
			const point = { x: player.getNode().x(), y: player.getNode().y() };
			const isInEngagementZone = this.isPointInEngagementZone(point);
			player.updateEngagementZoneStatus(isInEngagementZone);
		});

		this.engagementZoneLayer.batchDraw();
	}

	private getZonesBetween(start: number, end: number): number[] {
		const zones = [1, 2, 3, 4];
		const startIdx = zones.indexOf(start);
		const endIdx = zones.indexOf(end);

		if (startIdx === endIdx) return [start];

		if (startIdx < endIdx) {
			return zones.slice(startIdx, endIdx + 1);
		} else {
			return [...zones.slice(startIdx), ...zones.slice(0, endIdx + 1)];
		}
	}

	private updateRearAndForemostPlayers(packGroup: KonvaTeamPlayer[]): void {
		// Reset all players
		packGroup.forEach((player) => {
			player.isRearmost = false;
			player.isForemost = false;
		});

		const packBlockers = packGroup.filter((player) => player.isInPack);
		if (packBlockers.length < 2) return;

		let zones = [
			...new Set(
				packBlockers.map((p) => {
					const point = { x: p.getNode().x(), y: p.getNode().y() };
					return this.trackGeometry.determineZone(point);
				})
			)
		];

		// Sort zones based on special cases involving zone 4
		if (zones.includes(4)) {
			if (zones.includes(1) && zones.includes(2)) {
				zones.sort();
				zones = [4, 1, 2];
			} else if (zones.includes(1) && zones.includes(3)) {
				zones = [3, 4, 1];
			} else if (zones.includes(2) && zones.includes(3)) {
				zones = [2, 3, 4];
			} else if (zones.includes(1)) {
				zones = [4, 1];
			} else if (zones.includes(3)) {
				zones = [3, 4];
			}
		} else {
			zones.sort();
		}

		this.zones = zones;

		const firstZone = zones[0];
		const lastZone = zones[zones.length - 1];

		const firstZoneBlockers = packBlockers.filter((p) => {
			const point = { x: p.getNode().x(), y: p.getNode().y() };
			return this.trackGeometry.determineZone(point) === firstZone;
		});
		const lastZoneBlockers = packBlockers.filter((p) => {
			const point = { x: p.getNode().x(), y: p.getNode().y() };
			return this.trackGeometry.determineZone(point) === lastZone;
		});

		if (firstZoneBlockers.length > 0) {
			const rearmost = this.findRearmost(firstZoneBlockers, firstZone);
			rearmost.isRearmost = true;
		}

		if (lastZoneBlockers.length > 0) {
			const foremost = this.findForemost(lastZoneBlockers, lastZone);
			foremost.isForemost = true;
		}
	}

	private findRearmost(blockers: KonvaTeamPlayer[], zone: number): KonvaTeamPlayer {
		if (zone === 1) {
			return blockers.reduce((rear, player) =>
				player.getNode().x() > rear.getNode().x() ? player : rear
			);
		}
		if (zone === 2) {
			const turn = this.trackGeometry.zones[2];
			return this.getPlayerByAngle(blockers, turn.centerInner.x, turn.centerInner.y, 'max');
		}
		if (zone === 3) {
			return blockers.reduce((rear, player) =>
				player.getNode().x() < rear.getNode().x() ? player : rear
			);
		}
		// zone 4
		const turn = this.trackGeometry.zones[4];
		return this.getPlayerByAngle(blockers, turn.centerInner.x, turn.centerInner.y, 'max');
	}

	private findForemost(blockers: KonvaTeamPlayer[], zone: number): KonvaTeamPlayer {
		if (zone === 1) {
			return blockers.reduce((fore, player) =>
				player.getNode().x() < fore.getNode().x() ? player : fore
			);
		}
		if (zone === 2) {
			const turn = this.trackGeometry.zones[2];
			return this.getPlayerByAngle(blockers, turn.centerInner.x, turn.centerInner.y, 'min');
		}
		if (zone === 3) {
			return blockers.reduce((fore, player) =>
				player.getNode().x() > fore.getNode().x() ? player : fore
			);
		}
		// zone 4
		const turn = this.trackGeometry.zones[4];
		return this.getPlayerByAngle(blockers, turn.centerInner.x, turn.centerInner.y, 'min');
	}

	private calculateEngagementZonePoints(rearmost: KonvaTeamPlayer, foremost: KonvaTeamPlayer) {
		const rearmostPosition = { x: rearmost.getNode().x(), y: rearmost.getNode().y() };
		const foremostPosition = { x: foremost.getNode().x(), y: foremost.getNode().y() };

		return {
			rearPoint: this.trackGeometry.getPointBehindOnMidtrack(rearmostPosition),
			forePoint: this.trackGeometry.getPointAheadOnMidtrack(foremostPosition)
		};
	}

	private isPointInEngagementZone(point: Point): boolean {
		return (
			this.engagementZonePath.isVisible() &&
			this.trackGeometry.isPointInPath(new Path2D(this.engagementZonePath.data()), point)
		);
	}

	private getPlayerByAngle(
		blockers: KonvaTeamPlayer[],
		centerX: number,
		centerY: number,
		type: 'min' | 'max'
	): KonvaTeamPlayer {
		return blockers.reduce((selected, player) => {
			const currentAngle = Math.atan2(
				player.getNode().x() - centerX,
				-(player.getNode().y() - centerY)
			);
			const selectedAngle = Math.atan2(
				selected.getNode().x() - centerX,
				-(selected.getNode().y() - centerY)
			);
			const normalizedCurrent = (currentAngle + 2 * Math.PI) % (2 * Math.PI);
			const normalizedSelected = (selectedAngle + 2 * Math.PI) % (2 * Math.PI);

			return type === 'max'
				? normalizedCurrent > normalizedSelected
					? player
					: selected
				: normalizedCurrent < normalizedSelected
					? player
					: selected;
		});
	}

	// DEBUGGING
	private initializeDebugPoints() {
		// Remove existing debug points if any
		this.engagementZoneLayer.findOne('.debug-backward')?.destroy();
		this.engagementZoneLayer.findOne('.debug-forward')?.destroy();

		// Create new debug points
		const backwardPoint = new Konva.Circle({
			radius: 5,
			fill: 'red',
			listening: false,
			name: 'debug-backward'
		});

		const forwardPoint = new Konva.Circle({
			radius: 5,
			fill: 'blue',
			listening: false,
			name: 'debug-forward'
		});

		this.engagementZoneLayer.add(backwardPoint);
		this.engagementZoneLayer.add(forwardPoint);
	}

	private updateDebugPoints(rearPoint: Point, forePoint: Point) {
		if (!this.debugMode) {
			return;
		}

		const backwardPoint = this.engagementZoneLayer.findOne('.debug-backward') as Konva.Circle;
		const forwardPoint = this.engagementZoneLayer.findOne('.debug-forward') as Konva.Circle;

		if (backwardPoint) {
			backwardPoint.position({
				x: rearPoint.x,
				y: rearPoint.y
			});
		}

		if (forwardPoint) {
			forwardPoint.position({
				x: forePoint.x,
				y: forePoint.y
			});
		}
	}

	public toggleDebugMode(enabled: boolean) {
		this.debugMode = enabled;
		if (enabled) {
			this.initializeDebugPoints();
		}
		this.determinePack();
	}
}
