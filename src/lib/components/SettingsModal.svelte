<script lang="ts">
	import { Modal, Button } from 'flowbite-svelte';
	import { FolderOpenOutline, ArrowDownToBracketOutline, PlayOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { exportBoardToFile, loadBoardFromFile } from '$lib/utils/boardStateService';

	let {
		open = $bindable(false),
		game,
		onOpenArchive
	}: {
		open?: boolean;
		game: KonvaGame;
		onOpenArchive?: () => void;
	} = $props();

	let showErrorModal = $state(false);
	let errorMessage = $state('');

	function rowClass(): string {
		return 'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-gray-700 hover:bg-primary-200';
	}

	async function handleOpenBoard() {
		open = false;
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

	function handleSaveBoard() {
		exportBoardToFile();
		open = false;
	}

	function handleOpenArchive() {
		open = false;
		onOpenArchive?.();
	}
</script>

<Modal bind:open size="sm">
	<div class="px-5 pb-2 pt-4">
		<h2 class="mb-4 text-lg font-semibold text-gray-800">Settings</h2>

		<section class="mb-5">
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Board</h3>
			<div class="space-y-1">
				<button class={rowClass()} onclick={handleOpenBoard}>
					<FolderOpenOutline class="h-4 w-4 text-gray-500" />
					Open
				</button>
				<button class={rowClass()} onclick={handleSaveBoard}>
					<ArrowDownToBracketOutline class="h-4 w-4 text-gray-500" />
					Save to...
				</button>
			</div>
		</section>

		<section>
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recording</h3>
			<div class="space-y-1">
				<button class={rowClass()} onclick={handleOpenArchive}>
					<PlayOutline class="h-4 w-4 text-gray-500" />
					Open Recording Archive
				</button>
			</div>
		</section>

		<div class="mt-5 flex justify-end">
			<Button
				class="bg-primary-200 !px-3 !py-1.5 text-sm text-gray-700 hover:bg-primary-300"
				onclick={() => (open = false)}>Done</Button
			>
		</div>
	</div>
</Modal>

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
