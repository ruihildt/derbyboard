<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import {
		PlayOutline,
		PauseOutline,
		CloseOutline,
		ChevronDownOutline,
		VideoCameraOutline,
		ArchiveArrowDownOutline
	} from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { loadProjectFile, saveProjectFile } from '$lib/recording/timeline/projectFile';
	import { TimelinePlayer } from '$lib/recording/timeline/TimelinePlayer';
	import type { TimelineFrame, TimelineProject } from '$lib/recording/timeline/types';
	import { ASPECT_RATIO, type AspectRatio } from '$lib/utils/recording';
	import { isMobile } from '$lib/stores/viewport';
	import VideoExportDialog from './VideoExportDialog.svelte';

	let {
		game,
		onEnter,
		onExit,
		onLoadFrame,
		onLoadError,
		onNotice,
		disabled = false
	}: {
		game: KonvaGame;
		onEnter?: () => void;
		onExit?: () => void;
		onLoadFrame?: (frame: TimelineFrame | null, source: { w: number; h: number } | null) => void;
		onLoadError?: (msg: string) => void;
		onNotice?: (msg: string) => void;
		disabled?: boolean;
	} = $props();

	let player = $state<TimelinePlayer | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	// Interactive progression bar state.
	let trackEl = $state<HTMLDivElement | undefined>();
	let dragging = $state(false);
	const pct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	let proj = $state<TimelineProject | null>(null);
	let audio = $state<Blob | null>(null);
	let showExport = $state(false);

	// Export split-button caret.
	let caretRef = $state<HTMLDivElement | undefined>();
	let caretOpen = $state(false);

	$effect(() => {
		if (!caretOpen) return;
		function onPointerDown(e: PointerEvent) {
			if (caretRef && !caretRef.contains(e.target as Node)) caretOpen = false;
		}
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	function handleOpenFile() {
		if (disabled) return;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.zip,.derby.zip,application/zip';
		input.click();

		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			try {
				const { project, audioBlob } = await loadProjectFile(file);
				enterReplay(project, audioBlob);
			} catch (err) {
				console.error('[ReplayBar] load failed', err);
				onLoadError?.(
					err instanceof Error ? err.message : 'Invalid recording file. Please select a .zip.'
				);
			}
		};
	}

	// Imperative entry point used by the recording bar's "Load replay" button.
	export function load() {
		handleOpenFile();
	}

	// Imperative entry point used after a recording stops (preview before save).
	export function replay(project: TimelineProject, audioBlob: Blob | null) {
		enterReplay(project, audioBlob);
	}

	/**
	 * Converts a legacy project frame (which stored an aspect `ratio` plus
	 * width/center fractions) into the unified x/y/w/h fraction rect. New
	 * projects already use the unified shape and pass through unchanged.
	 */
	function normalizeFrame(frame: TimelineFrame | undefined): TimelineFrame | undefined {
		if (!frame) return frame;
		const r = frame.region as unknown as Record<string, number | undefined>;
		if (typeof r.widthFrac !== 'number' || typeof r.centerXFrac !== 'number') return frame;
		const ratio = ASPECT_RATIO[(frame as { ratio?: AspectRatio }).ratio ?? '16:9'] ?? 16 / 9;
		const stage = game.getStage();
		const sw = stage.width();
		const sh = stage.height();
		const cropW = r.widthFrac * sw;
		const cropH = cropW / ratio;
		const x = r.centerXFrac * sw - cropW / 2;
		const y = (r.centerYFrac ?? 0.5) * sh - cropH / 2;
		return {
			region: { xFrac: x / sw, yFrac: y / sh, wFrac: cropW / sw, hFrac: cropH / sh }
		};
	}

	function enterReplay(project: TimelineProject, audioBlob: Blob | null) {
		// Beyond the initial t=0 snapshot, there is nothing to replay. Show a
		// message instead of an empty replay bar, unless audio was captured —
		// then the bar still plays the audio over a static board.
		const hasMovement = project.samples.length > 1;
		const hasAudio = !!audioBlob && audioBlob.size > 0;
		if (!hasMovement && !hasAudio) {
			onNotice?.('Nothing to replay: no movement or audio was recorded.');
			return;
		}

		closeReplay(false);

		game.setReplayMode(true, project.source);
		onEnter?.();

		project.frame = normalizeFrame(project.frame);
		proj = project;
		audio = audioBlob;

		player = new TimelinePlayer({
			game,
			project,
			audioBlob,
			onTick: (t) => {
				currentTime = t;
			},
			onEnd: () => {
				playing = false;
				currentTime = duration;
			},
			onDurationChange: (d) => {
				duration = d;
			}
		});

		duration = player.getDuration();
		playing = false;
		currentTime = 0;
		player.seek(0);

		onLoadFrame?.(project.frame ?? null, project.source);
		onLoadError?.('');
	}

	function closeReplay(restore = true) {
		if (player) {
			player.destroy();
			player = null;
		}
		if (restore) {
			game.setReplayMode(false);
			onExit?.();
			onLoadFrame?.(null, null);
		}
		playing = false;
		currentTime = 0;
		duration = 0;
		proj = null;
		audio = null;
		showExport = false;
	}

	async function handleSave() {
		if (!proj) return;
		try {
			await saveProjectFile(proj, audio);
		} catch (e) {
			console.error('[ReplayBar] save failed', e);
			onLoadError?.('Failed to save recording.');
		}
	}

	// The exporter drives the stage directly; restore the board to the replay's
	// current position when the export dialog closes.
	function closeExport() {
		showExport = false;
		if (player) player.seek(currentTime);
	}

	function togglePlay() {
		if (!player) return;
		player.toggle();
		playing = player.isPlaying();
	}

	function seekTo(t: number) {
		if (!player) return;
		const clamped = Math.min(duration, Math.max(0, t));
		player.seek(clamped);
		currentTime = clamped;
		playing = player.isPlaying();
	}

	function seekFromClientX(clientX: number) {
		if (!trackEl || duration <= 0) return;
		const rect = trackEl.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		seekTo(frac * duration);
	}

	function onTrackPointerDown(e: PointerEvent) {
		dragging = true;
		trackEl?.setPointerCapture(e.pointerId);
		seekFromClientX(e.clientX);
	}

	function onTrackPointerMove(e: PointerEvent) {
		if (!dragging) return;
		seekFromClientX(e.clientX);
	}

	function onTrackPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		trackEl?.releasePointerCapture(e.pointerId);
	}

	function onTrackKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			seekTo(currentTime + (e.key === 'ArrowRight' ? 1000 : -1000));
			e.preventDefault();
		}
	}

	function fmt(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

{#if player}
	<div
		class="control-bar fixed bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex items-center bg-white shadow-lg shadow-black/10 {$isMobile
			? 'inset-x-0 gap-2 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]'
			: 'left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-3 rounded-lg px-2'}"
	>
		<ToolbarButton
			class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
			onclick={togglePlay}
			aria-label={playing ? 'Pause' : 'Play'}
		>
			{#if playing}
				<PauseOutline class="h-5 w-5" />
			{:else}
				<PlayOutline class="h-5 w-5" />
			{/if}
		</ToolbarButton>

		<div class:hidden={$isMobile} class="w-24 text-center text-xs tabular-nums text-gray-600">
			{fmt(currentTime)} / {fmt(duration)}
		</div>

		<div
			bind:this={trackEl}
			class="relative flex h-9 cursor-pointer items-center touch-none {$isMobile
				? 'w-auto min-w-[6rem] flex-1'
				: 'w-72 flex-none'}"
			role="slider"
			aria-label="Seek"
			aria-valuemin={0}
			aria-valuemax={duration}
			aria-valuenow={Math.round(currentTime)}
			tabindex={0}
			onpointerdown={onTrackPointerDown}
			onpointermove={onTrackPointerMove}
			onpointerup={onTrackPointerUp}
			onkeydown={onTrackKey}
		>
			<div
				class="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200"
			>
				<div
					class="absolute left-0 top-0 h-full rounded-full bg-primary-500 transition-[width] duration-75"
					style="width: {pct}%"
				></div>
				<div
					class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-primary-500"
					style="left: {pct}%"
				></div>
			</div>
		</div>

		<div bind:this={caretRef} class="relative flex items-center">
			<button
				type="button"
				class="flex min-h-9 items-center gap-1 whitespace-nowrap rounded-l-lg py-1 pl-2 pr-2 text-xs text-gray-700 hover:bg-primary-200"
				onclick={() => (showExport = true)}
				aria-label="Save as video"
			>
				<VideoCameraOutline class="h-5 w-5" />
				<span class:hidden={$isMobile}>Save as video</span>
			</button>
			<div class="w-px self-stretch bg-gray-200"></div>
			<button
				type="button"
				class="flex min-h-9 items-center rounded-r-lg px-2 py-1 text-gray-700 hover:bg-primary-200"
				onclick={() => (caretOpen = !caretOpen)}
				aria-label="More save options"
			>
				<ChevronDownOutline class="h-4 w-4" />
			</button>
			{#if caretOpen}
				<div class="absolute bottom-full right-0 z-40 mb-1 rounded-lg bg-white p-1 shadow-xl">
					<button
						class="flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100"
						onclick={() => {
							caretOpen = false;
							handleSave();
						}}
					>
						<ArchiveArrowDownOutline class="h-5 w-5" />
						Save recording (zip)
					</button>
				</div>
			{/if}
		</div>

		<button
			class="flex min-h-9 items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-red-200"
			onclick={() => closeReplay(true)}
			aria-label="Exit"
		>
			<CloseOutline class="h-4 w-4" />
			Exit
		</button>
	</div>
{/if}

{#if showExport && proj}
	<VideoExportDialog {game} project={proj} audioBlob={audio} onClose={closeExport} />
{/if}
