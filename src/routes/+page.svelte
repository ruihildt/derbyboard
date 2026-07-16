<script lang="ts">
	import { onMount } from 'svelte';

	import { KonvaGame } from '$lib/konva/KonvaGame';

	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import Changelog from '$lib/components/Changelog.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import RotateHint from '$lib/components/RotateHint.svelte';
	import ZoneOverlay from '$lib/components/ZoneOverlay.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { isMobile } from '$lib/stores/viewport';
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
	let changelog: { open: () => void } | undefined = $state();
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

<main class="h-[100dvh] w-[100dvw]">
	<div id="container" class="absolute left-0 top-0 h-[100dvh] w-[100dvw]"></div>
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

{#if !isReplaying}
	<div
		class="fixed left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] z-30"
	>
		<Menu
			{game}
			onOpenArchive={() => {
				loadError = '';
				replayBar?.load();
			}}
			onOpenNews={() => changelog?.open()}
		/>
	</div>
{/if}

{#if !isReplaying}
	<div
		class="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-30"
	>
		<Changelog bind:this={changelog} />
	</div>
{/if}

{#if !isReplaying}
	{#if !$isMobile}
		<!-- Desktop: zoom bottom-left. -->
		<div
			class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-30"
		>
			<ZoomControl {game} />
		</div>
	{:else}
		<!-- Mobile: zoom grouped top-right. -->
		<div
			class="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-30 flex items-center gap-2"
		>
			<ZoomControl {game} />
		</div>
	{/if}
{/if}

{#if !isReplaying}
	<div
		class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1 px-2"
	>
		<RotateHint />
		{#if loadError}
			<p class="rounded bg-white px-2 py-0.5 text-[10px] text-red-500 shadow">{loadError}</p>
		{/if}
		<CaptureBar
			{game}
			bind:activeTab
			bind:isRecording
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
