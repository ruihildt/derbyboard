<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { exportBoardToFile, loadBoardFromFile } from '$lib/utils/boardStateService';

	import { Dropdown, DropdownItem, Modal, Button } from 'flowbite-svelte';
	import {
		BarsOutline,
		RefreshOutline,
		InfoCircleOutline,
		FolderOpenOutline,
		ArrowDownToBracketOutline,
		ArchiveOutline
	} from 'flowbite-svelte-icons';

	let {
		game,
		onOpenArchive
	}: {
		game: KonvaGame;
		onOpenArchive?: () => void;
	} = $props();

	let dropdownOpen = $state(false);
	let showErrorModal = $state(false);
	let errorMessage = $state('');

	function toggleMenu() {
		dropdownOpen = !dropdownOpen;
	}

	function handleReset() {
		game.resetBoard();
		dropdownOpen = false;
	}

	async function handleOpenBoard() {
		dropdownOpen = false;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.click();
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			try {
				await loadBoardFromFile(file, game);
			} catch {
				errorMessage = 'Invalid board file format. Please select a valid JSON file.';
				showErrorModal = true;
			}
		};
	}

	function handleExportBoard() {
		exportBoardToFile();
		dropdownOpen = false;
	}

	function handleOpenArchive() {
		dropdownOpen = false;
		onOpenArchive?.();
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
		onclick={handleOpenBoard}
	>
		<FolderOpenOutline class="mr-2 h-4 w-4" />
		<span>Open board</span>
	</DropdownItem>
	<DropdownItem
		class="flex items-center text-gray-700 hover:bg-primary-200"
		onclick={handleExportBoard}
	>
		<ArrowDownToBracketOutline class="mr-2 h-4 w-4" />
		<span>Export board</span>
	</DropdownItem>
	<DropdownItem
		class="flex items-center text-gray-700 hover:bg-primary-200"
		onclick={handleOpenArchive}
	>
		<ArchiveOutline class="mr-2 h-4 w-4" />
		<span>Open recording</span>
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

<Modal bind:open={showErrorModal} size="xs">
	<div class="px-5 py-4 text-center">
		<h3 class="mb-4 text-lg font-normal text-gray-500">{errorMessage}</h3>
		<div class="flex justify-center space-x-3">
			<Button
				class="bg-primary-200 !p-2 text-sm text-gray-700 hover:bg-primary-300"
				onclick={() => {
					showErrorModal = false;
					handleOpenBoard();
				}}>Select another file</Button
			>
			<Button
				class="bg-gray-100 !p-2 text-sm text-gray-700 hover:bg-gray-200"
				onclick={() => (showErrorModal = false)}>Close</Button
			>
		</div>
	</div>
</Modal>
