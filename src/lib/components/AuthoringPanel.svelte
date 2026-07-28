<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ToolbarButton } from 'flowbite-svelte';
	import {
		PlayOutline,
		PauseOutline,
		CloseOutline,
		PlusOutline,
		FileCopyOutline,
		TrashBinOutline,
		ArrowLeftOutline,
		ArrowRightOutline,
		RefreshOutline,
		LayersOutline,
		CameraPhotoOutline
	} from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import {
		getActiveClip,
		getActiveStep,
		activeStepIndex,
		navigateToStep,
		loadStepOntoBoard,
		addStepFromBoard,
		duplicateActiveStep,
		deleteStep,
		moveStep,
		exitAuthoring
	} from '$lib/doc/clipOps';
	import { AuthoredPlayer } from '$lib/recording/authored/AuthoredPlayer';
	import { nearestStepAt } from '$lib/track/tween';
	import { isMobile } from '$lib/stores/viewport';
	import { authoringSession } from '$lib/stores/session';

	let { game }: { game: KonvaGame } = $props();

	let clip = $derived($authoringSession.activeClipId ? getActiveClip($boardDoc) : undefined);
	let steps = $derived(clip?.steps ?? []);
	let activeIdx = $derived(activeStepIndex($boardDoc));

	// Playback state.
	let player = $state<AuthoredPlayer | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let playbackStep = $state(0);
	let loop = $state(false);
	const SPEEDS = [0.25, 0.5, 1];
	let speedIdx = $state(2); // default 1×
	let showTrails = $state(false);
	let focusMode = $state(false);
	let focusIds = $state<string[]>([]);

	// Scrub bar.
	let trackEl = $state<HTMLDivElement | undefined>();
	let scrubbing = $state(false);
	const pct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	const activeChipIdx = $derived(playing ? playbackStep : activeIdx);

	// Keep the board's pack-zone overlay in sync with the active step (except
	// during playback, which manages poses but still respects the last setting).
	$effect(() => {
		void $boardDoc;
		if (!game) return;
		if (!player) {
			const step = getActiveStep();
			game.setPackZoneVisible(step?.showPackZone ?? true);
		}
	});

	// If authoring is closed out from elsewhere, tear down playback.
	$effect(() => {
		if (!clip && player) stopPlayback(false);
	});

	function selectStep(i: number) {
		if (playing || player) stopPlayback(false);
		navigateToStep(i);
	}

	function prev() {
		if (playing || player) stopPlayback(false);
		const targetIdx = Math.max(0, activeIdx - 1);
		const targetStep = steps[targetIdx];
		if (targetStep && game) {
			const speed = SPEEDS[speedIdx];
			const baseDuration = 300;
			const duration = baseDuration / speed;
			// Update session index first, then tween; on completion, load the
			// target step onto the board so the document reflects the new state.
			navigateToStep(targetIdx, false);
			game.tweenToStep(targetStep.entities, duration, () => loadStepOntoBoard(targetIdx));
		}
	}
	function next() {
		if (playing || player) stopPlayback(false);
		const targetIdx = Math.min(steps.length - 1, activeIdx + 1);
		const targetStep = steps[targetIdx];
		if (targetStep && game) {
			const speed = SPEEDS[speedIdx];
			const baseDuration = 300;
			const duration = baseDuration / speed;
			// Update session index first, then tween; on completion, load the
			// target step onto the board so the document reflects the new state.
			navigateToStep(targetIdx, false);
			game.tweenToStep(targetStep.entities, duration, () => loadStepOntoBoard(targetIdx));
		}
	}

	function addStep() {
		if (playing || player) stopPlayback(false);
		addStepFromBoard();
	}

	function duplicateStep(i: number) {
		if (playing || player) stopPlayback(false);
		navigateToStep(i);
		duplicateActiveStep();
	}

	function removeStep(id: string) {
		if (playing || player) stopPlayback(false);
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

	// ---- Playback -----------------------------------------------------------
	function togglePlay() {
		if (!clip || steps.length < 2) return;
		if (!player) {
			startPlayback();
			return;
		}
		player.toggle();
		playing = player.isPlaying();
	}

	function startPlayback() {
		if (!clip || !game) return;
		stopPlayback(false);
		player = new AuthoredPlayer({
			game,
			clip,
			onTick: (t) => {
				currentTime = t;
				playbackStep = nearestStepAt(player!.getTimeline(), t);
			},
			onEnd: () => {
				playing = false;
				currentTime = duration;
				stopPlayback(true);
			}
		});
		duration = player.getDuration();
		player.setLoop(loop);
		player.setSpeed(SPEEDS[speedIdx]);
		game.beginAuthoredPlayback();
		game.setTrailsEnabled(showTrails);
		if (focusMode) game.setFocus(focusIds);
		currentTime = 0;
		player.play();
		playing = player.isPlaying();
	}

	function stopPlayback(settleStep: boolean) {
		if (player) {
			player.destroy();
			player = null;
		}
		playing = false;
		if (game) game.endAuthoredPlayback();
		if (settleStep) {
			// Land on the step nearest where playback stopped.
			navigateToStep(Math.min(steps.length - 1, Math.max(0, playbackStep)));
		}
	}

	function toggleLoop() {
		loop = !loop;
		player?.setLoop(loop);
	}

	function cycleSpeed() {
		speedIdx = (speedIdx + 1) % SPEEDS.length;
		player?.setSpeed(SPEEDS[speedIdx]);
	}

	function toggleTrails() {
		showTrails = !showTrails;
		if (game) game.setTrailsEnabled(showTrails && !!player);
	}

	function toggleFocus() {
		focusMode = !focusMode;
		if (focusMode) {
			if (game) {
				game.setFocusTap(true, (id) => {
					focusIds = focusIds.includes(id)
						? focusIds.filter((x) => x !== id)
						: [...focusIds, id].slice(-2);
					game.setFocus(focusIds);
				});
			}
		} else {
			focusIds = [];
			if (game) game.setFocusTap(false, null);
		}
	}

	/** Screenshot of the current step via the existing capture path (P3 task 11). */
	function screenshot() {
		if (playing || !game) return;
		const dataUrl = game.exportAsImage(2, 'medium');
		const link = document.createElement('a');
		link.download = `derbyboard-step-${activeIdx + 1}-${new Date().toISOString().slice(0, 10)}.png`;
		link.href = dataUrl;
		link.click();
	}

	function exit() {
		stopPlayback(false);
		exitAuthoring();
	}

	// ---- Scrub --------------------------------------------------------------
	function seekFromClientX(clientX: number) {
		if (!player || !trackEl || duration <= 0) return;
		const rect = trackEl.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const t = frac * duration;
		player.seek(t);
		currentTime = t;
		playbackStep = nearestStepAt(player.getTimeline(), t);
	}
	function onScrubDown(e: PointerEvent) {
		if (!player) return;
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
		// Teardown: stop playback, clear focus/trails/live-tier so replay
		// or board reset starts from a clean slate regardless of lifecycle order.
		if (player) {
			player.destroy();
			player = null;
		}
		playing = false;
		if (game) {
			game.endAuthoredPlayback();
			game.setFocusTap(false, null);
			game.setFocus(null);
			game.setTrailsEnabled(false);
		}
	});
</script>

{#if clip}
	<div
		class="fixed top-[max(0.5rem,env(safe-area-inset-top))] left-1/2 z-40 flex -translate-x-1/2 flex-col gap-2 {$isMobile
			? 'max-w-[calc(100vw-1rem)]'
			: 'max-w-[calc(100vw-2rem)]'}"
	>
		<!-- Controls bar -->
		<div
			class="flex items-center gap-1 overflow-hidden rounded-lg bg-white px-2 py-1.5 shadow-lg shadow-black/10"
		>
			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={exit}
				aria-label="Exit drill"
			>
				<CloseOutline class="h-5 w-5" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={prev}
				disabled={activeIdx <= 0}
				aria-label="Previous step"
			>
				<ArrowLeftOutline class="h-5 w-5" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200"
				onclick={togglePlay}
				disabled={steps.length < 2}
				aria-label={playing ? 'Pause' : 'Play'}
			>
				{#if playing}
					<PauseOutline class="h-5 w-5" />
				{:else}
					<PlayOutline class="h-5 w-5" />
				{/if}
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={next}
				disabled={activeIdx >= steps.length - 1}
				aria-label="Next step"
			>
				<ArrowRightOutline class="h-5 w-5" />
			</ToolbarButton>

			{#if steps.length >= 2}
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
				<span class="px-2 text-xs text-gray-400">Add a 2nd step to play</span>
			{/if}

			<ToolbarButton
				class="flex !my-0 min-h-9 items-center justify-center rounded-lg px-2 text-xs tabular-nums text-gray-700 hover:bg-primary-200 {loop
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={toggleLoop}
				aria-label="Loop"
			>
				<RefreshOutline class="h-4 w-4" />
				<span class:hidden={$isMobile}>Loop</span>
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-xs tabular-nums text-gray-700 hover:bg-primary-200"
				onclick={cycleSpeed}
				aria-label="Playback speed"
			>
				{SPEEDS[speedIdx]}×
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200 {showTrails
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={toggleTrails}
				aria-label="Motion trails"
			>
				<LayersOutline class="h-4 w-4" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs text-gray-700 hover:bg-primary-200 {focusMode
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={toggleFocus}
				aria-label="Focus"
			>
				Focus{#if focusMode && focusIds.length}&nbsp;{focusIds.length}{/if}
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={screenshot}
				disabled={playing}
				aria-label="Screenshot step"
			>
				<CameraPhotoOutline class="h-4 w-4" />
			</ToolbarButton>
		</div>

		<!-- Step chips bar -->
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
									duplicateStep(i);
								}}
								aria-label="Duplicate step"
							>
								<FileCopyOutline class="h-3.5 w-3.5" />
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
			<button
				type="button"
				class="flex min-w-[2.5rem] flex-none items-center justify-center rounded-md border border-dashed border-gray-300 px-2 py-3 text-gray-400 hover:border-primary-400 hover:text-primary-500"
				onclick={addStep}
				aria-label="Add step"
			>
				<PlusOutline class="h-5 w-5" />
			</button>
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
