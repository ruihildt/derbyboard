<script lang="ts">
	import { Toolbar, ToolbarButton, Tooltip } from 'flowbite-svelte';

	let { mode = $bindable('board') }: { mode?: 'board' | 'edit' } = $props();

	function toggle() {
		mode = mode === 'board' ? 'edit' : 'board';
	}
</script>

<Toolbar class="inline-flex items-center rounded-lg !p-0 shadow-lg shadow-black/5">
	<div class="relative flex items-center">
		<ToolbarButton
			class="flex !my-0 min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200"
			onclick={toggle}
			aria-pressed={mode === 'edit'}
			aria-label={mode === 'edit' ? 'Region edit mode' : 'Board interaction mode'}
		>
			{#if mode === 'board'}
				<!-- Mouse pointer glyph: board interaction mode (elements interactive). -->
				<svg
					class="h-5 w-5 shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path
						d="M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563"
					/>
				</svg>
			{:else}
				<!-- Crop glyph: region edit mode. -->
				<svg
					class="h-5 w-5 shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M8 5v10a1 1 0 0 0 1 1h10" />
					<path d="M5 8h10a1 1 0 0 1 1 1v10" />
				</svg>
			{/if}
		</ToolbarButton>
		<Tooltip
			trigger="hover"
			arrow={false}
			color="primary"
			class="hidden whitespace-nowrap md:block"
		>
			{mode === 'edit' ? 'Region edit mode' : 'Board interaction mode'}
		</Tooltip>
	</div>
</Toolbar>
