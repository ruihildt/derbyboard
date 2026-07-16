<script lang="ts">
	import { Toolbar, ToolbarButton, Tooltip } from 'flowbite-svelte';
	import { MinusOutline, PlusOutline } from 'flowbite-svelte-icons';
	import { boardState } from '$lib/stores/konvaBoardState';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { MAX_ZOOM } from '$lib/constants';

	let { game } = $props<{
		game: KonvaGame;
	}>();

	let zoomLevel = $derived(Math.round(($boardState.viewSettings?.zoom || 1) * 100));

	function zoomIn() {
		game.zoomIn();
	}

	function zoomOut() {
		game.zoomOut();
	}

	function resetZoom() {
		game.resetZoom();
	}
</script>

<Toolbar class="inline-flex items-center rounded-lg !p-0 shadow-lg shadow-black/5">
	<ToolbarButton
		class={zoomLevel <= 10
			? 'flex !my-0 min-h-11 cursor-not-allowed items-center gap-2 rounded-lg px-3 text-sm text-gray-700 opacity-50'
			: 'flex !my-0 min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200'}
		onclick={zoomOut}
		disabled={zoomLevel <= 10}
	>
		<MinusOutline />
	</ToolbarButton>
	<div class="relative flex items-center">
		<ToolbarButton
			class="flex !my-0 min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200"
			onclick={resetZoom}
		>
			{zoomLevel}%
		</ToolbarButton>
		<Tooltip trigger="hover" arrow={false} color="primary" class="hidden whitespace-nowrap md:block"
			>Reset zoom</Tooltip
		>
	</div>
	<ToolbarButton
		class={zoomLevel >= MAX_ZOOM * 100
			? 'flex !my-0 min-h-11 cursor-not-allowed items-center gap-2 rounded-lg px-3 text-sm text-gray-700 opacity-50'
			: 'flex !my-0 min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200'}
		onclick={zoomIn}
		disabled={zoomLevel >= MAX_ZOOM * 100}
	>
		<PlusOutline />
	</ToolbarButton>
</Toolbar>
