<script lang="ts">
	import { Toolbar, ToolbarButton, Tooltip } from 'flowbite-svelte';
	import { ExpandOutline, MinimizeOutline } from 'flowbite-svelte-icons';

	let isFullscreen = $state(typeof document !== 'undefined' && !!document.fullscreenElement);

	function onFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	async function toggleFullscreen() {
		if (!document.fullscreenElement) {
			await document.documentElement.requestFullscreen();
		} else {
			await document.exitFullscreen();
		}
		isFullscreen = !!document.fullscreenElement;
	}
</script>

<svelte:window onfullscreenchange={onFullscreenChange} />

<Toolbar class="inline-flex items-center rounded-lg !p-0 shadow-lg shadow-black/5">
	<div class="relative flex items-center">
		<ToolbarButton
			class="flex !my-0 min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200"
			onclick={toggleFullscreen}
			aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		>
			{#if isFullscreen}
				<MinimizeOutline />
			{:else}
				<ExpandOutline />
			{/if}
		</ToolbarButton>
		<Tooltip
			trigger="hover"
			arrow={false}
			color="primary"
			class="hidden whitespace-nowrap md:block"
		>
			{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		</Tooltip>
	</div>
</Toolbar>
