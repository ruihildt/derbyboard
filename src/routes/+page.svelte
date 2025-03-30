<script lang="ts">
	import { onMount } from 'svelte';
	import { Modal, Toolbar, ToolbarButton } from 'flowbite-svelte';
	import { ArrowsRepeatOutline, DownloadOutline } from 'flowbite-svelte-icons';

	import { KonvaGame } from '$lib/konva/KonvaGame';

	import Changelog from '$lib/components/Changelog.svelte';
	import FullscreenButton from '$lib/components/FullscreenButton.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import RecordControl from '$lib/components/RecordControl.svelte';
	import Video from '$lib/components/Video.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';

	let game = $state<KonvaGame>()!;
	let isRecording = $state(false);
	let recordedBlob: Blob | null = $state(null);
	let showPreview = $state(false);

	function handleRecordingComplete(blob: Blob) {
		recordedBlob = blob;
		showPreview = true;
	}

	function handlePreviewClose() {
		showPreview = false;
		recordedBlob = null;
	}

	function handleDownload() {
		if (!recordedBlob) return;

		const url = URL.createObjectURL(recordedBlob);
		const a = document.createElement('a');
		a.href = url;

		const now = new Date();
		const year = now.getFullYear().toString().slice(-2);
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');

		a.download = `derbyboard-${year}-${month}-${day}.webm`;

		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		handlePreviewClose();
	}

	onMount(() => {
		game = new KonvaGame('container', window.innerWidth, window.innerHeight);
	});
</script>

<main class="h-screen w-screen">
	<div id="container" class="absolute left-0 top-0 h-screen w-screen"></div>

	<Modal
		bind:open={showPreview}
		size="xl"
		autoclose={false}
		backdropClass="z-40 fixed inset-0 bg-black dark:bg-black"
		outsideclose={false}
	>
		<div class="flex-grow">
			{#if recordedBlob}
				<Video bind:videoBlob={recordedBlob} close={handlePreviewClose} />
			{/if}
		</div>

		<div class="mt-auto flex justify-center">
			<Toolbar class="inline-flex rounded-lg !p-1">
				<ToolbarButton
					class="flex items-center gap-2 px-3 text-sm text-gray-700 hover:bg-primary-200"
					on:click={handlePreviewClose}
				>
					<ArrowsRepeatOutline />
					Restart
				</ToolbarButton>
				<ToolbarButton
					class="flex items-center gap-2 px-3 text-sm text-gray-700 hover:bg-primary-200"
					on:click={handleDownload}
				>
					<DownloadOutline />
					Download
				</ToolbarButton>
			</Toolbar>
		</div>
	</Modal>
</main>

<div class="fixed left-4 top-4">
	<Menu {game} />
</div>

<div class="fixed bottom-4 left-4">
	<ZoomControl {game} />
</div>

<div class="fixed bottom-4 right-4 flex gap-2">
	<Changelog />
	<FullscreenButton />
</div>

<div class="fixed right-4 top-4">
	<RecordControl bind:isRecording recordingComplete={handleRecordingComplete} {game} />
</div>
