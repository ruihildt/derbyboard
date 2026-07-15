<script lang="ts">
	import { onMount } from 'svelte';

	import { KonvaGame } from '$lib/konva/KonvaGame';

	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import Changelog from '$lib/components/Changelog.svelte';
	import FullscreenButton from '$lib/components/FullscreenButton.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import ZoneOverlay from '$lib/components/ZoneOverlay.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { formatRatio } from '$lib/utils/capture';
	import type { TimelineFrame, TimelineProject } from '$lib/recording/timeline/types';

	let game = $state<KonvaGame>()!;
	let isRecording = $state(false);
	let isReplaying = $state(false);

	let replayBar:
		| {
				load: () => void;
				replay: (project: TimelineProject, audioBlob: Blob | null) => void;
		  }
		| undefined = $state();
	let loadError = $state('');

	let replayFrame = $state<TimelineFrame | null>(null);

	type CaptureTab = 'video' | 'screenshot';
	let activeTab = $state<CaptureTab>('video');

	// Replay uses the project's stored frame (non-interactive). Otherwise the
	// shared capture selection overlay shows for any non-full format; it stays
	// visible during recording (non-interactive) to mark the capture area.
	let replayOverlay = $derived(!!replayFrame);
	let captureZone = $derived(
		!isReplaying && $captureSettings.format !== 'full' ? $captureSettings.zone : undefined
	);
	let captureRatio = $derived(formatRatio($captureSettings.format));
	let interactive = $derived(!isRecording && !replayFrame);

	// Initialize the shared zone to the whole track the first time a non-full
	// format is selected.
	$effect(() => {
		if ($captureSettings.format === 'full') return;
		if ($captureSettings.zone) return;
		if (!game) return;
		captureSettings.update((s) => ({ ...s, zone: game.defaultZone(formatRatio(s.format)) }));
	});

	onMount(() => {
		game = new KonvaGame('container', window.innerWidth, window.innerHeight);
	});
</script>

<main class="h-screen w-screen">
	<div id="container" class="absolute left-0 top-0 h-screen w-screen"></div>
	{#if replayOverlay && replayFrame}
		<ZoneOverlay zone={replayFrame.region} ratio={null} interactive={false} onchange={() => {}} />
	{:else if captureZone}
		<ZoneOverlay
			zone={captureZone}
			ratio={captureRatio}
			{interactive}
			onchange={(z) => captureSettings.update((s) => ({ ...s, zone: z }))}
		/>
	{/if}
</main>

<div class="fixed left-4 top-4 z-30">
	<Menu {game} />
</div>

<div class="fixed right-4 top-4 z-30">
	<Changelog />
</div>

<div class="fixed bottom-4 left-4 z-30">
	<ZoomControl {game} />
</div>

{#if !isReplaying}
	<div class="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1">
		{#if loadError}
			<p class="rounded bg-white px-2 py-0.5 text-[10px] text-red-500 shadow">{loadError}</p>
		{/if}
		<CaptureBar
			{game}
			bind:activeTab
			bind:isRecording
			onLoadReplay={() => {
				loadError = '';
				replayBar?.load();
			}}
			onRecorded={(project, audioBlob) => replayBar?.replay(project, audioBlob)}
		/>
	</div>
{/if}

<ReplayBar
	bind:this={replayBar}
	{game}
	disabled={isRecording}
	onEnter={() => (isReplaying = true)}
	onExit={() => (isReplaying = false)}
	onLoadFrame={(f) => (replayFrame = f)}
	onLoadError={(m) => (loadError = m)}
/>

<div class="fixed bottom-4 right-4 z-30">
	<FullscreenButton />
</div>
