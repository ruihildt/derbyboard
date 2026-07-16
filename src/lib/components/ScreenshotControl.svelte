<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import { CameraPhotoOutline } from 'flowbite-svelte-icons';
	import { get } from 'svelte/store';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { exportSettings } from '$lib/stores/exportSettings';
	import { formatRatio } from '$lib/utils/capture';

	let {
		game,
		disabled = false
	}: {
		game: KonvaGame;
		disabled?: boolean;
	} = $props();

	function capture() {
		const s = get(captureSettings);
		const scale = get(exportSettings).image.scale;
		const dataUrl =
			s.format === 'full'
				? game.exportAsImage(scale)
				: game.exportZoneImage(s.zone ?? game.defaultZone(formatRatio(s.format)), scale);
		const link = document.createElement('a');
		link.download = `derbyboard-${new Date().toISOString().slice(0, 10)}.png`;
		link.href = dataUrl;
		link.click();
	}
</script>

<div class="flex items-center gap-1">
	<ToolbarButton
		class="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-gray-700 {disabled
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
