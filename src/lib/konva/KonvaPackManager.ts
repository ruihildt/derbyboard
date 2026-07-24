import Konva from 'konva';
import { colors } from '$lib/constants';
import {
	analyzePack,
	packEndpoints,
	pxToMeter,
	type DerivedSkater,
	type MeterPoint,
	type MeterSkater
} from '$lib/trackMath';
import { KonvaTeamPlayer } from './KonvaTeamPlayer';
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

	/**
	 * Recomputes pack membership, in-play status, rearmost/foremost and the
	 * engagement-zone overlay using roller-derby-track-utils. Pack eligibility
	 * uses each blocker's own in-bounds flag so it matches the visual indicator.
	 */
	determinePack() {
		const blockers = this.playerManager.getBlockers();

		// Reset all pack-related state first.
		blockers.forEach((p) => {
			p.isInPack = false;
			p.isRearmost = false;
			p.isForemost = false;
			p.updateEngagementZoneStatus(false);
		});

		const center = this.center();
		const skaters: MeterSkater[] = blockers.map((p) => {
			const m = pxToMeter(p.getPosition(), center);
			return { id: p.id, x: m.x, y: m.y, team: p.team, isJammer: false, inBounds: p.isInBounds };
		});

		const derived = analyzePack(skaters);
		const byId = new Map<string, DerivedSkater>(derived.map((s) => [s.id, s]));

		// Map pack membership and in-play back onto the players.
		blockers.forEach((p) => {
			const d = byId.get(p.id);
			p.isInPack = !!d?.packSkater;
			p.updateEngagementZoneStatus(!!d?.inPlay);
		});

		const packDerived = derived.filter((s) => s.packSkater);
		if (packDerived.length >= 2) {
			// Rearmost / foremost from the package's sorted outermost pack skaters.
			const endpoints = packEndpoints(packDerived);
			if (endpoints) {
				const rear = blockers.find((p) => p.id === endpoints[0].id);
				const fore = blockers.find((p) => p.id === endpoints[1].id);
				if (rear) rear.isRearmost = true;
				if (fore) fore.isForemost = true;
			}
			this.updateEngagementZone(blockers.filter((p) => p.isInPack));
		} else {
			// No pack (split / none).
			this.engagementZonePath.hide();
		}

		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
	}

	private center(): MeterPoint {
		const stage = this.playersLayer.getStage();
		return { x: (stage?.width() ?? 0) / 2, y: (stage?.height() ?? 0) / 2 };
	}

	// --- Engagement-zone overlay rendering -------------------------------------
	// NOTE: geometry here still comes from KonvaTrackGeometry. Step 3 will replace
	// this with the package's computePartialTrackShape2D so the overlay matches the
	// package-derived membership exactly.

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

	private calculateEngagementZonePoints(rearmost: KonvaTeamPlayer, foremost: KonvaTeamPlayer) {
		const rearmostPosition = { x: rearmost.getNode().x(), y: rearmost.getNode().y() };
		const foremostPosition = { x: foremost.getNode().x(), y: foremost.getNode().y() };

		return {
			rearPoint: this.trackGeometry.getPointBehindOnMidtrack(rearmostPosition),
			forePoint: this.trackGeometry.getPointAheadOnMidtrack(foremostPosition)
		};
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
