<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { CloseOutline, PlusOutline } from 'flowbite-svelte-icons';

	import { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import {
		createAuthoredClipFromBoard,
		getActiveClip,
		activeStepIndex,
		navigateToStep,
		loadStepOntoBoard,
		syncAuthoringStateFromSession
	} from '$lib/doc/clipOps';

	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import BoardSettings from '$lib/components/BoardSettings.svelte';
	import Changelog from '$lib/components/Changelog.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import RotateHint from '$lib/components/RotateHint.svelte';
	import UndoRedoControls from '$lib/components/UndoRedoControls.svelte';
	import ZoneOverlay from '$lib/components/ZoneOverlay.svelte';
	import WatermarkPreview from '$lib/components/WatermarkPreview.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';
	import AuthoringPanel from '$lib/components/AuthoringPanel.svelte';
	import PresetMenu from '$lib/components/PresetMenu.svelte';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { exportSettings } from '$lib/stores/exportSettings';
	import { isMobile } from '$lib/stores/viewport';
	import { authoringSession } from '$lib/stores/session';
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
	let boardSettingsModal: { open: () => void } | undefined = $state();
	let loadError = $state('');
	let notice = $state('');

	let replayFrame = $state<TimelineFrame | null>(null);
	let replaySource = $state<{ w: number; h: number } | null>(null);

	type CaptureTab = 'video' | 'screenshot';
	let activeTab = $state<CaptureTab>('video');
	// Capture-region interaction mode: 'board' = fully pass-through (default),
	// 'edit' = resize handles hot. Only meaningful while a region is editable.
	let regionMode = $state<'board' | 'edit'>('board');

	// Replay framing overlay. Region archives draw their capture region;
	// full-frame archives draw the whole source viewport so the letterbox bars
	// (window-vs-source aspect mismatch) are darkened too. The region case keeps
	// its outline; full-frame suppresses it (the dark bars already delineate the
	// frame). Otherwise the shared capture selection overlay shows for any
	// non-full format and stays visible during recording to mark the capture area.
	let replayZone = $derived(
		isReplaying && replaySource
			? (replayFrame?.region ?? { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 })
			: undefined
	);
	let captureZone = $derived(
		!isReplaying && $captureSettings.format !== 'full' ? $captureSettings.zone : undefined
	);
	let captureRatio = $derived(formatRatio($captureSettings.format));
	let interactive = $derived(!isRecording && !replayFrame);
	let isAuthoring = $derived($authoringSession.activeClipId ? !!getActiveClip($boardDoc) : false);

	// Keyboard shortcuts for undo/redo + authored step navigation.
	function handleKeydown(e: KeyboardEvent) {
		// Don't trigger shortcuts during replay or recording
		if (isReplaying || isRecording) return;

		const target = e.target as HTMLElement | null;
		const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

		const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
		const isRedo = (e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey;

		if (isUndo) {
			e.preventDefault();
			boardDoc.undo();
		} else if (isRedo) {
			e.preventDefault();
			boardDoc.redo();
		} else if (isAuthoring && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			const delta = e.key === 'ArrowRight' ? 1 : -1;
			const clip = getActiveClip($boardDoc);
			if (!clip || !game) return;
			const currentIdx = activeStepIndex($boardDoc);
			const targetIdx = Math.max(0, Math.min(clip.steps.length - 1, currentIdx + delta));
			if (targetIdx === currentIdx) return;
			const targetStep = clip.steps[targetIdx];
			if (!targetStep) return;
			// Update session index first, then tween; on completion, load the
			// target step onto the board so the document reflects the new state.
			navigateToStep(targetIdx, false);
			game.tweenToStep(targetStep.entities, 300, () => loadStepOntoBoard(targetIdx));
		}
	}

	// Initialize the shared zone to the whole track the first time a non-full
	// format is selected.
	$effect(() => {
		if ($captureSettings.format === 'full') return;
		if ($captureSettings.zone) return;
		if (!game) return;
		captureSettings.update((s) => ({ ...s, zone: game.defaultZone(formatRatio(s.format)) }));
	});

	onMount(() => {
		const el = document.getElementById('container')!;
		game = new KonvaGame(
			'container',
			el.clientWidth || window.innerWidth,
			el.clientHeight || window.innerHeight
		);

		// Restore an authored session (active clip + step) persisted across reload.
		syncAuthoringStateFromSession();

		// Add keyboard event listener
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		// Remove keyboard event listener
		window.removeEventListener('keydown', handleKeydown);
	});
</script>

<main class="relative h-[100dvh] w-[100dvw] overflow-hidden">
	<div id="container" class="absolute left-0 top-0 h-[100dvh] w-[100dvw]"></div>
	{#if replayZone}
		<ZoneOverlay
			zone={replayZone}
			source={replaySource ?? undefined}
			ratio={null}
			interactive={false}
			mode={replayFrame ? 'board' : 'edit'}
			onchange={() => {}}
		/>
	{:else if captureZone}
		<ZoneOverlay
			zone={captureZone}
			ratio={captureRatio}
			{interactive}
			mode={regionMode}
			watermark={$exportSettings.watermark !== 'hidden'}
			onchange={(z) => captureSettings.update((s) => ({ ...s, zone: z }))}
		/>
	{:else if $exportSettings.watermark !== 'hidden' && $captureSettings.format === 'full'}
		<!-- Watermark preview for full-page capture (no selection region). -->
		<div class="pointer-events-none fixed inset-0 z-20">
			<WatermarkPreview />
		</div>
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
			onOpenBoardSettings={() => boardSettingsModal?.open()}
		/>
	</div>
{/if}

<BoardSettings bind:this={boardSettingsModal} {game} />

{#if !isReplaying}
	{#if !$isMobile}
		<!-- Desktop: lineup + new drill top-left (right of Menu), zoom bottom-left, undo/redo to the right of zoom. -->
		<div
			class="fixed left-[max(4rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] z-30 flex items-center gap-2"
		>
			<PresetMenu />
			{#if !isAuthoring}
				<button
					type="button"
					class="flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-500 px-3 text-sm font-medium text-white shadow-lg shadow-black/5 hover:bg-primary-600"
					onclick={() => createAuthoredClipFromBoard()}
				>
					<PlusOutline class="h-5 w-5" />
					New drill
				</button>
			{/if}
		</div>
		<div
			class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-30 flex items-center gap-2"
		>
			<ZoomControl {game} />
			<UndoRedoControls />
		</div>
	{:else}
		<!-- Mobile: undo/redo, zoom, presets and new-drill top-right (menu stays top-left). -->
		<div
			class="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-30 flex flex-col items-end gap-2"
		>
			<div class="flex items-center gap-2">
				<UndoRedoControls />
				<ZoomControl {game} />
			</div>
			{#if !isAuthoring}
				<div class="flex items-center gap-2">
					<PresetMenu />
					<button
						type="button"
						class="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-primary-500 px-2 text-xs font-medium text-white shadow-lg shadow-black/5 hover:bg-primary-600"
						onclick={() => createAuthoredClipFromBoard()}
						aria-label="New drill"
					>
						<PlusOutline class="h-5 w-5" />
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Changelog badge: desktop top-right, mobile below top-right toolbar. -->
	<div
		class={$isMobile
			? 'fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(4rem,env(safe-area-inset-top))] z-30'
			: 'fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-[60]'}
	>
		<Changelog bind:this={changelog} />
	</div>
{/if}

{#if !isReplaying}
	<div
		class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 flex flex-col items-center gap-1 px-2"
	>
		<RotateHint />
		{#if notice}
			<div
				class="flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 shadow-lg shadow-black/10"
			>
				<span class="text-center">{notice}</span>
				<button
					type="button"
					class="flex h-6 w-6 flex-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					onclick={() => (notice = '')}
					aria-label="Dismiss"
				>
					<CloseOutline class="h-4 w-4" />
				</button>
			</div>
		{/if}
		{#if loadError}
			<p class="rounded bg-white px-2 py-0.5 text-[10px] text-red-500 shadow">{loadError}</p>
		{/if}
		<CaptureBar
			{game}
			bind:activeTab
			bind:isRecording
			bind:regionMode
			onRecorded={(project, audioBlob) => replayBar?.replay(project, audioBlob)}
		/>
	</div>
{/if}

<ReplayBar
	bind:this={replayBar}
	{game}
	disabled={isRecording}
	onEnter={() => {
		isReplaying = true;
		notice = '';
	}}
	onExit={() => (isReplaying = false)}
	onLoadFrame={(f, s) => {
		replayFrame = f;
		replaySource = s;
	}}
	onLoadError={(m) => (loadError = m)}
	onNotice={(m) => (notice = m)}
/>

{#if !isReplaying}
	<AuthoringPanel {game} />
{/if}
