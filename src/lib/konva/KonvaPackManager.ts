import Konva from 'konva';
import { get } from 'svelte/store';
import { colors, TRACK_SCALE } from '$lib/constants';
import {
	analyzePack,
	engagementZonePathData,
	packEndpoints,
	type DerivedSkater,
	type MeterPoint,
	type MeterSkater,
	type PackMethod
} from '$lib/trackMath';
import { boardSettings } from '$lib/stores/boardSettings';
import type { KonvaPlayerManager } from './KonvaPlayerManager';
import { poseStore } from '$lib/doc/poses';

export class KonvaPackManager {
	private engagementZonePath: Konva.Path;
	private scheduled = false;
	/**
	 * Whether the engagement-zone overlay is drawn. Driven by the active
	 * authored step's `showPackZone` (P3 task 10) so a coach can author
	 * "show the pack here, hide it there". Pack MEMBERSHIP and in-play
	 * colouring are always computed; this only gates the drawn region.
	 */
	private zoneVisible = true;

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
	 * Coalesces bursts of `determinePack` calls (dragmove can fire faster
	 * than the display refresh rate, especially coalesced touch pointer
	 * events) into at most one recompute per animation frame. Safe to call
	 * as often as needed; redundant calls within the same frame are free.
	 */
	schedulePackUpdate(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		requestAnimationFrame(() => {
			this.scheduled = false;
			this.determinePack();
		});
	}

	/** Gates the drawn engagement-zone overlay (does not affect membership). */
	setZoneVisible(visible: boolean): void {
		this.zoneVisible = visible;
		if (!visible) this.engagementZonePath.hide();
	}

	/**
	 * Recomputes pack membership, in-play status, rearmost/foremost and the
	 * engagement-zone overlay using @open-roller-derby-tools/derby-track. Pack
	 * eligibility uses each blocker's own in-bounds flag so it matches the
	 * visual indicator. Positions come from `poseStore.effective`, which
	 * transparently resolves to the live (in-gesture) pose during a drag and
	 * the committed pose otherwise — this is the one accessor every consumer
	 * uses, so there is no separate "dragging" branch here.
	 */
	determinePack() {
		const blockers = this.playerManager.getBlockers();

		// Reset pack-related FLAGS only — deliberately without writing the
		// stroke. The stroke is written exactly once per blocker below, from
		// the final computed status, so no intermediate colour can be painted.
		blockers.forEach((p) => p.resetPackStatus());

		const method = get(boardSettings).packMethod;

		const skaters: MeterSkater[] = blockers.map((p) => {
			const pose = poseStore.effective(p.id);
			// Poses are already planar metres — feed them straight to the pack
			// analyser (which has always consumed Cartesian metres).
			const meterPos = pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 };
			return {
				id: p.id,
				x: meterPos.x,
				y: meterPos.y,
				team: p.team,
				isJammer: false,
				inBounds: p.isInBounds
			};
		});

		const derived = analyzePack(skaters, method);
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
			this.updateEngagementZone(packDerived, method);
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

	private updateEngagementZone(packDerived: DerivedSkater[], method: PackMethod) {
		if (!this.zoneVisible) {
			this.engagementZonePath.hide();
			return;
		}
		const pathData = engagementZonePathData(packDerived, method);
		if (!pathData) {
			this.engagementZonePath.hide();
			return;
		}
		this.engagementZonePath.data(pathData);
		this.engagementZonePath.show();
		this.engagementZoneLayer.batchDraw();
	}
}
