<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';

	import { Dropdown, DropdownItem, Button } from 'flowbite-svelte';
	import { BarsOutline, RefreshOutline, InfoCircleOutline } from 'flowbite-svelte-icons';

	let { game } = $props<{
		game: KonvaGame;
	}>();

	let dropdownOpen = $state(false);

	function toggleMenu() {
		dropdownOpen = !dropdownOpen;
	}

	function handleReset() {
		game.resetBoard();
		dropdownOpen = false;
	}
</script>

<Button class="bg-white !p-2 hover:bg-primary-200" onclick={() => toggleMenu}>
	<BarsOutline class="h-6 w-6" color="gray" />
</Button>

<Dropdown bind:isOpen={dropdownOpen} class="w-48">
	<DropdownItem class="flex items-center text-gray-700 hover:bg-primary-200" onclick={handleReset}>
		<RefreshOutline class="mr-2 h-4 w-4" />
		<span>Reset board</span>
	</DropdownItem>
	<DropdownItem
		class="flex items-center text-gray-700 hover:bg-primary-200"
		href="https://github.com/ruihildt/derbyboard"
		target="_blank"
		onclick={() => (dropdownOpen = false)}
	>
		<InfoCircleOutline class="mr-2 h-4 w-4" />
		<span>About</span>
	</DropdownItem>
</Dropdown>
