import { get } from 'svelte/store';
import type Konva from 'konva';

import { TRACK_SCALE } from '$lib/constants';
import { interaction } from '$lib/stores/interaction';
import { poseStore } from '$lib/doc/poses';
import { motionHeading } from '$lib/track/heading';
import { fitSourceToViewport, type CaptureFit } from '$lib/utils/capture';
import type { TimelineSample } from '$lib/recording/timeline/types';
import type { PlanarPoint } from '$lib/doc/types';
import type { KonvaPlayerManager } from '../KonvaPlayerManager';
import type { KonvaPackManager } from '../KonvaPackManager';
import type { PathRenderer } from '../paths/PathRenderer';

export interface ReplayDeps {
	stage: Konva.Stage;
	playersLayer: Konva.Layer;
	engagementZoneLayer: Konva.Layer;
	/** Static stage-local layers (track surface/lines, ghosts, annotations):
	 * repainted only when the stage transform actually changes. */
	staticLayers: Konva.Layer[];
	playerManager: KonvaPlayerManager;
	/** Pack manager is re-created on loadState/rebuild, so it is read lazily. */
	getPackManager: () => KonvaPackManager;
	pathRenderer: PathRenderer;
	getViewportSize: () => { width: number; height: number };
	/** Pack/EZ overlay visibility (owned by KonvaGame; forced on for replay). */
	getZoneVisible: () => boolean;
	setZoneVisible: (visible: boolean) => void;
	/** Tear down authoring residue on replay entry. */
	resetAuthoringView: () => void;
	/** Restore the user's board after replay exits. */
	loadState: () => void;
}

/**
 * Captured-clip replay (P4.5): owns the replay flag, the canonical
 * source→viewport fit, the last rendered sample, and motion-derived heading
 * state. Renders samples by reconciling the roster at the current viewport
 * center and composing the stage transform with the uniform fit, so playback
 * framing always matches the capture's proportions.
 *
 * While active the board is locked (no dragging/panning) and the pack/EZ
 * overlay is forced visible; exiting restores the user's saved board state.
 */
export class ReplayController {
	private active = false;

	/**
	 * Canonical capture dimensions for the active replay (null when not
	 * replaying, or replaying without a known source — falls back to the live
	 * viewport-center transform in that case).
	 */
	private source: { w: number; h: number } | null = null;
	/** Cached uniform fit of `source` into the current viewport. */
	private fit: CaptureFit = { scale: 1, offX: 0, offY: 0 };
	/** Last replay sample rendered; used to re-render on resize while paused. */
	private lastSample: TimelineSample | null = null;
	/** Zone visibility saved before replay forced it on. */
	private savedZoneVisible = true;

	/**
	 * Cached last sample heading map for captured-clip motion-derived heading.
	 * Keyed by entity id; positions are planar world metres (center-relative).
	 */
	private capturedPrevPos: Map<string, PlanarPoint> = new Map();
	private capturedLastHeading: Map<string, number> = new Map();

	/**
	 * Last stage transform that the static stage-local layers were drawn at.
	 * Konva bakes the stage transform into each layer's canvas at draw time,
	 * so these layers only need a repaint when the view actually changes —
	 * not every replay frame.
	 */
	private lastStaticTransform: { scale: number; x: number; y: number } | null = null;

	constructor(private deps: ReplayDeps) {}

	/** True while replay drives the board (editing locked). */
	isActive(): boolean {
		return this.active;
	}

	/**
	 * Enters/exits replay mode. Entering locks the board (no dragging/panning);
	 * exiting restores editing and reloads the user's saved board state.
	 *
	 * When entering with a `source`, the replay is canonical: every sample is
	 * rendered through a uniform source→viewport fit so playback framing always
	 * matches the capture's proportions and boundaries, regardless of window
	 * size. Without a `source` the legacy viewport-center fallback is used.
	 */
	setActive(enabled: boolean, source?: { w: number; h: number }): void {
		this.active = enabled;
		const { stage, playersLayer, playerManager } = this.deps;
		const { panEnabled, entitiesEnabled } = get(interaction);
		stage.draggable(!enabled && panEnabled);
		playersLayer.draggable(!enabled && entitiesEnabled);
		// Match the layer flag on each player node: without this, exiting replay
		// in hand mode would re-enable per-player dragging (children ignore the
		// layer's `draggable(false)`).
		playerManager.setPlayersDraggable(!enabled && entitiesEnabled);
		if (enabled) {
			// Belt-and-braces: tear down any authoring residue (focus/dim,
			// trails, live-tier overrides) so replay starts from a clean slate
			// regardless of component lifecycle order.
			this.deps.resetAuthoringView();
			// Force the pack/EZ overlay visible during replay so a hidden
			// authored overlay can't blank a replay's EZ.
			this.savedZoneVisible = this.deps.getZoneVisible();
			this.deps.setZoneVisible(true);
			this.source = source ?? null;
			const { width, height } = this.deps.getViewportSize();
			this.fit =
				source !== undefined
					? fitSourceToViewport(source, { w: width, h: height })
					: { scale: 1, offX: 0, offY: 0 };
			this.lastSample = null;
			this.resetCapturedHeadingState();
		} else {
			this.source = null;
			this.fit = { scale: 1, offX: 0, offY: 0 };
			this.lastSample = null;
			// Restore the user's zoneVisible setting.
			this.deps.setZoneVisible(this.savedZoneVisible);
			// Clear replay overrides so they don't leak into editing.
			poseStore.clearOverrides();
			// Restore the user's board after replay.
			this.deps.loadState();
		}
	}

	/**
	 * Recomputes the source→viewport fit after a resize and re-renders the
	 * last sample immediately so a paused replay doesn't leave a stale frame.
	 * Returns true when replay is active (the caller skips its edit-path
	 * resize handling in that case).
	 */
	handleResize(): boolean {
		if (!this.active) return false;
		if (this.source) {
			const { width, height } = this.deps.getViewportSize();
			this.fit = fitSourceToViewport(this.source, { w: width, h: height });
			if (this.lastSample) {
				this.renderSampleTransform(this.lastSample, this.source, this.fit);
			}
		}
		return true;
	}

	/**
	 * Reconciles the board to a sample (roster by id, positions, view) and redraws
	 * the pack/engagement zone. Used by TimelinePlayer for replay.
	 *
	 * In canonical replay (a `source` was supplied on entry), renders through
	 * the uniform source→viewport fit. Otherwise falls back to the legacy
	 * viewport-center transform for any non-replay caller.
	 */
	applySnapshot(sample: TimelineSample): void {
		const wasReplaying = this.active;
		this.active = true;
		try {
			if (this.source) {
				this.renderSampleTransform(sample, this.source, this.fit);
			} else {
				const { width, height } = this.deps.getViewportSize();
				const centerX = width / 2;
				const centerY = height / 2;
				const { playerManager, stage } = this.deps;

				playerManager.reconcileTeamPlayers(sample.teamPlayers, centerX, centerY);
				playerManager.reconcileSkatingOfficials(sample.skatingOfficials, centerX, centerY);
				playerManager.setPlayersDraggable(false);
				playerManager.getTeamPlayers().forEach((p) => p.updateInBounds());

				stage.scale({ x: sample.view.zoom, y: sample.view.zoom });
				stage.position({
					x: sample.view.relativeX * centerX,
					y: sample.view.relativeY * centerY
				});

				this.applySampleOverrides(sample);
			}
			this.lastSample = sample;
		} finally {
			this.active = wasReplaying;
		}
	}

	/**
	 * Renders a sample in pure source space (identity fit: scale=1, off=0) so the
	 * export crop is capture-canonical regardless of the live window. Used by the
	 * mp4/png exporter, which stages the board at source dims before cropping.
	 * Forces the pack/EZ overlay visible during export so a hidden authored
	 * overlay can't blank the exported EZ.
	 */
	applySnapshotCanonical(sample: TimelineSample, source: { w: number; h: number }): void {
		const wasReplaying = this.active;
		const wasZoneVisible = this.deps.getZoneVisible();
		this.active = true;
		this.deps.setZoneVisible(true);
		try {
			this.renderSampleTransform(sample, source, { scale: 1, offX: 0, offY: 0 });
		} finally {
			this.active = wasReplaying;
			this.deps.setZoneVisible(wasZoneVisible);
		}
	}

	/**
	 * Renders one replay sample through a uniform source→viewport fit. Player /
	 * track reconciliation stays anchored at the *current* viewport center (the
	 * existing invariant — track and players are both built at the current
	 * center, so reconciliation must use the current center too). Only the stage
	 * scale/position is composed with the fit, so the frame rectangle and the
	 * board content share one transform and stay aligned.
	 *
	 * For a sample with view `{ zoom: z, relativeX: rx, relativeY: ry }`,
	 * source `{ w: sw, h: sh }`, and current viewport `{ w: vw, h: vh }`:
	 *
	 *   sCx = sw/2, sCy = sh/2   (source center, capture-space)
	 *   cCx = vw/2, cCy = vh/2   (current viewport center)
	 *   p0  = (rx*sCx, ry*sCy)   (capture stage position)
	 *   d   = (cCx - sCx, cCy - sCy)
	 *   stage.scale = fit.scale * z
	 *   stage.pos   = off + fit.scale * (p0 - z*d)
	 *
	 * This maps every capture-screen point `q` to `off + fit.scale*q` (uniform),
	 * so the fitted region rect and the board content move together. Identity
	 * check (viewport == source): fit.scale=1, off=0, d=0 ⇒ scale=z, pos=p0 ⇒
	 * exact capture.
	 */
	private renderSampleTransform(
		sample: TimelineSample,
		source: { w: number; h: number },
		fit: CaptureFit
	): void {
		const { playerManager, stage } = this.deps;
		const { width, height } = this.deps.getViewportSize();

		// Roster / positions reconcile at the CURRENT viewport center (unchanged
		// from the legacy applySnapshot path).
		playerManager.reconcileTeamPlayers(sample.teamPlayers, width / 2, height / 2);
		playerManager.reconcileSkatingOfficials(sample.skatingOfficials, width / 2, height / 2);
		playerManager.setPlayersDraggable(false);
		playerManager.getTeamPlayers().forEach((p) => p.updateInBounds());

		const z = sample.view.zoom;
		const sCx = source.w / 2;
		const sCy = source.h / 2;
		const cCx = width / 2;
		const cCy = height / 2;
		const dx = cCx - sCx;
		const dy = cCy - sCy;

		stage.scale({ x: fit.scale * z, y: fit.scale * z });
		stage.position({
			x: fit.offX + fit.scale * (sample.view.relativeX * sCx - z * dx),
			y: fit.offY + fit.scale * (sample.view.relativeY * sCy - z * dy)
		});

		this.applySampleOverrides(sample);
	}

	/**
	 * Computes motion-heading overrides for a replay sample's entities and
	 * publishes them to the pose store. Shared by both replay code paths.
	 */
	private applySampleOverrides(sample: TimelineSample): void {
		const { playerManager, getPackManager, engagementZoneLayer, playersLayer } = this.deps;
		const overrides: Array<[string, { x: number; y: number; heading: number }]> = [];
		const process = (id: string, relative: { x: number; y: number }): void => {
			const pos: PlanarPoint = {
				x: relative.x / TRACK_SCALE,
				y: relative.y / TRACK_SCALE
			};
			const prev = this.capturedPrevPos.get(id) ?? pos;
			const fallback = this.capturedLastHeading.get(id) ?? 0;
			const heading = motionHeading(prev, pos, fallback);
			this.capturedPrevPos.set(id, pos);
			this.capturedLastHeading.set(id, heading);
			overrides.push([id, { x: pos.x, y: pos.y, heading }]);
		};
		for (const tp of sample.teamPlayers) if (tp.id) process(tp.id, tp.relative);
		for (const so of sample.skatingOfficials) if (so.id) process(so.id, so.relative);
		poseStore.setOverrides(overrides);

		// Apply heading to the Konva facing groups (reconcileTeamPlayers sets
		// positions only; applyEffectivePoses rotates the chevrons from the
		// override tier). draw=false on the composite steps so each layer is
		// drawn exactly once per replay frame.
		playerManager.applyEffectivePoses(false);
		getPackManager().determinePack(false);
		engagementZoneLayer.batchDraw();
		playersLayer.batchDraw();

		// Konva bakes the stage transform into each layer's canvas at draw
		// time, so the static stage-local layers (track, ghosts, annotations,
		// paths) must be redrawn whenever the view changes — but ONLY then.
		// A fixed-view replay no longer repaints the expensive track layers
		// every frame.
		this.redrawStaticLayersIfViewChanged();

		if (sample.pathFrame) this.deps.pathRenderer.renderPathFrame(sample.pathFrame);
	}

	/** Redraws the static stage-local layers iff the stage transform changed. */
	private redrawStaticLayersIfViewChanged(): void {
		const { stage } = this.deps;
		const scale = stage.scaleX();
		const x = stage.x();
		const y = stage.y();
		const t = this.lastStaticTransform;
		if (t && t.scale === scale && t.x === x && t.y === y) return;
		this.lastStaticTransform = { scale, x, y };
		for (const layer of this.deps.staticLayers) layer.batchDraw();
	}

	/** Resets the captured-clip heading state (on replay start/seek-large-jump). */
	private resetCapturedHeadingState(): void {
		this.capturedPrevPos.clear();
		this.capturedLastHeading.clear();
	}
}
