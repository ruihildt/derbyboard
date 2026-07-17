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
			class="flex !my-0 min-h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors {mode ===
			'edit'
				? 'bg-primary-500 text-white hover:bg-primary-600'
				: 'text-gray-700 hover:bg-primary-200'}"
			onclick={toggle}
			aria-pressed={mode === 'edit'}
			aria-label="Toggle recording zone modification"
		>
			<!-- Crop glyph: recording zone edit mode. The filled background signals the active state. -->
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
		</ToolbarButton>
		<Tooltip
			trigger="hover"
			arrow={false}
			color="primary"
			class="hidden whitespace-nowrap md:block"
		>
			Modify recording zone
		</Tooltip>
	</div>
</Toolbar>
