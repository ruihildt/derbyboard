<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ToolbarButton } from 'flowbite-svelte';
	import {
		PlayOutline,
		PauseOutline,
		PlusOutline,
		TrashBinOutline,
		BackwardStepOutline,
		ForwardStepOutline,
		RefreshOutline,
		StroopwafelOutline
	} from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import {
		getActiveClip,
		getActiveStep,
		activeStepIndex,
		navigateToStep,
		addStepFromBoard,
		deleteStep,
		moveStep
	} from '$lib/doc/clipOps';
	import { StepPlayback, SPEEDS } from '$lib/recording/authored/stepPlayback.svelte';
	import { authoringSession } from '$lib/stores/session';
	import { toolMode } from '$lib/stores/toolMode';
	import { selectedEntityId } from '$lib/stores/selection';
	import { MAX_STEPS_PER_CLIP } from '$lib/doc/types';

	let { game }: { game: KonvaGame } = $props();

	let clip = $derived($authoringSession.activeClipId ? getActiveClip($boardDoc) : undefined);
	let steps = $derived(clip?.steps ?? []);
	let activeIdx = $derived(activeStepIndex($boardDoc));
	/** Playback is possible with 2+ steps, or a single step that has a path. */
	let canPlay = $derived(steps.length >= 2 || steps.some((s) => s.paths && s.paths.length > 0));

	// Playback engine (player lifecycle, time, speed, loop, focus, tween nav).
	const pb = new StepPlayback(
		() => game,
		() => steps,
		() => clip,
		() => activeIdx,
		() => canPlay
	);
	let playing = $derived(pb.playing);
	let currentTime = $derived(pb.currentTime);
	let duration = $derived(pb.duration);
	let playbackStep = $derived(pb.playbackStep);
	let stepPlaybackIdx = $derived(pb.stepPlaybackIdx);
	let loop = $derived(pb.loop);
	let speedIdx = $derived(pb.speedIdx);
	let focusMode = $derived(pb.focusMode);
	let lastNavIdx = $derived(pb.lastNavIdx);

	// Scrub bar.
	let trackEl = $state<HTMLDivElement | undefined>();
	let scrubbing = $state(false);
	const pct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	const activeChipIdx = $derived(playing || scrubbing ? playbackStep : lastNavIdx);

	// Keep the board's pack-zone overlay in sync with the active step (except
	// during playback, which manages poses but still respects the last setting).
	$effect(() => {
		void $boardDoc;
		if (!game) return;
		pb.syncPackZone();
	});

	// Sync step overlays (paths, annotations, onion skin) on step/selection/tool changes.
	$effect(() => {
		void $boardDoc;
		void $toolMode;
		void $selectedEntityId;
		if (!game) return;
		if (!pb.player) {
			const step = getActiveStep();
			game.renderStepOverlays(step, $selectedEntityId);
		} else {
			// During playback, re-render paths for the current step so the
			// selected entity's path updates immediately on selection change.
			pb.renderPathsForStep(playbackStep);
		}
	});

	// If authoring is closed out from elsewhere, tear down playback.
	$effect(() => {
		pb.stopIfClipGone();
	});

	function selectStep(i: number) {
		if (playing || pb.player) pb.stopPlayback(false);
		navigateToStep(i);
	}

	function prev() {
		pb.prev();
	}
	function next() {
		pb.next();
	}

	function addStep() {
		if (playing || pb.player) pb.stopPlayback(false);
		addStepFromBoard();
	}

	function removeStep(id: string) {
		if (playing || pb.player) pb.stopPlayback(false);
		deleteStep(id);
	}

	// HTML5 drag reorder (desktop / pointer-capable touch).
	let dragIndex = $state<number | null>(null);
	function onChipDragStart(e: DragEvent, i: number) {
		dragIndex = i;
		e.dataTransfer?.setData('text/plain', String(i));
	}
	function onChipDrop(e: DragEvent, i: number) {
		e.preventDefault();
		if (dragIndex !== null && dragIndex !== i) moveStep(dragIndex, i);
		dragIndex = null;
	}

	// ---- Scrub --------------------------------------------------------------
	function seekFromClientX(clientX: number) {
		if (!trackEl || duration <= 0) return;
		const rect = trackEl.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		pb.seekTo(frac * duration);
	}
	function onScrubDown(e: PointerEvent) {
		scrubbing = true;
		trackEl?.setPointerCapture(e.pointerId);
		seekFromClientX(e.clientX);
	}
	function onScrubMove(e: PointerEvent) {
		if (scrubbing) seekFromClientX(e.clientX);
	}
	function onScrubUp(e: PointerEvent) {
		scrubbing = false;
		trackEl?.releasePointerCapture(e.pointerId);
	}

	function fmt(ms: number): string {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}

	onDestroy(() => {
		pb.destroy();
	});
</script>

{#if clip}
	<div class="pointer-events-auto flex w-full flex-col gap-2">
		<!-- Transport row -->
		<div
			class="flex items-center gap-1 overflow-x-auto rounded-lg bg-white px-2 py-1.5 shadow-lg shadow-black/10"
		>
			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200"
				onclick={() => pb.togglePlay()}
				disabled={!canPlay || stepPlaybackIdx !== null}
				aria-label={playing && stepPlaybackIdx === null ? 'Pause' : 'Play'}
			>
				{#if playing && stepPlaybackIdx === null}
					<PauseOutline class="h-5 w-5" />
				{:else}
					<PlayOutline class="h-5 w-5" />
				{/if}
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={prev}
				disabled={activeIdx <= 0}
				aria-label="Previous step"
			>
				<BackwardStepOutline class="h-5 w-5" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={next}
				disabled={activeIdx >= steps.length - 1}
				aria-label="Next step"
			>
				<ForwardStepOutline class="h-5 w-5" />
			</ToolbarButton>

			{#if canPlay}
				<!-- Scrub bar -->
				<div
					bind:this={trackEl}
					class="relative flex h-9 flex-1 cursor-pointer items-center touch-none"
					role="slider"
					aria-label="Scrub"
					aria-valuemin={0}
					aria-valuemax={duration}
					aria-valuenow={Math.round(currentTime)}
					tabindex={0}
					onpointerdown={onScrubDown}
					onpointermove={onScrubMove}
					onpointerup={onScrubUp}
				>
					<div
						class="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200"
					>
						<div
							class="absolute left-0 top-0 h-full rounded-full bg-primary-500"
							style="width: {pct}%"
						></div>
					</div>
				</div>
				<span class="w-20 text-right text-xs tabular-nums text-gray-500">
					{fmt(currentTime)} / {fmt(duration)}
				</span>
			{:else}
				<span class="px-2 text-xs text-gray-400">Add a path or another step to play</span>
			{/if}

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-xs tabular-nums text-gray-700 hover:bg-primary-200"
				onclick={() => pb.cycleSpeed()}
				aria-label="Playback speed"
			>
				{SPEEDS[speedIdx]}×
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200 {loop
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={() => pb.toggleLoop()}
				aria-label="Loop"
			>
				<RefreshOutline class="h-4 w-4" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200 {focusMode
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={() => pb.toggleFocus()}
				aria-label="Focus"
			>
				<StroopwafelOutline class="h-4 w-4" />
			</ToolbarButton>
		</div>

		<!-- Step chips row -->
		<div
			class="chip-scroll flex items-center gap-1.5 overflow-x-auto rounded-lg bg-white px-2 py-1.5 shadow-lg shadow-black/10 touch-none"
		>
			{#each steps as step, i (step.id)}
				<div
					class="group relative flex min-w-[5.5rem] flex-none cursor-pointer flex-col gap-0.5 rounded-md border px-2 py-1 text-xs {i ===
					activeChipIdx
						? 'border-primary-500 bg-primary-50 text-primary-700'
						: 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'}"
					role="button"
					tabindex={0}
					draggable={steps.length > 1}
					ondragstart={(e) => onChipDragStart(e, i)}
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => onChipDrop(e, i)}
					onclick={() => selectStep(i)}
					onkeydown={(e) => e.key === 'Enter' && selectStep(i)}
				>
					<div class="flex items-center gap-2">
						<div class="flex flex-col gap-0.5">
							<button
								type="button"
								class="rounded p-0.5 hover:bg-black/5"
								onclick={(e) => {
									e.stopPropagation();
									pb.playStep(i);
								}}
								aria-label={stepPlaybackIdx === i && playing ? 'Pause step' : 'Play step'}
							>
								{#if stepPlaybackIdx === i && playing}
									<PauseOutline class="h-3.5 w-3.5" />
								{:else}
									<PlayOutline class="h-3.5 w-3.5" />
								{/if}
							</button>
							{#if steps.length > 1}
								<button
									type="button"
									class="rounded p-0.5 text-red-400 hover:bg-red-50"
									onclick={(e) => {
										e.stopPropagation();
										removeStep(step.id);
									}}
									aria-label="Delete step"
								>
									<TrashBinOutline class="h-3.5 w-3.5" />
								</button>
							{/if}
						</div>
						<div class="h-4 w-px bg-gray-300"></div>
						<span class="text-4xl font-semibold tabular-nums">{i + 1}</span>
					</div>
				</div>
			{/each}
			{#if steps.length < MAX_STEPS_PER_CLIP}
				<button
					type="button"
					class="flex min-w-[2.5rem] flex-none items-center justify-center rounded-md border border-dashed border-gray-300 px-2 py-3 text-gray-400 hover:border-primary-400 hover:text-primary-500"
					onclick={addStep}
					aria-label="Add step"
				>
					<PlusOutline class="h-5 w-5" />
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.chip-scroll {
		scrollbar-width: thin;
		scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
	}
	:global(.chip-scroll::-webkit-scrollbar) {
		height: 5px;
	}
	:global(.chip-scroll::-webkit-scrollbar-track) {
		background: transparent;
	}
	:global(.chip-scroll::-webkit-scrollbar-thumb) {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 3px;
	}
</style>
