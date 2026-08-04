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
		ChevronLeftOutline,
		ChevronRightOutline,
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

	// Auto-scroll the step row so the active card stays centered when the
	// active step changes (selection, nav, or playback). Only the strip's
	// horizontal scroll is adjusted — we compute a delta against the
	// container's rect and `scrollBy` it, so the page never scrolls.
	let scrollEl = $state<HTMLDivElement | undefined>();
	let chipEls: HTMLDivElement[] = $state([]);
	$effect(() => {
		const idx = activeChipIdx;
		const container = scrollEl;
		const el = chipEls[idx];
		if (!container || !el) return;
		const cr = container.getBoundingClientRect();
		const er = el.getBoundingClientRect();
		const delta = er.left + er.width / 2 - (cr.left + cr.width / 2);
		if (Math.abs(delta) > 1) container.scrollBy({ left: delta, behavior: 'smooth' });
	});

	// Directional edge fades: show a left fade only when scrolled away from
	// the start, a right fade only when more content lies to the right. The
	// native scrollbar is hidden (see the style block below), so these fades
	// are the only affordance that the row is scrollable on a given side.
	let canLeft = $state(false);
	let canRight = $state(false);

	function updateScrollFades() {
		const el = scrollEl;
		if (!el) return;
		canLeft = el.scrollLeft > 1;
		canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
	}

	const FADE = '18px';
	const mask = $derived(
		canLeft && canRight
			? `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`
			: canLeft
				? `linear-gradient(to right, transparent, black ${FADE}, black)`
				: canRight
					? `linear-gradient(to right, black, black calc(100% - ${FADE}), transparent)`
					: 'none'
	);
	const maskStyle = $derived(`mask-image: ${mask}; -webkit-mask-image: ${mask};`);

	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		const onScroll = () => updateScrollFades();
		updateScrollFades();
		el.addEventListener('scroll', onScroll, { passive: true });
		const ro = new ResizeObserver(() => updateScrollFades());
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
		};
	});

	// Re-check fades when the step count changes (add/remove changes
	// scrollWidth without necessarily firing a scroll event).
	$effect(() => {
		void steps.length;
		void activeChipIdx;
		queueMicrotask(updateScrollFades);
	});

	// Keep the board's pack-zone overlay in sync with the active step (except
	// during playback, which manages poses but still respects the last setting).
	$effect(() => {
		void $boardDoc;
		if (!game) return;
		pb.syncPackZone();
	});

	// Sync the scrub bar position to the active step when idle (not playing,
	// scrubbing, or in playback mode). Covers page reload — where the active
	// step is restored from persistence but currentTime starts at 0 — and
	// step-chip selection, which navigates without updating the scrub position.
	$effect(() => {
		if (playing || scrubbing || pb.player) return;
		void activeIdx;
		void steps.length;
		pb.syncTimeToActiveStep();
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
	function first() {
		pb.first();
	}
	function last() {
		pb.last();
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
	<!-- Rows sit directly on the BottomStrip shell, which owns the bar's
	     background/border — no per-row cards. -->
	<div class="pointer-events-auto flex w-full flex-col gap-1 px-2 py-1.5">
		<!-- Transport row: first | prev | play/pause | next | last | time |
		     speed | timeline | loop | focus. No overflow-x-auto here — the
		     scrub bar (flex-1 + min-w-0) absorbs width changes so the row never
		     scrolls. The step chips row below is the sole horizontal scroll zone. -->
		<div class="flex items-center gap-1">
			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={first}
				disabled={activeIdx <= 0}
				aria-label="Go to first step"
			>
				<BackwardStepOutline class="h-5 w-5" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={prev}
				disabled={activeIdx <= 0}
				aria-label="Previous step"
			>
				<ChevronLeftOutline class="h-5 w-5" />
			</ToolbarButton>

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
				onclick={next}
				disabled={activeIdx >= steps.length - 1}
				aria-label="Next step"
			>
				<ChevronRightOutline class="h-5 w-5" />
			</ToolbarButton>

			<ToolbarButton
				class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-gray-700 hover:bg-primary-200"
				onclick={last}
				disabled={activeIdx >= steps.length - 1}
				aria-label="Go to last step"
			>
				<ForwardStepOutline class="h-5 w-5" />
			</ToolbarButton>

			{#if canPlay}
				<span class="w-20 text-right text-xs tabular-nums text-gray-500">
					{fmt(currentTime)} / {fmt(duration)}
				</span>

				<ToolbarButton
					class="flex !my-0 min-h-9 min-w-9 items-center justify-center rounded-lg text-xs tabular-nums text-gray-700 hover:bg-primary-200"
					onclick={() => pb.cycleSpeed()}
					aria-label="Playback speed"
				>
					{SPEEDS[speedIdx]}×
				</ToolbarButton>

				<!-- Scrub bar (timeline). flex-1 + min-w-0 lets it shrink to absorb
			     width changes so the transport row never overflows/scrolls. -->
				<div
					bind:this={trackEl}
					class="relative flex h-9 min-w-0 flex-1 cursor-pointer items-center touch-none"
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
			{:else}
				<span class="px-2 text-xs text-gray-400">Add a path or another step to play</span>
			{/if}

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

		<!-- Step chips row. The scroll container holds the cards; the + Add
		     button is a flex sibling (not inside the scroller) so it never
		     overlays cards. When the cards fit, the container takes only its
		     content width and the + sits inline right after the last step;
		     when they overflow, the container shrinks (min-w-0) and scrolls,
		     leaving the + fixed at the right edge. The native scrollbar is
		     hidden; directional edge fades (mask-image) indicate scrollable
		     content on each side. -->
		<div class="flex items-stretch gap-1.5">
			<div
				bind:this={scrollEl}
				class="chip-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto touch-none"
				style={maskStyle}
			>
				{#each steps as step, i (step.id)}
					<div
						bind:this={chipEls[i]}
						class="group flex min-w-[5.5rem] flex-none cursor-pointer flex-col rounded-md border px-2 py-1.5 text-xs {i ===
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
						<span class="py-1 text-center text-sm font-semibold tabular-nums">Step {i + 1}</span>
						<div
							class="my-1 border-t {i === activeChipIdx ? 'border-primary-200' : 'border-gray-200'}"
						></div>
						<div class="flex items-center justify-around gap-2 pb-0.5">
							{#if steps.length > 1}
								<button
									type="button"
									class="rounded p-1 text-red-400 hover:bg-gray-200 hover:text-red-600"
									onclick={(e) => {
										e.stopPropagation();
										removeStep(step.id);
									}}
									aria-label="Delete step"
								>
									<TrashBinOutline class="h-4 w-4" />
								</button>
							{/if}
							<button
								type="button"
								class="rounded p-1 hover:bg-black/5"
								onclick={(e) => {
									e.stopPropagation();
									pb.playStep(i);
								}}
								aria-label={stepPlaybackIdx === i && playing ? 'Pause step' : 'Play step'}
							>
								{#if stepPlaybackIdx === i && playing}
									<PauseOutline class="h-4 w-4" />
								{:else}
									<PlayOutline class="h-4 w-4" />
								{/if}
							</button>
						</div>
					</div>
				{/each}
			</div>

			<!-- Add step: flex sibling of the scroller, so it never overlays cards.
		     Stretches to full row height; wider than a step card for an easy
		     target. Sits inline after the last step when there's room, fixed
		     at the right edge once the cards overflow. -->
			<button
				type="button"
				class="flex min-w-[3.5rem] flex-none items-center justify-center rounded-md border border-dashed border-gray-300 px-4 text-gray-400 hover:border-primary-400 hover:text-primary-500"
				onclick={addStep}
				aria-label="Add step"
			>
				<PlusOutline class="h-5 w-5" />
			</button>
		</div>
	</div>
{/if}

<style>
	/* Hide the native horizontal scrollbar on the step chips row. The row
	   still scrolls (overflow-x: auto): trackpad / shift+wheel gestures and
	   the auto-scroll-to-active behaviour drive navigation. Hiding the native
	   scrollbar removes the height it would add/remove — so the bar no longer
	   jumps when crossing the overflow threshold — and avoids cross-browser
	   scrollbar height/appearance differences. Directional edge fades
	   (mask-image, applied via inline style) indicate scrollable content. */
	.chip-scroll {
		scrollbar-width: none;
	}
	:global(.chip-scroll::-webkit-scrollbar) {
		display: none;
	}
</style>
