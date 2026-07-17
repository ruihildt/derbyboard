import type { KonvaGame } from '$lib/konva/KonvaGame';
import type { TimelineProject } from './types';
import { interpolateSample } from './interpolate';

export interface TimelinePlayerOptions {
	game: KonvaGame;
	project: TimelineProject;
	audioBlob?: Blob | null;
	/** Fires whenever the displayed time advances (playback or seek). */
	onTick?: (timeMs: number) => void;
	/** Fires when playback reaches the end. */
	onEnd?: () => void;
	/** Fires when the effective duration changes (e.g. once audio metadata loads). */
	onDurationChange?: (durationMs: number) => void;
}

/**
 * Replays a captured timeline on the board. When audio is present it is the
 * master clock; otherwise a `performance.now()` clock drives playback. Supports
 * play/pause, scrubbing and 0.5×/1× speed.
 */
export class TimelinePlayer {
	private game: KonvaGame;
	private project: TimelineProject;
	private audioEl: HTMLAudioElement | null = null;
	private audioUrl: string | null = null;
	private onTick?: (timeMs: number) => void;
	private onEnd?: () => void;
	private onDurationChange?: (durationMs: number) => void;

	private playing = false;
	private speed = 1;
	private currentTime = 0;
	private rafId: number | null = null;

	// No-audio clock bookkeeping.
	private clockStart = 0; // performance.now() at clock (re)start
	private clockOffset = 0; // timeline time corresponding to clockStart

	// Playback length contributed by the audio track (0 until its metadata
	// loads). Lets a recording with audio but no board movement still play for
	// the audio's full length instead of ending at the empty movement timeline.
	private audioDurationMs = 0;

	constructor(opts: TimelinePlayerOptions) {
		this.game = opts.game;
		this.project = opts.project;
		this.onTick = opts.onTick;
		this.onEnd = opts.onEnd;
		this.onDurationChange = opts.onDurationChange;

		if (opts.audioBlob && opts.audioBlob.size > 0) {
			this.audioUrl = URL.createObjectURL(opts.audioBlob);
			this.audioEl = new Audio();
			this.audioEl.src = this.audioUrl;
			this.audioEl.playbackRate = this.speed;
			this.audioEl.addEventListener('ended', this.handleAudioEnded);
			this.audioEl.addEventListener('loadedmetadata', this.handleAudioMetadata);
		}
	}

	getDuration(): number {
		return Math.max(this.project.durationMs, this.audioDurationMs);
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

	hasAudio(): boolean {
		return this.audioEl !== null;
	}

	play(): void {
		if (this.playing) return;
		const duration = this.getDuration();
		if (duration <= 0) return;
		// Restart from the beginning if at the end.
		if (this.currentTime >= duration) {
			this.seek(0);
		}
		this.playing = true;

		if (this.audioEl) {
			this.audioEl.playbackRate = this.speed;
			this.audioEl.play().catch((e) => console.warn('TimelinePlayer: audio play failed', e));
			this.startAudioLoop();
		} else {
			this.clockOffset = this.currentTime;
			this.clockStart = performance.now();
			this.startClockLoop();
		}
	}

	pause(): void {
		if (!this.playing) return;
		this.playing = false;
		if (this.audioEl) {
			this.audioEl.pause();
		}
		this.cancelLoop();
	}

	toggle(): void {
		if (this.playing) this.pause();
		else this.play();
	}

	setSpeed(speed: number): void {
		this.speed = speed;
		if (this.audioEl) {
			this.audioEl.playbackRate = speed;
		} else if (this.playing) {
			// Rebase the clock so the current time stays continuous.
			this.clockOffset = this.currentTime;
			this.clockStart = performance.now();
		}
	}

	/** Scrubs to a time; updates the master clock and the board. */
	seek(t: number): void {
		const clamped = Math.max(0, Math.min(t, this.getDuration()));

		if (this.audioEl) {
			this.audioEl.currentTime = clamped / 1000;
		} else if (this.playing) {
			this.clockOffset = clamped;
			this.clockStart = performance.now();
		} else {
			this.clockOffset = clamped;
		}

		this.applyAt(clamped);
	}

	destroy(): void {
		this.pause();
		if (this.audioEl) {
			this.audioEl.removeEventListener('ended', this.handleAudioEnded);
			this.audioEl.removeEventListener('loadedmetadata', this.handleAudioMetadata);
			this.audioEl.src = '';
		}
		if (this.audioUrl) {
			URL.revokeObjectURL(this.audioUrl);
			this.audioUrl = null;
		}
	}

	private startAudioLoop(): void {
		const loop = (): void => {
			if (!this.playing) return;
			const t = (this.audioEl?.currentTime ?? 0) * 1000;
			this.applyAt(t);
			if (t >= this.getDuration()) {
				this.handleEnd();
				return;
			}
			this.rafId = requestAnimationFrame(loop);
		};
		this.rafId = requestAnimationFrame(loop);
	}

	private startClockLoop(): void {
		const loop = (): void => {
			if (!this.playing) return;
			const t = this.clockOffset + (performance.now() - this.clockStart) * this.speed;
			this.applyAt(t);
			if (t >= this.getDuration()) {
				this.handleEnd();
				return;
			}
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
		const sample = interpolateSample(this.project, clamped);
		this.game.applySnapshot(sample);
		this.onTick?.(clamped);
	}

	private handleEnd = (): void => {
		this.pause();
		this.applyAt(this.getDuration());
		this.onEnd?.();
	};

	private handleAudioEnded = (): void => {
		this.handleEnd();
	};

	private handleAudioMetadata = (): void => {
		const d = this.audioEl?.duration;
		if (typeof d === 'number' && isFinite(d) && d > 0) {
			this.audioDurationMs = d * 1000;
			this.onDurationChange?.(this.getDuration());
		}
	};
}
