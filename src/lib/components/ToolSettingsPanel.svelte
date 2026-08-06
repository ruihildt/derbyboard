<script lang="ts">
	import {
		FileCopyAltOutline,
		TrashBinOutline,
		ImageOutline,
		VideoCameraOutline
	} from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { toolMode } from '$lib/stores/toolMode';
	import {
		labelSettings,
		labelBasePx,
		LABEL_FONT_PX,
		type LabelSize
	} from '$lib/stores/labelSettings';
	import { exportSettings, type ImageScale, type VideoFps } from '$lib/stores/exportSettings';
	import { boardSettings } from '$lib/stores/boardSettings';
	import { selectedAnnotationId } from '$lib/stores/selection';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import {
		deleteAnnotation,
		duplicateAnnotation,
		setAnnotationScope,
		setAnnotationScopeRange,
		setAnnotationFontSize
	} from '$lib/doc/clipOps';
	import { scopeBounds, scopeModeOf } from '$lib/doc/annotationScope';
	import type { PlanarPoint } from '$lib/doc/types';
	import type { WatermarkSize } from '$lib/konva/Watermark';
	import type { Quality } from '$lib/utils/codec';
	import {
		CAPTURE_FORMATS,
		FORMAT_LABELS_SHORT,
		formatRatio,
		type CaptureFormat
	} from '$lib/utils/capture';

	let { game }: { game: KonvaGame } = $props();

	let captureMode = $derived(
		$toolMode === 'video' || $toolMode === 'screenshot' ? $toolMode : null
	);
	let isLabel = $derived($toolMode === 'label');
	let isSelect = $derived($toolMode === 'select');
	let isHand = $derived($toolMode === 'hand');

	// The selected annotation (if any) when the select tool is armed.
	let selectedAnn = $derived(
		$toolMode === 'select' && $selectedAnnotationId
			? $boardDoc.annotations?.find((a) => a.id === $selectedAnnotationId)
			: undefined
	);

	// Active step context for the scope toggle.
	let clip = $derived($boardDoc.clips.find((c) => c.id === $boardDoc.activeClipId));
	let steps = $derived(clip && clip.kind === 'authored' ? clip.steps : []);
	let activeStep = $derived(
		clip && clip.kind === 'authored'
			? clip.steps[Math.max(0, Math.min($authoringSession.activeStepIndex, clip.steps.length - 1))]
			: undefined
	);
	let hasStep = $derived(!!activeStep);
	let canRange = $derived(steps.length >= 2);
	// Current scope mode + resolved range bounds (inclusive step indices).
	let scopeMode = $derived(selectedAnn ? scopeModeOf(selectedAnn) : 'all');
	let rangeBounds = $derived(selectedAnn ? scopeBounds(selectedAnn.scope, steps) : null);
	// Step number for the "Current (Step N)" pill: the pinned step when
	// scoped to a single step, otherwise the active step as a preview.
	let currentStepNum = $derived.by(() => {
		if (selectedAnn?.scope && !selectedAnn.scope.endStepId) {
			const idx = steps.findIndex((s) => s.id === selectedAnn.scope!.stepId);
			return idx >= 0 ? idx + 1 : null;
		}
		if (activeStep) {
			const idx = steps.findIndex((s) => s.id === activeStep.id);
			return idx >= 0 ? idx + 1 : null;
		}
		return null;
	});

	// Reverse-map a label's pixel fontSize to the nearest LabelSize token so
	// the font-size pills highlight the current size.
	function labelSizeFromPx(px: number | undefined): LabelSize {
		if (px == null) return 'S';
		for (const [size, val] of Object.entries(LABEL_FONT_PX)) {
			if (val === px) return size as LabelSize;
		}
		let closest: LabelSize = 'M';
		let minDiff = Infinity;
		for (const [size, val] of Object.entries(LABEL_FONT_PX)) {
			const diff = Math.abs(val - px);
			if (diff < minDiff) {
				minDiff = diff;
				closest = size as LabelSize;
			}
		}
		return closest;
	}

	function pill(active: boolean): string {
		return `rounded px-2 py-1 text-xs ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
	}

	function setFormat(format: CaptureFormat) {
		captureSettings.update((s) => ({
			...s,
			format,
			zone: format === 'full' ? s.zone : game.defaultZone(formatRatio(format))
		}));
	}

	function changeLabelSize(size: LabelSize) {
		if ($selectedAnnotationId) setAnnotationFontSize($selectedAnnotationId, labelBasePx(size));
	}

	// Scope mode handlers for the segmented control + From/To selects.
	function setScopeAll() {
		const id = $selectedAnnotationId;
		if (id) setAnnotationScope(id, null);
	}
	function setScopeCurrent() {
		const id = $selectedAnnotationId;
		if (id && activeStep) setAnnotationScope(id, activeStep.id);
	}
	function setScopeRange() {
		const id = $selectedAnnotationId;
		if (!id || steps.length < 2) return;
		// Already in range mode — keep the existing range untouched.
		if (scopeMode === 'range' && rangeBounds) return;
		// Default From to the current step, To to the last step. If the
		// current step IS the last step this would collapse to a single step,
		// so fall back From to the first step.
		let fromId = activeStep ? activeStep.id : steps[0].id;
		const toId = steps[steps.length - 1].id;
		if (fromId === toId) fromId = steps[0].id;
		setAnnotationScopeRange(id, fromId, toId);
	}
	function setRangeFrom(fromId: string) {
		const id = $selectedAnnotationId;
		if (!id) return;
		const toId = rangeBounds ? steps[rangeBounds.hi].id : steps[steps.length - 1].id;
		setAnnotationScopeRange(id, fromId, toId);
	}
	function setRangeTo(toId: string) {
		const id = $selectedAnnotationId;
		if (!id) return;
		const fromId = rangeBounds ? steps[rangeBounds.lo].id : steps[0].id;
		setAnnotationScopeRange(id, fromId, toId);
	}

	// Label for a step in the From/To dropdowns: "Step N" (+ " — title").
	function stepOptionLabel(i: number): string {
		const s = steps[i];
		const title = s?.title?.trim();
		return title ? `Step ${i + 1} — ${title}` : `Step ${i + 1}`;
	}

	// Converts a desired SCREEN-space pixel offset into planar metres via two
	// planeToScreen probes, so the nudge looks like "a bit" at any zoom level.
	function planarOffsetFromScreen(dxPx: number, dyPx: number): PlanarPoint {
		const o = game.planeToScreen({ x: 0, y: 0 });
		const pxPerMetreX = game.planeToScreen({ x: 1, y: 0 }).x - o.x;
		const pxPerMetreY = game.planeToScreen({ x: 0, y: 1 }).y - o.y;
		return { x: dxPx / pxPerMetreX, y: dyPx / pxPerMetreY };
	}

	function duplicateSelected() {
		const id = $selectedAnnotationId;
		if (!id) return;
		// Nudge right (+x) and down (+y) by ~24 screen pixels.
		const delta = planarOffsetFromScreen(24, 24);
		const newId = duplicateAnnotation(id, delta);
		if (newId) selectedAnnotationId.set(newId);
	}

	function deleteSelected() {
		const id = $selectedAnnotationId;
		if (!id) return;
		deleteAnnotation(id);
		selectedAnnotationId.set(null);
	}

	/** Rotates the whole board (track + drawings) by `delta` degrees, snapped
	 * to 90° steps and wrapped into [0, 360). KonvaGame subscribes to the
	 * setting and applies the view rotation. */
	function rotateBoard(delta: number) {
		const cur = $boardSettings.boardRotation ?? 0;
		let next = (cur + delta) % 360;
		if (next < 0) next += 360;
		boardSettings.update((s) => ({ ...s, boardRotation: next }));
	}

	const QUALITIES: Quality[] = ['720p', '1080p', '1440p', '2160p'];
	const FPS_OPTIONS: VideoFps[] = [30, 60];
	const SCALE_OPTIONS: ImageScale[] = [1, 2, 3, 4];
	const WATERMARK_SIZES: WatermarkSize[] = ['hidden', 'small', 'medium', 'large'];
	const WATERMARK_LABELS: Record<WatermarkSize, string> = {
		hidden: 'Hidden',
		small: 'Small',
		medium: 'Medium',
		large: 'Large'
	};
	const FONT_SIZES: LabelSize[] = ['S', 'M', 'L', 'XL'];
</script>

{#if captureMode}
	<div class="pointer-events-auto w-60 rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
		<!-- Resolution: video qualities or image scale -->
		{#if captureMode === 'video'}
			<section class="mb-4">
				<h3
					class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
				>
					<VideoCameraOutline class="h-3.5 w-3.5" />
					Resolution
				</h3>
				<div class="flex flex-wrap gap-1">
					{#each QUALITIES as q (q)}
						<button
							class={pill($exportSettings.video.resolution === q)}
							onclick={() => ($exportSettings.video = { ...$exportSettings.video, resolution: q })}
							>{q}</button
						>
					{/each}
				</div>
			</section>

			<!-- Frame rate (video only) -->
			<section class="mb-4">
				<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
					Frame rate
				</h3>
				<div class="flex gap-1">
					{#each FPS_OPTIONS as f (f)}
						<button
							class={pill($exportSettings.video.fps === f)}
							onclick={() => ($exportSettings.video = { ...$exportSettings.video, fps: f })}
							>{f} fps</button
						>
					{/each}
				</div>
			</section>
		{:else}
			<section class="mb-4">
				<h3
					class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
				>
					<ImageOutline class="h-3.5 w-3.5" />
					Resolution
				</h3>
				<div class="flex flex-wrap gap-1">
					{#each SCALE_OPTIONS as sc (sc)}
						<button
							class={pill($exportSettings.image.scale === sc)}
							onclick={() => ($exportSettings.image = { ...$exportSettings.image, scale: sc })}
							>{sc}×</button
						>
					{/each}
				</div>
			</section>
		{/if}
	</div>
{:else if isLabel}
	<div class="pointer-events-auto w-60 rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
		<section>
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
				Font size
			</h3>
			<div class="flex gap-1">
				{#each FONT_SIZES as size (size)}
					<button
						class={pill($labelSettings.size === size)}
						onclick={() => ($labelSettings = { ...$labelSettings, size })}
					>
						{size}
					</button>
				{/each}
			</div>
			<p class="mt-2 text-[11px] leading-snug text-gray-400">
				Tap the board to place a label, then type. Press Enter to finish.
			</p>
		</section>
	</div>
{:else if isSelect && selectedAnn}
	<div class="pointer-events-auto w-60 rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
		{#if selectedAnn.kind === 'label'}
			<section class="mb-4">
				<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
					Font size
				</h3>
				<div class="flex gap-1">
					{#each FONT_SIZES as size (size)}
						<button
							class={pill(labelSizeFromPx(selectedAnn.fontSize) === size)}
							onclick={() => changeLabelSize(size)}
						>
							{size}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Scope: All | Current (Step N) | Custom -->
		<section class="mb-4">
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Scope</h3>
			<div class="flex flex-wrap gap-1">
				<button class={pill(scopeMode === 'all')} onclick={setScopeAll}>All</button>
				<button class={pill(scopeMode === 'current')} onclick={setScopeCurrent} disabled={!hasStep}>
					{currentStepNum ? `Current (Step ${currentStepNum})` : 'Current'}
				</button>
				<button class={pill(scopeMode === 'range')} onclick={setScopeRange} disabled={!canRange}>
					Custom
				</button>
			</div>
			{#if scopeMode === 'range' && rangeBounds}
				<div class="mt-2 flex flex-col gap-1.5">
					<label class="flex items-center gap-2 text-[11px] text-gray-500">
						<span class="w-10 shrink-0">From</span>
						<select
							class="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700"
							value={steps[rangeBounds.lo].id}
							onchange={(e) => setRangeFrom(e.currentTarget.value)}
						>
							{#each steps as s, i (s.id)}
								<option value={s.id}>{stepOptionLabel(i)}</option>
							{/each}
						</select>
					</label>
					<label class="flex items-center gap-2 text-[11px] text-gray-500">
						<span class="w-10 shrink-0">To</span>
						<select
							class="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700"
							value={steps[rangeBounds.hi].id}
							onchange={(e) => setRangeTo(e.currentTarget.value)}
						>
							{#each steps as s, i (s.id)}
								<option value={s.id}>{stepOptionLabel(i)}</option>
							{/each}
						</select>
					</label>
				</div>
			{/if}
		</section>

		<!-- Actions: duplicate / delete the selected annotation -->
		<section>
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Actions</h3>
			<div class="flex gap-1">
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
					onclick={duplicateSelected}
					title="Duplicate"
				>
					<FileCopyAltOutline class="h-4 w-4" />
					<span>Duplicate</span>
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
					onclick={deleteSelected}
					title="Delete"
				>
					<TrashBinOutline class="h-4 w-4" />
					<span>Delete</span>
				</button>
			</div>
		</section>
	</div>
{:else if isHand}
	<div class="pointer-events-auto w-60 rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
		<!-- Zone format -->
		<section class="mb-4">
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
				Zone format
			</h3>
			<div class="flex flex-wrap gap-1">
				{#each CAPTURE_FORMATS as f (f)}
					<button class={pill($captureSettings.format === f)} onclick={() => setFormat(f)}>
						{FORMAT_LABELS_SHORT[f]}
					</button>
				{/each}
			</div>
		</section>

		<!-- Watermark -->
		<section class="mb-4">
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
				Watermark
			</h3>
			<div class="flex flex-wrap gap-1">
				{#each WATERMARK_SIZES as size (size)}
					<button
						class={pill($exportSettings.watermark === size)}
						onclick={() => ($exportSettings = { ...$exportSettings, watermark: size })}
					>
						{WATERMARK_LABELS[size]}
					</button>
				{/each}
			</div>
		</section>

		<!-- Board rotation -->
		<section>
			<h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
				Board rotation
			</h3>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100"
					onclick={() => rotateBoard(-90)}
					aria-label="Rotate 90° counter-clockwise"
					title="Rotate 90° counter-clockwise"
				>
					<svg
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M3 8a9 9 0 1 1-2 5" />
						<path d="M3 4v4h4" />
					</svg>
				</button>
				<span class="min-w-[3rem] text-center text-sm font-semibold text-gray-700">
					{$boardSettings.boardRotation ?? 0}°
				</span>
			</div>
			<p class="mt-2 text-[11px] leading-snug text-gray-400">
				Rotate the track and drawings in 90° steps. Labels and the watermark stay upright.
			</p>
		</section>
	</div>
{/if}
