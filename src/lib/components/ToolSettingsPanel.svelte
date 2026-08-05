<script lang="ts">
	import { ImageOutline, VideoCameraOutline } from 'flowbite-svelte-icons';
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
	import { selectedAnnotationId } from '$lib/stores/selection';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { setAnnotationScope, setAnnotationFontSize } from '$lib/doc/clipOps';
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

	// The selected annotation (if any) when the select tool is armed.
	let selectedAnn = $derived(
		$toolMode === 'select' && $selectedAnnotationId
			? $boardDoc.annotations?.find((a) => a.id === $selectedAnnotationId)
			: undefined
	);

	// Active step context for the scope toggle.
	let clip = $derived($boardDoc.clips.find((c) => c.id === $boardDoc.activeClipId));
	let activeStep = $derived(
		clip && clip.kind === 'authored'
			? clip.steps[Math.max(0, Math.min($authoringSession.activeStepIndex, clip.steps.length - 1))]
			: undefined
	);
	let isStepScoped = $derived(!!selectedAnn?.scope);
	let hasStep = $derived(!!activeStep);
	let stepLabel = $derived.by(() => {
		if (!activeStep) return 'This step';
		const title = activeStep.title?.trim();
		if (title) return title;
		const idx =
			clip && clip.kind === 'authored' ? clip.steps.findIndex((s) => s.id === activeStep.id) : -1;
		return idx >= 0 ? `Step ${idx + 1}` : 'This step';
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

	function toggleScope() {
		const id = $selectedAnnotationId;
		if (!id) return;
		if (isStepScoped) {
			setAnnotationScope(id, null);
		} else if (activeStep) {
			setAnnotationScope(id, activeStep.id);
		}
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
		<!-- Zone format (shared) -->
		<section class="mb-4">
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Zone format</h3>
			<div class="flex flex-wrap gap-1">
				{#each CAPTURE_FORMATS as f (f)}
					<button class={pill($captureSettings.format === f)} onclick={() => setFormat(f)}>
						{FORMAT_LABELS_SHORT[f]}
					</button>
				{/each}
			</div>
		</section>

		<!-- Resolution: video qualities or image scale -->
		{#if captureMode === 'video'}
			<section class="mb-4">
				<h3
					class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
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
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Frame rate</h3>
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
					class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
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

		<!-- Watermark (shared) -->
		<section>
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Watermark</h3>
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
	</div>
{:else if isLabel}
	<div class="pointer-events-auto w-60 rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
		<section>
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Font size</h3>
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
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Font size</h3>
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

		<!-- Scope toggle at the bottom -->
		<section>
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Scope</h3>
			<div class="flex gap-1">
				<button class={pill(!isStepScoped)} onclick={toggleScope}>All steps</button>
				<button class={pill(isStepScoped)} onclick={toggleScope} disabled={!hasStep}>
					{stepLabel}
				</button>
			</div>
		</section>
	</div>
{/if}
