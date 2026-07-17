<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { ImageOutline, VideoCameraOutline } from 'flowbite-svelte-icons';
	import { exportSettings, type ImageScale, type VideoFps } from '$lib/stores/exportSettings';
	import type { WatermarkSize } from '$lib/konva/Watermark';
	import type { Quality } from '$lib/utils/codec';

	let {
		open = $bindable(false)
	}: {
		open?: boolean;
	} = $props();

	function pill(active: boolean): string {
		return `rounded px-2 py-1 text-xs ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
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

<Modal bind:open size="sm" classes={{ close: 'hover:bg-primary-200' }}>
	<div class="px-5 pb-2 pt-4">
		<h2 class="mb-4 text-lg font-semibold text-gray-800">Settings</h2>

		<section class="mb-5">
			<h3
				class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
			>
				General
			</h3>
			<div>
				<div class="mb-1 text-xs text-gray-500">Watermark</div>
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
			</div>
		</section>

		<section class="mb-5">
			<h3
				class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
			>
				<VideoCameraOutline class="h-3.5 w-3.5" />
				Video
			</h3>
			<div class="space-y-2">
				<div>
					<div class="mb-1 text-xs text-gray-500">Resolution</div>
					<div class="flex flex-wrap gap-1">
						{#each QUALITIES as q (q)}
							<button
								class={pill($exportSettings.video.resolution === q)}
								onclick={() =>
									($exportSettings.video = { ...$exportSettings.video, resolution: q })}>{q}</button
							>
						{/each}
					</div>
				</div>
				<div>
					<div class="mb-1 text-xs text-gray-500">Frame rate</div>
					<div class="flex gap-1">
						{#each FPS_OPTIONS as f (f)}
							<button
								class={pill($exportSettings.video.fps === f)}
								onclick={() => ($exportSettings.video = { ...$exportSettings.video, fps: f })}
								>{f} fps</button
							>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section>
			<h3
				class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
			>
				<ImageOutline class="h-3.5 w-3.5" />
				Image
			</h3>
			<div>
				<div class="mb-1 text-xs text-gray-500">Resolution</div>
				<div class="flex flex-wrap gap-1">
					{#each SCALE_OPTIONS as sc (sc)}
						<button
							class={pill($exportSettings.image.scale === sc)}
							onclick={() => ($exportSettings.image = { ...$exportSettings.image, scale: sc })}
							>{sc}×</button
						>
					{/each}
				</div>
			</div>
		</section>
	</div>
</Modal>
