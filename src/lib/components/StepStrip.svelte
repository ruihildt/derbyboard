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
		loadStepOntoBoard,
		addStepFromBoard,
		deleteStep,
		moveStep,
		loadStepArrivalOntoBoard
	} from '$lib/doc/clipOps';
	import { AuthoredPlayer } from '$lib/recording/authored/AuthoredPlayer';
	import { nearestStepAt, buildTimeline, STEP_DURATION_MS } from '$lib/track/tween';
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

	// Local counter for rapid next/prev clicks. `activeIdx` is reactive and
	// may lag behind rapid successive clicks, so we track the last navigated
	// index here to ensure each click advances one step.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let lastNavIdx = $state(0);
	$effect(() => {
		lastNavIdx = activeIdx;
	});

	// Playback state.
	let player = $state<AuthoredPlayer | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let playbackStep = $state(0);
	/** When non-null, a single step is being played (step-play mode). */
	let stepPlaybackIdx = $state<number | null>(null);
	let loop = $state(false);
	const SPEEDS = [0.25, 0.5, 0.75, 1];
	let speedIdx = $state(0); // default 0.25×
	let focusMode = $state(false);
	let focusIds = $state<string[]>([]);

	// Keep duration in sync with the clip timeline so the scrub bar is usable
	// before playback starts.
	$effect(() => {
		if (canPlay) {
			duration = buildTimeline(steps).totalMs;
		} else {
			duration = 0;
		}
	});

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
		if (!player) {
			const step = getActiveStep();
			game.setPackZoneVisible(step?.showPackZone ?? true);
		}
	});

	// Sync step overlays (paths, annotations, onion skin) on step/selection/tool changes.
	$effect(() => {
		void $boardDoc;
		void $toolMode;
		void $selectedEntityId;
		if (!game) return;
		if (!player) {
			const step = getActiveStep();
			game.renderStepOverlays(step, $selectedEntityId);
		} else {
			// During playback, re-render paths for the current step so the
			// selected entity's path updates immediately on selection change.
			renderPathsForStep(playbackStep);
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
		const targetIdx = Math.max(0, lastNavIdx - 1);
		lastNavIdx = targetIdx;
		const targetStep = steps[targetIdx];
		if (targetStep && game) {
			const speed = SPEEDS[speedIdx];
			const baseDuration = 300;
			const duration = baseDuration / speed;
			// Update timeline UI immediately so scrub bar and chips stay in sync.
			const tl = buildTimeline(steps);
			let targetTime = 0;
			for (const seg of tl.segments) {
				if (seg.fromStep >= targetIdx) break;
				targetTime = seg.startMs + seg.durationMs;
			}
			currentTime = targetTime;
			playbackStep = targetIdx;
			navigateToStep(targetIdx, false);
			game.tweenToStep(targetStep.entities, duration, () => loadStepOntoBoard(targetIdx));
		}
	}
	function next() {
		if (playing || player) stopPlayback(false);
		const targetIdx = Math.min(steps.length - 1, lastNavIdx + 1);
		lastNavIdx = targetIdx;
		const targetStep = steps[targetIdx];
		if (targetStep && game) {
			const speed = SPEEDS[speedIdx];
			const baseDuration = 300;
			const duration = baseDuration / speed;
			// Update timeline UI immediately so scrub bar and chips stay in sync.
			const tl = buildTimeline(steps);
			let targetTime = 0;
			for (const seg of tl.segments) {
				if (seg.fromStep >= targetIdx) break;
				targetTime = seg.startMs + seg.durationMs;
			}
			currentTime = targetTime;
			playbackStep = targetIdx;
			navigateToStep(targetIdx, false);
			game.tweenToStep(targetStep.entities, duration, () => loadStepOntoBoard(targetIdx));
		}
	}

	function addStep() {
		if (playing || player) stopPlayback(false);
		addStepFromBoard();
	}

	function playStep(i: number) {
		// If this step is already being played, toggle pause/play.
		if (stepPlaybackIdx === i && player) {
			player.toggle();
			playing = player.isPlaying();
			return;
		}
		if (playing || player) stopPlayback(false);
		if (!game || !clip) return;

		stepPlaybackIdx = i;
		playbackStep = i;
		const stepStartMs = i * STEP_DURATION_MS;
		const stepEndMs = stepStartMs + STEP_DURATION_MS;

		// Navigate to the step to load its start poses (no tween animation).
		navigateToStep(i, false);
		// Update path overlays to show this step's paths + adjacent context.
		const step = steps[i];
		if (step && game) game.renderStepOverlays(step, $selectedEntityId);

		player = new AuthoredPlayer({
			game,
			clip,
			onTick: (t) => {
				currentTime = t;
				if (t >= stepEndMs) {
					stopPlayback(false);
					navigateToStep(i);
					return;
				}
				// playbackStep stays at i — per-step playback never crosses
				// a step boundary, so the chip and path overlay must not tip
				// to the next step at the midpoint.
			},
			onEnd: () => {
				playing = false;
				stopPlayback(false);
				navigateToStep(i);
			}
		});

		duration = player.getDuration();
		player.setLoop(false);
		player.setSpeed(SPEEDS[speedIdx]);
		game.beginAuthoredPlayback();
		player.seek(stepStartMs);
		currentTime = stepStartMs;
		player.play();
		playing = player.isPlaying();
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
		if (!clip || !canPlay) return;
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
		const startIdx = Math.max(0, activeIdx);
		const startMs = startIdx * STEP_DURATION_MS;
		player = new AuthoredPlayer({
			game,
			clip,
			onTick: (t) => {
				currentTime = t;
				// Update chip + path overlays only when the step's animation
				// completes (at step boundaries), not mid-tween.
				const stepIdx = Math.min(steps.length - 1, Math.floor(t / STEP_DURATION_MS));
				if (stepIdx !== playbackStep) {
					playbackStep = stepIdx;
					renderPathsForStep(stepIdx);
				}
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
		if (focusMode) game.setFocus(focusIds);
		// Start from the currently selected step.
		playbackStep = startIdx;
		renderPathsForStep(startIdx);
		player.seek(startMs);
		currentTime = startMs;
		player.play();
		playing = player.isPlaying();
	}

	/**
	 * Renders path overlays for a step index, computing prev/next steps
	 * directly from the steps array (not from the session, which may be
	 * stale during playback).
	 */
	function renderPathsForStep(stepIdx: number): void {
		if (!game) return;
		const step = steps[stepIdx];
		if (!step) return;
		const prevStep = stepIdx > 0 ? steps[stepIdx - 1] : undefined;
		const nextStep = stepIdx < steps.length - 1 ? steps[stepIdx + 1] : undefined;
		game.renderPaths(step, $selectedEntityId, prevStep, nextStep);
	}

	function stopPlayback(settleStep: boolean) {
		if (player) {
			player.destroy();
			player = null;
		}
		playing = false;
		stepPlaybackIdx = null;
		if (game) game.endAuthoredPlayback();
		if (settleStep) {
			// Load arrival poses (path endpoints) so entities show their
			// final positions after playback, not the start poses.
			const stepIdx = Math.min(steps.length - 1, Math.max(0, playbackStep));
			loadStepArrivalOntoBoard(stepIdx);
			navigateToStep(stepIdx, false);
			const step = steps[stepIdx];
			if (step && game) game.renderStepOverlays(step, $selectedEntityId);
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

	// ---- Scrub --------------------------------------------------------------
	function seekFromClientX(clientX: number) {
		if (!trackEl || duration <= 0) return;
		const rect = trackEl.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const t = frac * duration;
		if (player) {
			player.seek(t);
			currentTime = t;
			playbackStep = nearestStepAt(player.getTimeline(), t);
		} else {
			// Pre-playback: navigate to the nearest step in the clip timeline.
			const tl = buildTimeline(steps);
			const stepIdx = nearestStepAt(tl, t);
			if (stepIdx >= 0 && stepIdx !== activeIdx) {
				navigateToStep(stepIdx);
			}
			currentTime = t;
			playbackStep = stepIdx;
		}
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
	<div class="pointer-events-auto flex w-full flex-col gap-2">
		<!-- Transport row -->
		<div
			class="flex items-center gap-1 overflow-x-auto rounded-lg bg-white px-2 py-1.5 shadow-lg shadow-black/10"
		>
			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200"
				onclick={togglePlay}
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
				onclick={cycleSpeed}
				aria-label="Playback speed"
			>
				{SPEEDS[speedIdx]}×
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200 {loop
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={toggleLoop}
				aria-label="Loop"
			>
				<RefreshOutline class="h-4 w-4" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200 {focusMode
					? 'bg-primary-100 text-primary-700'
					: ''}"
				onclick={toggleFocus}
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
									playStep(i);
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
