<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import { CameraPhotoOutline } from 'flowbite-svelte-icons';
	import { get } from 'svelte/store';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { screenshotSettings } from '$lib/stores/screenshotSettings';
	import { formatRatio, type CaptureFormat } from '$lib/utils/capture';
	import ZoneFormatSelect from './ZoneFormatSelect.svelte';

	let {
		game,
		disabled = false
	}: {
		game: KonvaGame;
		disabled?: boolean;
	} = $props();

	function setFormat(format: CaptureFormat) {
		// Reset the zone so the page re-initializes a default fitting the new format.
		screenshotSettings.update((s) => ({ ...s, format, zone: undefined }));
	}

	function capture() {
		const s = get(screenshotSettings);
		const dataUrl =
			s.format === 'full'
				? game.exportAsImage(2)
				: game.exportZoneImage(s.zone ?? game.defaultZone(formatRatio(s.format)), 2);
		const link = document.createElement('a');
		link.download = `derbyboard-${new Date().toISOString().slice(0, 10)}.png`;
		link.href = dataUrl;
		link.click();
	}
</script>

<div class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-lg shadow-black/10">
	<!-- Zone format selector -->
	<ZoneFormatSelect format={$screenshotSettings.format} {disabled} onchange={setFormat} />

	<div class="mx-1 h-6 w-px bg-gray-200"></div>

	<!-- Capture -->
	<ToolbarButton
		class="flex items-center gap-2 px-3 text-sm text-gray-700 {disabled
			? 'cursor-not-allowed'
			: 'hover:bg-primary-200'}"
		onclick={capture}
		{disabled}
		aria-label="Capture screenshot"
	>
		<CameraPhotoOutline class="h-5 w-5 text-gray-700" />
		Capture
	</ToolbarButton>
</div>
