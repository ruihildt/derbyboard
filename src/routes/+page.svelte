<script lang="ts">
	import { onMount } from 'svelte';

	import { KonvaGame } from '$lib/konva/KonvaGame';

	import Changelog from '$lib/components/Changelog.svelte';
	import FrameOverlay from '$lib/components/FrameOverlay.svelte';
	import FullscreenButton from '$lib/components/FullscreenButton.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import RecordControl from '$lib/components/RecordControl.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';
	import { recordingSettings } from '$lib/stores/recordingSettings';
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

	// Effective frame to render: replay uses the project's stored frame; otherwise
	// the persisted region (when Region mode is on). Until the default-init effect
	// below populates `region`, no frame is shown.
	let frame = $derived<TimelineFrame | null>(
		replayFrame
			? replayFrame
			: $recordingSettings.mode === 'region' && $recordingSettings.region
				? { ratio: $recordingSettings.ratio, region: $recordingSettings.region }
				: null
	);
	let interactive = $derived(!isRecording && !replayFrame);

	// Initialize the persisted region to a sensible default (whole track + margin)
	// the first time Region mode is enabled.
	$effect(() => {
		if ($recordingSettings.mode !== 'region') return;
		if ($recordingSettings.region) return;
		if (!game) return;
		recordingSettings.update((s) => ({ ...s, region: game.defaultRegion(s.ratio) }));
	});

	onMount(() => {
		game = new KonvaGame('container', window.innerWidth, window.innerHeight);
	});
</script>

<main class="h-screen w-screen">
	<div id="container" class="absolute left-0 top-0 h-screen w-screen"></div>
	{#if frame}
		<FrameOverlay
			ratio={frame.ratio}
			region={frame.region}
			{interactive}
			onchange={(r) => recordingSettings.update((s) => ({ ...s, region: r }))}
		/>
	{/if}
</main>

<div class="fixed left-4 top-4">
	<Menu {game} />
</div>

<div class="fixed bottom-4 left-4">
	<ZoomControl {game} />
</div>

{#if !isReplaying}
	<div class="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1">
		{#if loadError}
			<p class="rounded bg-white px-2 py-0.5 text-[10px] text-red-500 shadow">{loadError}</p>
		{/if}
		<RecordControl
			bind:isRecording
			{game}
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

<div class="fixed bottom-4 right-4 flex gap-2">
	<Changelog />
	<FullscreenButton />
</div>
