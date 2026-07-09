<script lang="ts">
	import { onMount } from 'svelte';

	import { KonvaGame } from '$lib/konva/KonvaGame';

	import Changelog from '$lib/components/Changelog.svelte';
	import FullscreenButton from '$lib/components/FullscreenButton.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import RecordControl from '$lib/components/RecordControl.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';

	let game = $state<KonvaGame>()!;
	let isRecording = $state(false);
	let isReplaying = $state(false);

	onMount(() => {
		game = new KonvaGame('container', window.innerWidth, window.innerHeight);
	});
</script>

<main class="h-screen w-screen">
	<div id="container" class="absolute left-0 top-0 h-screen w-screen"></div>
</main>

<div class="fixed left-4 top-4">
	<Menu {game} />
</div>

<div class="fixed bottom-4 left-4">
	<ZoomControl {game} />
</div>

<div class="fixed right-4 top-4 flex items-start gap-2">
	<RecordControl bind:isRecording {game} disabled={isReplaying} />
	<ReplayBar
		{game}
		disabled={isRecording}
		onEnter={() => (isReplaying = true)}
		onExit={() => (isReplaying = false)}
	/>
</div>

<div class="fixed bottom-4 right-4 flex gap-2">
	<Changelog />
	<FullscreenButton />
</div>
