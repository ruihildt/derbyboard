import { get } from 'svelte/store';

import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { AuthoredClip, Step } from '$lib/doc/types';
import {
	getActiveStep,
	navigateToStep,
	loadStepOntoBoard,
	loadStepArrivalOntoBoard
} from '$lib/doc/clipOps';
import { AuthoredPlayer } from '$lib/recording/authored/AuthoredPlayer';
import { nearestStepAt, buildTimeline, STEP_DURATION_MS } from '$lib/track/tween';
import { selectedEntityIds } from '$lib/stores/selection';

export const SPEEDS = [0.25, 0.5, 0.75, 1];

/**
 * Playback engine for the step strip: owns the AuthoredPlayer lifecycle and
 * all playback view state (time, duration, active step chip, loop, speed,
 * focus/dim) so the StepStrip component only renders markup and wires events.
 *
 * Created during component init (uses $effect for state sync), destroyed from
 * the component's onDestroy.
 */
export class StepPlayback {
	player = $state<AuthoredPlayer | null>(null);
	playing = $state(false);
	currentTime = $state(0);
	duration = $state(0);
	playbackStep = $state(0);
	/** When non-null, a single step is being played (step-play mode). */
	stepPlaybackIdx = $state<number | null>(null);
	loop = $state(false);
	speedIdx = $state(0); // default 0.25×
	focusMode = $state(false);
	focusIds = $state<string[]>([]);

	// Local counter for rapid next/prev clicks. `activeIdx` is reactive and
	// may lag behind rapid successive clicks, so we track the last navigated
	// index here to ensure each click advances one step.
	lastNavIdx = $state(0);

	constructor(
		private getGame: () => KonvaGame,
		private getSteps: () => Step[],
		private getClip: () => AuthoredClip | undefined,
		private getActiveIdx: () => number,
		private getCanPlay: () => boolean
	) {
		$effect(() => {
			this.lastNavIdx = this.getActiveIdx();
		});

		// Keep duration in sync with the clip timeline so the scrub bar is
		// usable before playback starts.
		$effect(() => {
			if (this.getCanPlay()) {
				this.duration = buildTimeline(this.getSteps()).totalMs;
			} else {
				this.duration = 0;
			}
		});
	}

	/**
	 * Renders step overlays (paths + annotations) for a step index, computing
	 * prev/next steps directly from the steps array (not from the session,
	 * which may be stale during playback).
	 */
	renderPathsForStep(stepIdx: number): void {
		const steps = this.getSteps();
		const step = steps[stepIdx];
		if (!step) return;
		const prevStep = stepIdx > 0 ? steps[stepIdx - 1] : undefined;
		const nextStep = stepIdx < steps.length - 1 ? steps[stepIdx + 1] : undefined;
		const game = this.getGame();
		game.renderPaths(step, get(selectedEntityIds), prevStep, nextStep);
		game.renderAnnotations(step);
	}

	/** Steps back one step with a tween (duration scaled by playback speed). */
	prev(): void {
		if (this.playing || this.player) this.stopPlayback(false);
		this.tweenToIdx(Math.max(0, this.lastNavIdx - 1));
	}

	/** Steps forward one step with a tween (duration scaled by playback speed). */
	next(): void {
		if (this.playing || this.player) this.stopPlayback(false);
		this.tweenToIdx(Math.min(this.getSteps().length - 1, this.lastNavIdx + 1));
	}

	/** Jumps to the first step with a tween. */
	first(): void {
		if (this.playing || this.player) this.stopPlayback(false);
		this.tweenToIdx(0);
	}

	/** Jumps to the last step with a tween. */
	last(): void {
		if (this.playing || this.player) this.stopPlayback(false);
		this.tweenToIdx(this.getSteps().length - 1);
	}

	private tweenToIdx(targetIdx: number): void {
		this.lastNavIdx = targetIdx;
		const targetStep = this.getSteps()[targetIdx];
		if (!targetStep) return;
		const speed = SPEEDS[this.speedIdx];
		const baseDuration = 300;
		const duration = baseDuration / speed;
		// Update timeline UI immediately so scrub bar and chips stay in sync.
		const tl = buildTimeline(this.getSteps());
		let targetTime = 0;
		for (const seg of tl.segments) {
			if (seg.fromStep >= targetIdx) break;
			targetTime = seg.startMs + seg.durationMs;
		}
		this.currentTime = targetTime;
		this.playbackStep = targetIdx;
		navigateToStep(targetIdx, false);
		this.getGame().tweenToStep(targetStep.entities, duration, () => loadStepOntoBoard(targetIdx));
	}

	togglePlay(): void {
		const clip = this.getClip();
		if (!clip || !this.getCanPlay()) return;
		if (!this.player) {
			this.startPlayback();
			return;
		}
		this.player.toggle();
		this.playing = this.player.isPlaying();
		// When pausing, sync the active step to where playback stopped so
		// the chip highlight and doc state match the displayed board position.
		// navigateToStep(idx, false) updates the session index WITHOUT
		// reloading the board, so the LIVE-tier paused poses are preserved.
		if (!this.playing) {
			this.lastNavIdx = this.playbackStep;
			navigateToStep(this.playbackStep, false);
		}
	}

	private startPlayback(): void {
		const clip = this.getClip();
		if (!clip) return;
		this.stopPlayback(false);
		const startIdx = Math.max(0, this.getActiveIdx());
		const startMs = startIdx * STEP_DURATION_MS;
		const steps = this.getSteps();
		this.player = new AuthoredPlayer({
			game: this.getGame(),
			clip,
			onTick: (t) => {
				this.currentTime = t;
				// Update chip + path overlays only when the step's animation
				// completes (at step boundaries), not mid-tween.
				const stepIdx = Math.min(steps.length - 1, Math.floor(t / STEP_DURATION_MS));
				if (stepIdx !== this.playbackStep) {
					this.playbackStep = stepIdx;
					this.renderPathsForStep(stepIdx);
				}
			},
			onEnd: () => {
				this.playing = false;
				this.currentTime = this.duration;
				this.stopPlayback(true);
			}
		});
		this.duration = this.player.getDuration();
		this.player.setLoop(this.loop);
		this.player.setSpeed(SPEEDS[this.speedIdx]);
		this.getGame().beginAuthoredPlayback();
		if (this.focusMode) this.getGame().setFocus(this.focusIds);
		// Start from the currently selected step.
		this.playbackStep = startIdx;
		this.renderPathsForStep(startIdx);
		this.player.seek(startMs);
		this.currentTime = startMs;
		this.player.play();
		this.playing = this.player.isPlaying();
	}

	/** Plays a single step's animation in isolation (step-play mode). */
	playStep(i: number): void {
		// If this step is already being played, toggle pause/play.
		if (this.stepPlaybackIdx === i && this.player) {
			this.player.toggle();
			this.playing = this.player.isPlaying();
			return;
		}
		if (this.playing || this.player) this.stopPlayback(false);
		const clip = this.getClip();
		if (!clip) return;

		this.stepPlaybackIdx = i;
		this.playbackStep = i;
		const stepStartMs = i * STEP_DURATION_MS;
		const stepEndMs = stepStartMs + STEP_DURATION_MS;

		// Navigate to the step to load its start poses (no tween animation).
		navigateToStep(i, false);
		// Update path overlays to show this step's paths + adjacent context.
		const step = this.getSteps()[i];
		if (step) this.getGame().renderStepOverlays(step, get(selectedEntityIds));

		this.player = new AuthoredPlayer({
			game: this.getGame(),
			clip,
			onTick: (t) => {
				this.currentTime = t;
				if (t >= stepEndMs) {
					this.stopPlayback(false);
					navigateToStep(i);
					return;
				}
				// playbackStep stays at i — per-step playback never crosses
				// a step boundary, so the chip and path overlay must not tip
				// to the next step at the midpoint.
			},
			onEnd: () => {
				this.playing = false;
				this.stopPlayback(false);
				navigateToStep(i);
			}
		});

		this.duration = this.player.getDuration();
		this.player.setLoop(false);
		this.player.setSpeed(SPEEDS[this.speedIdx]);
		this.getGame().beginAuthoredPlayback();
		this.player.seek(stepStartMs);
		this.currentTime = stepStartMs;
		this.player.play();
		this.playing = this.player.isPlaying();
	}

	stopPlayback(settleStep: boolean): void {
		if (this.player) {
			this.player.destroy();
			this.player = null;
		}
		this.playing = false;
		this.stepPlaybackIdx = null;
		this.getGame().endAuthoredPlayback();
		if (settleStep) {
			// Load arrival poses (path endpoints) so entities show their
			// final positions after playback, not the start poses.
			const steps = this.getSteps();
			const stepIdx = Math.min(steps.length - 1, Math.max(0, this.playbackStep));
			loadStepArrivalOntoBoard(stepIdx);
			navigateToStep(stepIdx, false);
			const step = steps[stepIdx];
			if (step) this.getGame().renderStepOverlays(step, get(selectedEntityIds));
		}
	}

	toggleLoop(): void {
		this.loop = !this.loop;
		this.player?.setLoop(this.loop);
	}

	cycleSpeed(): void {
		this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
		this.player?.setSpeed(SPEEDS[this.speedIdx]);
	}

	toggleFocus(): void {
		this.focusMode = !this.focusMode;
		if (this.focusMode) {
			this.getGame().setFocusTap(true, (id) => {
				this.focusIds = this.focusIds.includes(id)
					? this.focusIds.filter((x) => x !== id)
					: [...this.focusIds, id].slice(-2);
				this.getGame().setFocus(this.focusIds);
			});
		} else {
			this.focusIds = [];
			this.getGame().setFocusTap(false, null);
		}
	}

	/** Seeks to `t` ms: drives the player when playing, else navigates the doc. */
	seekTo(t: number): void {
		if (this.player) {
			this.player.seek(t);
			this.currentTime = t;
			this.playbackStep = nearestStepAt(this.player.getTimeline(), t);
		} else {
			// Pre-playback: navigate to the nearest step in the clip timeline.
			const tl = buildTimeline(this.getSteps());
			const stepIdx = nearestStepAt(tl, t);
			if (stepIdx >= 0 && stepIdx !== this.getActiveIdx()) {
				navigateToStep(stepIdx);
			}
			this.currentTime = t;
			this.playbackStep = stepIdx;
		}
	}

	/**
	 * Syncs `currentTime` to the active step's timeline position. Called when
	 * idle (not playing / scrubbing / in playback mode) so the scrub bar fill
	 * reflects the selected step. This covers page reload — where the active
	 * step is restored from persistence but `currentTime` starts at 0 — and
	 * step-chip selection, which navigates without tweening.
	 */
	syncTimeToActiveStep(): void {
		const idx = this.getActiveIdx();
		const steps = this.getSteps();
		if (idx < 0 || steps.length === 0) return;
		const tl = buildTimeline(steps);
		let targetTime = 0;
		for (const seg of tl.segments) {
			if (seg.fromStep >= idx) break;
			targetTime = seg.startMs + seg.durationMs;
		}
		this.currentTime = targetTime;
	}

	/** If authoring is closed out from elsewhere, tear down playback. */
	stopIfClipGone(): void {
		if (!this.getClip() && this.player) this.stopPlayback(false);
	}

	/** Syncs the pack-zone overlay with the active step (pre-playback only). */
	syncPackZone(): void {
		if (!this.player) {
			const step = getActiveStep();
			this.getGame().setPackZoneVisible(step?.showPackZone ?? true);
		}
	}

	/** Teardown: stop playback, clear focus/trails/live-tier so replay or
	 * board reset starts from a clean slate regardless of lifecycle order. */
	destroy(): void {
		if (this.player) {
			this.player.destroy();
			this.player = null;
		}
		this.playing = false;
		this.getGame().endAuthoredPlayback();
		this.getGame().setFocusTap(false, null);
		this.getGame().setFocus(null);
		this.getGame().setTrailsEnabled(false);
	}
}
