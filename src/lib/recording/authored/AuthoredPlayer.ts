import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { AuthoredClip } from '$lib/doc/types';
import { buildTimeline, sampleAuthoredAt, type AuthoredTimeline } from '$lib/track/tween';
import { resolveHeadings } from '$lib/track/heading';
import { boardSettings } from '$lib/stores/boardSettings';
import { get } from 'svelte/store';

export interface AuthoredPlayerOptions {
	game: KonvaGame;
	clip: AuthoredClip;
	/** Fires whenever the displayed time advances (playback or seek). */
	onTick?: (timeMs: number) => void;
	/** Fires when playback reaches the end (and is not looping). */
	onEnd?: () => void;
}

/**
 * Plays an authored clip's step sequence on the board with track-aware
 * tweening. Mirrors {@link TimelinePlayer}'s clock/seek/speed design (a
 * `performance.now()` rAF clock, seek rebasing, 0.25×/0.5×/1× speed, optional
 * loop) but drives the board from step keyframes via
 * {@link KonvaGame.applyAuthoredPoses} instead of captured samples.
 *
 * Playback is transient: it writes tweened poses into the PoseStore live tier
 * each frame and never touches the document or undo history. The caller is
 * responsible for {@link KonvaGame.beginAuthoredPlayback} /
 * {@link KonvaGame.endAuthoredPlayback} around the player's lifetime.
 */
export class AuthoredPlayer {
	private game: KonvaGame;
	private clip: AuthoredClip;
	private timeline: AuthoredTimeline;
	private onTick?: (timeMs: number) => void;
	private onEnd?: () => void;

	private playing = false;
	private speed = 1;
	private loop = false;
	private currentTime = 0;
	private rafId: number | null = null;

	private clockStart = 0; // performance.now() at clock (re)start
	private clockOffset = 0; // timeline time corresponding to clockStart

	constructor(opts: AuthoredPlayerOptions) {
		this.game = opts.game;
		this.clip = opts.clip;
		this.onTick = opts.onTick;
		this.onEnd = opts.onEnd;
		this.timeline = buildTimeline(opts.clip.steps);
	}

	getDuration(): number {
		return this.timeline.totalMs;
	}

	getCurrentTime(): number {
		return this.currentTime;
	}

	isPlaying(): boolean {
		return this.playing;
	}

	getSpeed(): number {
		return this.speed;
	}

	isLooping(): boolean {
		return this.loop;
	}

	getTimeline(): AuthoredTimeline {
		return this.timeline;
	}

	/** Coarse speed presets only — never a free numeric field (standing rule). */
	setSpeed(speed: number): void {
		this.speed = speed;
		if (this.playing) {
			// Rebase the clock so the current time stays continuous.
			this.clockOffset = this.currentTime;
			this.clockStart = performance.now();
		}
	}

	setLoop(loop: boolean): void {
		this.loop = loop;
	}

	play(): void {
		if (this.playing) return;
		const duration = this.getDuration();
		// A single-step clip has nothing to animate.
		if (duration <= 0) {
			this.applyAt(0);
			return;
		}
		if (this.currentTime >= duration) this.seek(0);
		this.playing = true;
		this.clockOffset = this.currentTime;
		this.clockStart = performance.now();
		this.startLoop();
	}

	pause(): void {
		if (!this.playing) return;
		this.playing = false;
		this.cancelLoop();
	}

	toggle(): void {
		if (this.playing) this.pause();
		else this.play();
	}

	/** Scrubs to a time and renders that frame immediately. */
	seek(t: number): void {
		const clamped = Math.max(0, Math.min(t, this.getDuration()));
		if (this.playing) {
			this.clockOffset = clamped;
			this.clockStart = performance.now();
		} else {
			this.clockOffset = clamped;
		}
		this.applyAt(clamped);
	}

	destroy(): void {
		this.pause();
	}

	private startLoop(): void {
		const loop = (): void => {
			if (!this.playing) return;
			const t = this.clockOffset + (performance.now() - this.clockStart) * this.speed;
			if (t >= this.getDuration()) {
				if (this.loop) {
					// Wrap and keep playing seamlessly.
					this.clockOffset = 0;
					this.clockStart = performance.now();
					this.applyAt(0);
					this.onTick?.(0);
					this.rafId = requestAnimationFrame(loop);
					return;
				}
				this.handleEnd();
				return;
			}
			this.applyAt(t);
			this.rafId = requestAnimationFrame(loop);
		};
		this.rafId = requestAnimationFrame(loop);
	}

	private cancelLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private applyAt(t: number): void {
		const clamped = Math.max(0, Math.min(t, this.getDuration()));
		this.currentTime = clamped;
		const poses = sampleAuthoredAt(this.timeline, this.stepPoseArrays(), clamped);
		this.game.applyAuthoredPoses(poses);
		this.onTick?.(clamped);
	}

	private stepPoseArrays(): Array<{ id: string; S: number; u: number; heading: number }[]> {
		const autoFace = get(boardSettings).autoFace ?? true;
		// Pre-resolve headings based on autoFace setting.
		const resolvedSteps = resolveHeadings(
			this.clip.steps.map((s) => s.entities),
			autoFace
		);
		return resolvedSteps;
	}

	private handleEnd = (): void => {
		this.pause();
		this.applyAt(this.getDuration());
		this.onEnd?.();
	};
}
