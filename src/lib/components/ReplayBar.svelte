<script lang="ts">
	import { ToolbarButton, Tooltip } from 'flowbite-svelte';
	import { PlayOutline, PauseOutline, CloseCircleOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { loadProjectFile } from '$lib/recording/timeline/projectFile';
	import { TimelinePlayer } from '$lib/recording/timeline/TimelinePlayer';
	import type { TimelineFrame, TimelineProject } from '$lib/recording/timeline/types';

	let {
		game,
		onEnter,
		onExit,
		onLoadFrame,
		onLoadError,
		disabled = false
	}: {
		game: KonvaGame;
		onEnter?: () => void;
		onExit?: () => void;
		onLoadFrame?: (frame: TimelineFrame | null) => void;
		onLoadError?: (msg: string) => void;
		disabled?: boolean;
	} = $props();

	let player = $state<TimelinePlayer | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let speed = $state(1);

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
					err instanceof Error ? err.message : 'Invalid project file. Please select a .zip.'
				);
			}
		};
	}

	// Imperative entry point used by the recording bar's "Load replay" button.
	export function load() {
		handleOpenFile();
	}

	function enterReplay(project: TimelineProject, audioBlob: Blob | null) {
		closeReplay(false);

		game.setReplayMode(true);
		onEnter?.();

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
			}
		});

		duration = player.getDuration();
		speed = player.getSpeed();
		playing = false;
		currentTime = 0;
		player.seek(0);

		onLoadFrame?.(project.frame ?? null);
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
			onLoadFrame?.(null);
		}
		playing = false;
		currentTime = 0;
		duration = 0;
	}

	function togglePlay() {
		if (!player) return;
		player.toggle();
		playing = player.isPlaying();
	}

	function onScrub(e: Event) {
		if (!player) return;
		const t = Number((e.target as HTMLInputElement).value);
		player.seek(t);
		currentTime = t;
		playing = player.isPlaying();
	}

	function toggleSpeed() {
		if (!player) return;
		const next = speed === 1 ? 0.5 : 1;
		player.setSpeed(next);
		speed = next;
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
		class="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-white px-4 py-2 shadow-lg shadow-black/10"
	>
		<ToolbarButton
			class="flex items-center text-gray-700 hover:bg-primary-200"
			onclick={togglePlay}
			aria-label={playing ? 'Pause' : 'Play'}
		>
			{#if playing}
				<PauseOutline class="h-5 w-5" />
			{:else}
				<PlayOutline class="h-5 w-5" />
			{/if}
		</ToolbarButton>

		<div class="w-24 text-center text-xs tabular-nums text-gray-600">
			{fmt(currentTime)} / {fmt(duration)}
		</div>

		<input
			type="range"
			min="0"
			max={duration}
			step="10"
			value={currentTime}
			oninput={onScrub}
			class="h-1 w-64 cursor-pointer accent-primary-500"
		/>

		<ToolbarButton
			class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-primary-200"
			onclick={toggleSpeed}
			aria-label="Playback speed"
		>
			{speed}×
		</ToolbarButton>

		<div class="relative">
			<ToolbarButton
				class="flex items-center text-gray-700 hover:bg-red-100"
				onclick={() => closeReplay(true)}
				aria-label="Exit replay"
			>
				<CloseCircleOutline class="h-5 w-5" />
			</ToolbarButton>
			<Tooltip
				trigger="hover"
				arrow={false}
				color="primary"
				class="hidden whitespace-nowrap md:block">Exit replay</Tooltip
			>
		</div>
	</div>
{/if}
