<script lang="ts">
	import { ImageOutline, VideoCameraOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { toolMode } from '$lib/stores/toolMode';
	import { exportSettings, type ImageScale, type VideoFps } from '$lib/stores/exportSettings';
	import type { WatermarkSize } from '$lib/konva/Watermark';
	import type { Quality } from '$lib/utils/codec';
	import {
		CAPTURE_FORMATS,
		FORMAT_LABELS_SHORT,
		formatRatio,
		type CaptureFormat
	} from '$lib/utils/capture';

	let { game }: { game: KonvaGame } = $props();

	// The capture settings sections show only while a capture tool is armed.
	// Switching to a drawing/view tool hides the panel; other tools may later
	// surface their own settings here. While a capture tool is armed the
	// capture zone is always resize-able (ZoneOverlay edit mode is derived
	// from the armed tool — see regionMode store); no manual toggle.
	let mode = $derived($toolMode === 'video' || $toolMode === 'screenshot' ? $toolMode : null);

	function pill(active: boolean): string {
		return `rounded px-2 py-1 text-xs ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
	}

	function setFormat(format: CaptureFormat) {
		captureSettings.update((s) => ({
			...s,
			format,
			// Keep a valid zone for ratio formats so the overlay stays mounted and
			// the ratio-change centering effect runs (see captureSettings store).
			zone: format === 'full' ? s.zone : game.defaultZone(formatRatio(format))
		}));
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
</script>

{#if mode}
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
		{#if mode === 'video'}
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
{/if}
