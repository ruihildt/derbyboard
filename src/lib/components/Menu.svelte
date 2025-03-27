<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { exportBoardToFile, loadBoardFromFile } from '$lib/utils/boardStateService';

	import { Dropdown, DropdownItem, Button, DropdownDivider, Modal } from 'flowbite-svelte';
	import {
		BarsOutline,
		ArrowDownToBracketOutline,
		FolderOpenOutline,
		RefreshOutline,
		ImageOutline,
		InfoCircleOutline
	} from 'flowbite-svelte-icons';

	let { game } = $props<{
		game: KonvaGame;
	}>();

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

	async function handleOpen() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.click();
		dropdownOpen = false;

		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				try {
					await loadBoardFromFile(file);
				} catch (error) {
					errorMessage = 'Invalid board file format. Please select a valid JSON file.';
					showErrorModal = true;
				}
			}
		};
	}

	function handleExportImage() {
		const link = document.createElement('a');
		link.download = `derbyboard-${new Date().toISOString().slice(0, 10)}.png`;
		link.href = game.exportAsImage(2);
		link.click();
		dropdownOpen = false;
	}

	function handleSave() {
		exportBoardToFile(game);
		dropdownOpen = false;
	}
</script>

<div class="fixed left-4 top-4">
	<Button class="bg-white !p-2 hover:bg-primary-200" onclick={() => toggleMenu}>
		<BarsOutline class="h-6 w-6" color="gray" />
	</Button>

	<Dropdown bind:open={dropdownOpen} class="w-40">
		<DropdownItem class="flex items-center text-gray-600 hover:bg-primary-200" onclick={handleOpen}>
			<FolderOpenOutline class="mr-2 h-4 w-4" />
			<span>Open</span>
		</DropdownItem>
		<DropdownItem class="flex items-center text-gray-700 hover:bg-primary-200" onclick={handleSave}>
			<ArrowDownToBracketOutline class="mr-2 h-4 w-4" />
			<span>Save to...</span>
		</DropdownItem>
		<DropdownItem
			class="flex items-center text-gray-700 hover:bg-primary-200"
			onclick={handleExportImage}
		>
			<ImageOutline class="mr-2 h-4 w-4" />
			<span>Export image...</span>
		</DropdownItem>

		<DropdownDivider />
		<DropdownItem
			class="flex items-center text-gray-700 hover:bg-primary-200"
			onclick={handleReset}
		>
			<RefreshOutline class="mr-2 h-4 w-4" />
			<span>Reset board</span>
		</DropdownItem>
		<DropdownDivider />
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
</div>

<Modal bind:open={showErrorModal} size="xs">
	<div class="text-center">
		<h3 class="mb-4 text-lg font-normal text-gray-500">
			{errorMessage}
		</h3>
		<Button
			class="mt-3 bg-primary-200 !p-2 text-sm text-gray-700 hover:bg-primary-300"
			onclick={() => {
				showErrorModal = false;
				handleOpen();
			}}
		>
			Select another file
		</Button>
	</div>
</Modal>
