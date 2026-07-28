<script lang="ts">
	import { Dropdown, DropdownItem, ToolbarButton } from 'flowbite-svelte';
	import { ClipboardCheckOutline } from 'flowbite-svelte-icons';
	import { PRESETS, presetEntities } from '$lib/data/presets';
	import { loadPresetEntities } from '$lib/doc/clipOps';

	let open = $state(false);

	function choose(id: string) {
		const preset = PRESETS.find((p) => p.id === id);
		if (!preset) return;
		open = false;
		loadPresetEntities(presetEntities(preset));
	}
</script>

<div class="relative flex items-center">
	<ToolbarButton
		class="flex !my-0 min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg bg-white px-2 text-xs text-gray-700 shadow-lg shadow-black/5 hover:bg-primary-200"
		onclick={() => (open = !open)}
		aria-label="Lineup presets"
	>
		<ClipboardCheckOutline class="h-5 w-5" />
		<span class="hidden sm:inline">Lineup</span>
	</ToolbarButton>
	<Dropdown bind:isOpen={open} class="w-52">
		{#each PRESETS as preset (preset.id)}
			<DropdownItem
				class="flex items-center text-gray-700 hover:bg-primary-200"
				onclick={() => choose(preset.id)}
			>
				<span>{preset.name}</span>
			</DropdownItem>
		{/each}
	</Dropdown>
</div>
