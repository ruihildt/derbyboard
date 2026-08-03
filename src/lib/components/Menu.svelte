<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { exportBoardToFile, loadBoardFromFile } from '$lib/utils/boardStateService';

	import { Button, Modal } from 'flowbite-svelte';
	import {
		BarsOutline,
		RefreshOutline,
		InfoCircleOutline,
		FolderOpenOutline,
		ArrowDownToBracketOutline,
		ArchiveOutline,
		NewspaperOutline,
		CogOutline,
		ExpandOutline,
		MinimizeOutline
	} from 'flowbite-svelte-icons';

	let {
		game,
		open = $bindable(false),
		onOpenArchive,
		onOpenNews,
		onOpenBoardSettings
	}: {
		game: KonvaGame;
		open?: boolean;
		onOpenArchive?: () => void;
		onOpenNews?: () => void;
		onOpenBoardSettings?: () => void;
	} = $props();

	let showErrorModal = $state(false);
	let errorMessage = $state('');
	let isFullscreen = $state(false);
	let menuRef = $state<HTMLDivElement | undefined>(undefined);

	// Close the inline menu on any pointer down outside of it (e.g. on the board).
	$effect(() => {
		if (!open) return;
		function onPointerDown(e: PointerEvent) {
			if (menuRef && !menuRef.contains(e.target as Node)) {
				open = false;
			}
		}
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	// Track fullscreen so the menu item label stays in sync.
	$effect(() => {
		function onFs() {
			isFullscreen = !!document.fullscreenElement;
		}
		document.addEventListener('fullscreenchange', onFs);
		return () => document.removeEventListener('fullscreenchange', onFs);
	});

	function toggleMenu() {
		open = !open;
	}

	function handleReset() {
		game.resetBoard();
		open = false;
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

	function handleExportBoard() {
		exportBoardToFile();
		open = false;
	}

	function handleOpenArchive() {
		open = false;
		onOpenArchive?.();
	}

	function handleOpenNews() {
		open = false;
		onOpenNews?.();
	}

	function handleOpenBoardSettings() {
		open = false;
		onOpenBoardSettings?.();
	}

	async function toggleFullscreen() {
		if (!document.fullscreenElement) {
			await document.documentElement.requestFullscreen();
		} else {
			await document.exitFullscreen();
		}
		open = false;
	}

	function item(): string {
		return 'flex w-full items-center rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-primary-200';
	}
</script>

<Button
	class="min-h-11 min-w-11 rounded-lg bg-white !p-1 shadow-lg shadow-black/5 hover:bg-primary-200"
	onclick={toggleMenu}
>
	<BarsOutline class="h-6 w-6" color="gray" />
</Button>

{#if open}
	<!-- Inline menu card: occupies the same slot as the settings panel below
	     the hamburger. The settings panel is hidden while this is open. -->
	<div
		bind:this={menuRef}
		class="pointer-events-auto w-60 rounded-2xl bg-white p-2 shadow-lg shadow-black/10"
	>
		<div class="flex flex-col gap-0.5">
			<button class={item()} onclick={handleReset}>
				<RefreshOutline class="mr-2 h-4 w-4" />
				<span>Reset board</span>
			</button>
			<button class={item()} onclick={handleOpenBoard}>
				<FolderOpenOutline class="mr-2 h-4 w-4" />
				<span>Open board</span>
			</button>
			<button class={item()} onclick={handleExportBoard}>
				<ArrowDownToBracketOutline class="mr-2 h-4 w-4" />
				<span>Export board</span>
			</button>
			<button class={item()} onclick={handleOpenArchive}>
				<ArchiveOutline class="mr-2 h-4 w-4" />
				<span>Open recording</span>
			</button>
			<button class={item()} onclick={handleOpenBoardSettings}>
				<CogOutline class="mr-2 h-4 w-4" />
				<span>Board settings</span>
			</button>
			<button class={item()} onclick={toggleFullscreen}>
				{#if isFullscreen}
					<MinimizeOutline class="mr-2 h-4 w-4" />
					<span>Exit fullscreen</span>
				{:else}
					<ExpandOutline class="mr-2 h-4 w-4" />
					<span>Fullscreen</span>
				{/if}
			</button>
			<button class={item()} onclick={handleOpenNews}>
				<NewspaperOutline class="mr-2 h-4 w-4" />
				<span>News</span>
			</button>
			<a
				class={item()}
				href="https://github.com/ruihildt/derbyboard"
				target="_blank"
				onclick={() => (open = false)}
			>
				<InfoCircleOutline class="mr-2 h-4 w-4" />
				<span>About</span>
			</a>
		</div>
	</div>
{/if}

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
