import { get } from 'svelte/store';
import type Konva from 'konva';

import { interaction } from '$lib/stores/interaction';
import {
	selectedEntityId,
	directionControlActive,
	setEntitySelection
} from '$lib/stores/selection';
import { poseStore } from '$lib/doc/poses';
import { tweenSteps, easeInOutCubic } from '$lib/track/tween';
import type { EntityPose } from '$lib/doc/types';
import type { KonvaPlayerManager } from '../KonvaPlayerManager';
import type { KonvaPackManager } from '../KonvaPackManager';
import type { TrailRenderer } from '../trails/TrailRenderer';

export interface AuthoredPlaybackDeps {
	playerManager: KonvaPlayerManager;
	playersLayer: Konva.Layer;
	engagementZoneLayer: Konva.Layer;
	trailLayer: Konva.Layer;
	trailRenderer: TrailRenderer;
	/** Pack manager is re-created on loadState/rebuild, so it is read lazily. */
	getPackManager: () => KonvaPackManager;
	updateRotationHandle: (headingHint?: number | null) => void;
	/** Clears the focus/dim + focus-tap state owned by the game. */
	clearFocusState: () => void;
}

/**
 * Authored-clip playback (P3). Drives every entity's pose through the
 * PoseStore LIVE tier each frame (the same tier a drag uses), then reprojects
 * the nodes. This reuses the single `poseStore.effective` accessor that
 * pack/in-bounds/snapshot already read, so tweened positions are consistent
 * everywhere — no separate "playback" code path that can drift from editing.
 *
 * Trails, focus/dim and per-step pack-zone visibility live here as runtime
 * view state (not persisted in the doc).
 */
export class AuthoredPlaybackController {
	private active = false;
	private trailsEnabled = false;
	private tweenRafId: number | null = null;

	constructor(private deps: AuthoredPlaybackDeps) {}

	isActive(): boolean {
		return this.active;
	}

	/** Enters authored playback: locks entity dragging, resets trails. */
	begin(): void {
		this.active = true;
		this.deps.playerManager.setPlayersDraggable(false);
		this.deps.playersLayer.draggable(false);
		this.deps.trailRenderer.clear();
	}

	/** Exits authored playback: clears transient live poses, restores dragging. */
	end(): void {
		this.active = false;
		poseStore.abortGesture();
		// Restore dragging only when the current tool actually allows entity
		// editing; hand mode keeps players inert (children ignore the layer's
		// `draggable(false)`, so the per-node flag must match).
		const entitiesEnabled = get(interaction).entitiesEnabled;
		this.deps.playerManager.setPlayersDraggable(entitiesEnabled);
		this.deps.playersLayer.draggable(entitiesEnabled);
		this.deps.trailRenderer.clear();
		this.deps.updateRotationHandle();
	}

	/**
	 * Resets all authoring-view state (focus/dim, trails, live-tier, playback
	 * flag) without restoring dragging. Called defensively on replay entry and
	 * board reset so the invariant "no authoring residue survives into replay
	 * or editing" does not depend on component lifecycle order.
	 */
	resetView(): void {
		this.active = false;
		poseStore.abortGesture();
		poseStore.clearOverrides();
		this.deps.trailRenderer.clear();
		this.deps.clearFocusState();
		this.deps.playerManager.setFocus(null);
		setEntitySelection([]);
		directionControlActive.set(false);
		this.deps.updateRotationHandle();
	}

	/**
	 * Renders one frame of tweened entity poses during authored playback.
	 * Writes the poses into the PoseStore live tier, reprojects nodes, recomputes
	 * the pack/zone, and appends a motion-trail sample per entity.
	 */
	applyPoses(poses: EntityPose[]): void {
		for (const pose of poses) {
			poseStore.setLive(pose.id, { x: pose.x, y: pose.y, heading: pose.heading });
		}
		// draw=false on the composite steps: each layer is drawn exactly once,
		// at the end of the frame, instead of 2–3 times per frame.
		this.deps.playerManager.applyEffectivePoses(false);
		this.deps.getPackManager().determinePack(false);
		if (this.trailsEnabled) {
			this.deps.trailRenderer.push(poses);
			this.deps.trailLayer.batchDraw();
		}
		// The sampler already resolved every heading for this frame — reuse the
		// selected entity's instead of resolving it again in the handle update.
		this.deps.updateRotationHandle(
			poses.find((p) => p.id === get(selectedEntityId))?.heading ?? null
		);
		this.deps.engagementZoneLayer.batchDraw();
		this.deps.playersLayer.batchDraw();
	}

	/**
	 * Tweens from current board poses to target poses over the specified duration.
	 * Uses requestAnimationFrame for smooth animation with easing.
	 * Cancellable: a new tween cancels any in-flight tween. On completion,
	 * clears the live tier and reconciles to the document so no uncommitted
	 * poses survive to corrupt subsequent navigation or recordings.
	 */
	tweenToStep(targetPoses: EntityPose[], durationMs: number = 300, onComplete?: () => void): void {
		// Cancel any in-flight tween so only one runs at a time.
		if (this.tweenRafId !== null) {
			cancelAnimationFrame(this.tweenRafId);
			this.tweenRafId = null;
		}

		const currentPoses: EntityPose[] = poseStore.effectiveAll().map(({ entity, pose }) => ({
			id: entity.id,
			x: pose.x,
			y: pose.y,
			heading: pose.heading
		}));

		const startTime = performance.now();

		const animate = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / durationMs, 1);
			const easedProgress = easeInOutCubic(progress);

			const interpolatedPoses = tweenSteps(currentPoses, targetPoses, easedProgress);
			this.applyPoses(interpolatedPoses);

			if (progress < 1) {
				this.tweenRafId = requestAnimationFrame(animate);
			} else {
				// Tween complete: clear live tier and reconcile to document.
				this.tweenRafId = null;
				poseStore.abortGesture();
				this.deps.playerManager.renderFromDocument();
				onComplete?.();
			}
		};

		this.tweenRafId = requestAnimationFrame(animate);
	}

	/** Enables/disables the fading motion-trail tail during playback. */
	setTrailsEnabled(enabled: boolean): void {
		this.trailsEnabled = enabled;
		if (!enabled) this.deps.trailRenderer.clear();
	}

	/** Cancels an in-flight tween (owner teardown). */
	destroy(): void {
		if (this.tweenRafId !== null) {
			cancelAnimationFrame(this.tweenRafId);
			this.tweenRafId = null;
		}
	}
}
