<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { TimelineVideoExporter } from '$lib/recording/video/TimelineVideoExporter';
	import { BITRATE_BY_QUALITY } from '$lib/utils/codec';
	import { QUALITY_HEIGHT } from '$lib/utils/recording';
	import { exportSettings } from '$lib/stores/exportSettings';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';

	let {
		game,
		project,
		audioBlob,
		onClose
	}: {
		game: KonvaGame;
		project: TimelineProject;
		audioBlob: Blob | null;
		onClose: () => void;
	} = $props();

	const webcodecsSupported =
		typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

	let phase = $state<'config' | 'exporting' | 'done' | 'error'>('config');
	let progress = $state({ frames: 0, total: 0 });
	let errorMsg = $state('');
	let controller: AbortController | null = null;

	const dims = $derived.by(() => {
		const h = QUALITY_HEIGHT[$exportSettings.video.resolution];
		const stage = game.getStage();
		if (project.frame) {
			const z = project.frame.region;
			const ar = (z.wFrac * stage.width()) / (z.hFrac * stage.height());
			return { w: Math.round(h * ar), h };
		}
		return { w: Math.round((h * stage.width()) / stage.height()), h };
	});
	const pct = $derived(
		progress.total > 0 ? Math.round((progress.frames / progress.total) * 100) : 0
	);

	async function runExport() {
		phase = 'exporting';
		progress = { frames: 0, total: 0 };
		controller = new AbortController();
		const { resolution, fps } = $exportSettings.video;
		const exporter = new TimelineVideoExporter();
		try {
			const result = await exporter.export({
				game,
				project,
				audioBlob,
				height: QUALITY_HEIGHT[resolution],
				fps,
				bitrate: BITRATE_BY_QUALITY[resolution],
				signal: controller.signal,
				onProgress: (frames, total) => (progress = { frames, total })
			});
			download(result.blob);
			phase = 'done';
		} catch (e) {
			if ((e as DOMException)?.name === 'AbortError') {
				onClose();
				return;
			}
			console.error('[VideoExport] failed', e);
			errorMsg = e instanceof Error ? e.message : 'Export failed.';
			phase = 'error';
		} finally {
			controller = null;
		}
	}

	function cancel(): void {
		if (controller) controller.abort();
		else onClose();
	}

	function download(blob: Blob): void {
		const now = new Date();
		const name = `derbyboard-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.mp4`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
	<div class="w-80 rounded-lg bg-white p-5 shadow-xl">
		<h3 class="mb-4 text-lg font-semibold text-gray-800">Export video</h3>

		{#if !webcodecsSupported}
			<p class="text-sm text-red-600">
				WebCodecs isn't supported in this browser. Use a recent Chrome or Firefox to export video.
			</p>
			<div class="mt-4 flex justify-end">
				<Button class="bg-primary-200 !p-2 text-sm text-gray-700" onclick={onClose}>Close</Button>
			</div>
		{:else if phase === 'config'}
			<p class="mb-1 text-sm text-gray-700">
				{$exportSettings.video.resolution} · {$exportSettings.video.fps} fps
			</p>
			<p class="mb-4 text-[10px] text-gray-400">Output: {dims.w}×{dims.h}px</p>

			<div class="flex justify-end gap-2">
				<Button class="bg-gray-100 !p-2 text-sm text-gray-700 hover:bg-gray-200" onclick={onClose}
					>Cancel</Button
				>
				<Button
					class="bg-primary-500 !p-2 text-sm text-white hover:bg-primary-600"
					onclick={runExport}>Export</Button
				>
			</div>
		{:else if phase === 'exporting'}
			<p class="mb-2 text-sm text-gray-600">Exporting… {progress.frames} / {progress.total}</p>
			<div class="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-200">
				<div class="h-full bg-primary-500 transition-all" style="width: {pct}%"></div>
			</div>
			<div class="flex justify-end">
				<Button class="bg-gray-100 !p-2 text-sm text-gray-700 hover:bg-gray-200" onclick={cancel}
					>Cancel</Button
				>
			</div>
		{:else if phase === 'done'}
			<p class="text-sm text-gray-700">Video exported and downloaded.</p>
			<div class="mt-4 flex justify-end">
				<Button class="bg-primary-200 !p-2 text-sm text-gray-700" onclick={onClose}>Close</Button>
			</div>
		{:else}
			<p class="text-sm text-red-600">{errorMsg}</p>
			<div class="mt-4 flex justify-end gap-2">
				<Button
					class="bg-gray-100 !p-2 text-sm text-gray-700 hover:bg-gray-200"
					onclick={() => (phase = 'config')}>Back</Button
				>
				<Button class="bg-primary-200 !p-2 text-sm text-gray-700" onclick={onClose}>Close</Button>
			</div>
		{/if}
	</div>
</div>
