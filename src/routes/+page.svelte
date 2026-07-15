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
	import { recordingSettings } from '$lib/stores/recordingSettings';
	import { screenshotSettings } from '$lib/stores/screenshotSettings';
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

	// Replay uses the project's stored frame (non-interactive). On the Video tab,
	// the selection overlay shows for any non-full format; it stays visible during
	// recording (non-interactive) to mark the capture area.
	let replayOverlay = $derived(!!replayFrame);
	let videoZone = $derived(
		activeTab === 'video' && $recordingSettings.format !== 'full'
			? $recordingSettings.zone
			: undefined
	);
	let videoRatio = $derived(formatRatio($recordingSettings.format));
	let interactive = $derived(!isRecording && !replayFrame);

	// Screenshot selection overlay, shown on the Screenshot tab for any non-full format.
	let screenshotZone = $derived(
		activeTab === 'screenshot' && $screenshotSettings.format !== 'full'
			? $screenshotSettings.zone
			: undefined
	);
	let screenshotRatio = $derived(formatRatio($screenshotSettings.format));

	// Initialize the recording zone to the whole track the first time a non-full
	// format is active on the Video tab.
	$effect(() => {
		if (activeTab !== 'video') return;
		if ($recordingSettings.format === 'full') return;
		if ($recordingSettings.zone) return;
		if (!game) return;
		recordingSettings.update((s) => ({ ...s, zone: game.defaultZone(formatRatio(s.format)) }));
	});

	// Initialize the screenshot zone to the whole track the first time a non-full
	// format is active on the Screenshot tab.
	$effect(() => {
		if (activeTab !== 'screenshot') return;
		if ($screenshotSettings.format === 'full') return;
		if ($screenshotSettings.zone) return;
		if (!game) return;
		screenshotSettings.update((s) => ({ ...s, zone: game.defaultZone(formatRatio(s.format)) }));
	});

	onMount(() => {
		game = new KonvaGame('container', window.innerWidth, window.innerHeight);
	});
</script>

<main class="h-screen w-screen">
	<div id="container" class="absolute left-0 top-0 h-screen w-screen"></div>
	{#if replayOverlay && replayFrame}
		<ZoneOverlay zone={replayFrame.region} ratio={null} interactive={false} onchange={() => {}} />
	{:else if videoZone}
		<ZoneOverlay
			zone={videoZone}
			ratio={videoRatio}
			{interactive}
			onchange={(z) => recordingSettings.update((s) => ({ ...s, zone: z }))}
		/>
	{/if}
	{#if screenshotZone}
		<ZoneOverlay
			zone={screenshotZone}
			ratio={screenshotRatio}
			{interactive}
			onchange={(z) => screenshotSettings.update((s) => ({ ...s, zone: z }))}
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
