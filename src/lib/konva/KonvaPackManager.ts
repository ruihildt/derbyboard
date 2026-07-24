import Konva from 'konva';
import { colors, TRACK_SCALE } from '$lib/constants';
import {
	analyzePack,
	engagementZonePathData,
	packEndpoints,
	pxToMeter,
	type DerivedSkater,
	type MeterPoint,
	type MeterSkater
} from '$lib/trackMath';
import type { KonvaPlayerManager } from './KonvaPlayerManager';

export class KonvaPackManager {
	private engagementZonePath: Konva.Path;

	constructor(
		private playerManager: KonvaPlayerManager,
		private playersLayer: Konva.Layer,
		private engagementZoneLayer: Konva.Layer
	) {
		this.engagementZonePath = new Konva.Path({
			fill: colors.engagementZone,
			listening: false
		});
		// The EZ path data is in package METERS; scale + translate the node so
		// meters map to stage pixels (direct mapping: px = center + meter * TRACK_SCALE).
		const center = this.center();
		this.engagementZonePath.scale({ x: TRACK_SCALE, y: TRACK_SCALE });
		this.engagementZonePath.position(center);
		this.engagementZoneLayer.add(this.engagementZonePath);
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
			this.updateEngagementZone(packDerived);
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

	private updateEngagementZone(packDerived: DerivedSkater[]) {
		const pathData = engagementZonePathData(packDerived);
		if (!pathData) {
			this.engagementZonePath.hide();
			return;
		}
		this.engagementZonePath.data(pathData);
		this.engagementZonePath.show();
		this.engagementZoneLayer.batchDraw();
	}
}
