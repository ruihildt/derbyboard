<script lang="ts">
	import { onMount } from 'svelte';
	import { panMode } from '$lib/stores/panMode';
	import { Toolbar, ToolbarButton, Tooltip } from 'flowbite-svelte';
	import { LockOutline } from 'flowbite-svelte-icons';

	onMount(() => {
		const unsubscribe = panMode.subscribe((value) => {
			document.body.classList.toggle('pan-mode', value);
		});

		return unsubscribe;
	});
</script>

<Toolbar class="inline-flex rounded-lg !p-1 shadow-lg shadow-black/5">
	<ToolbarButton
		class="flex items-center gap-2 px-3 text-sm text-gray-700 hover:bg-primary-200"
		onclick={() => panMode.set(!$panMode)}
	>
		{#if $panMode}
			🤚
		{:else}
			<LockOutline />
		{/if}
	</ToolbarButton>
	<Tooltip trigger="hover" arrow={false} color="primary" class="hidden whitespace-nowrap md:block">
		Panning tool</Tooltip
	>
</Toolbar>

<style>
	:global(canvas) {
		cursor: default;
	}
	:global(.pan-mode canvas) {
		cursor: grab;
	}
	:global(.pan-mode canvas:active) {
		cursor: grabbing;
	}
</style>
