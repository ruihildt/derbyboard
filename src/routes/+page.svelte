<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { CloseOutline } from 'flowbite-svelte-icons';

	import { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import {
		getActiveClip,
		activeStepIndex,
		navigateToStep,
		loadStepOntoBoard,
		syncAuthoringStateFromSession
	} from '$lib/doc/clipOps';
	import { getCapabilities } from '$lib/experiences/capabilities';
	import { toolMode } from '$lib/stores/toolMode';
	import { authoringSession } from '$lib/stores/session';

	import TopBar from '$lib/components/TopBar.svelte';
	import StepStrip from '$lib/components/StepStrip.svelte';
	import BottomStrip from '$lib/components/BottomStrip.svelte';
	import ZoomControl from '$lib/components/ZoomControl.svelte';
	import UndoRedoControls from '$lib/components/UndoRedoControls.svelte';
	import BoardSettings from '$lib/components/BoardSettings.svelte';
	import Library from '$lib/components/Library.svelte';
	import Changelog from '$lib/components/Changelog.svelte';
	import ReplayBar from '$lib/components/ReplayBar.svelte';
	import RotateHint from '$lib/components/RotateHint.svelte';
	import ZoneOverlay from '$lib/components/ZoneOverlay.svelte';
	import BrandingPreview from '$lib/components/BrandingPreview.svelte';
	import Hud from '$lib/components/Hud.svelte';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { exportSettings } from '$lib/stores/exportSettings';
	import { regionMode } from '$lib/stores/regionMode';
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
	let library: { open: () => void } | undefined = $state();
	/** True while the sidebar is pinned AND open — drives canvas/bar framing. */
	let sidebarDocked = $state(false);
	let boardSettingsModal: { open: () => void } | undefined = $state();
	let loadError = $state('');
	let notice = $state('');

	let replayFrame = $state<TimelineFrame | null>(null);
	let replaySource = $state<{ w: number; h: number } | null>(null);

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

	// The canvas reserves space for the sidebar only while it's docked (pinned
	// AND open) and never during replay (the sidebar is unmounted then).
	let docked = $derived(sidebarDocked && !isReplaying);

	// Experience capabilities are derived from the document shape (active
	// authored clip + its domain). Components gate on these, not on mode
	// strings. Touch both stores so this re-derives when either changes.
	const caps = $derived.by(() => {
		void $boardDoc;
		void $authoringSession;
		return getCapabilities($boardDoc);
	});

	// Bottom strip: merged zone hosting the drill step timeline (StepStrip)
	// or the replay controls (ReplayBar). Hidden in free play. When visible,
	// the canvas frame shrinks above it (measured via the strip root since
	// drill and replay heights differ).
	let stripEl = $state<HTMLDivElement | undefined>();
	let stripHeight = $state(0);
	let stripVisible = $derived(caps.timeline || isReplaying);

	// When the canvas box changes (sidebar docked/undocked, strip shown/hidden
	// or resized, or replay), tell KonvaGame to re-measure its container and
	// re-fit. Svelte runs this effect after the DOM box has applied, so the
	// measurement is current.
	$effect(() => {
		void docked;
		void stripVisible;
		void stripHeight;
		game?.resize();
	});

	$effect(() => {
		if (!stripEl) {
			stripHeight = 0;
			return;
		}
		stripHeight = stripEl.clientHeight;
		const ro = new ResizeObserver(() => {
			stripHeight = stripEl?.clientHeight ?? 0;
		});
		ro.observe(stripEl);
		return () => ro.disconnect();
	});

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
		} else if (caps.timeline && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
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

<main
	class="relative {docked ? 'w-[calc(100dvw-18rem)]' : 'w-[100dvw]'} overflow-hidden"
	style="height: calc(100dvh - {stripVisible ? stripHeight : 0}px)"
>
	<div
		id="container"
		class="absolute left-0 top-0 h-full w-full {$toolMode === 'hand'
			? 'cursor-grab active:cursor-grabbing'
			: ''}"
	></div>
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
			mode={$regionMode}
			branding={$exportSettings.branding !== 'hidden'}
			onchange={(z) => captureSettings.update((s) => ({ ...s, zone: z }))}
		/>
	{:else if $exportSettings.branding !== 'hidden' && $captureSettings.format === 'full'}
		<!-- Branding preview for full-page capture (no selection region).
		     Framed to <main> (the canvas frame) so the logo sits at the canvas
		     corner, not under a docked sidebar. -->
		<div class="pointer-events-none absolute inset-0 z-20">
			<BrandingPreview />
		</div>
	{/if}
</main>

<BoardSettings bind:this={boardSettingsModal} {game} />

{#if !isReplaying}
	<!-- Consolidated top control shell: Menu + experience switcher + lineup,
	     tool palette (Staged). Capture + zoom + undo/redo live at the bottom. -->
	<TopBar
		{game}
		{docked}
		bind:isRecording
		onOpenArchive={() => {
			loadError = '';
			replayBar?.load();
		}}
		onOpenNews={() => changelog?.open()}
		onOpenBoardSettings={() => boardSettingsModal?.open()}
		onOpenLibrary={() => library?.open()}
		onRecorded={(project, audioBlob) => replayBar?.replay(project, audioBlob)}
	/>
{/if}

<!-- Changelog drawer: opened via the Menu's "News" item. -->
{#if !isReplaying}
	<Changelog bind:this={changelog} />
{/if}

<!-- Library drawer: opened via the top-right BookOpen trigger. -->
{#if !isReplaying}
	<Library bind:this={library} onDockedChange={(d) => (sidebarDocked = d)} />
{/if}

<!-- Transient toast stack (rotate hint / notices / errors), below the top bar. -->
<div
	class="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex flex-col items-center gap-1 px-2 {docked
		? 'left-[calc(50%-12rem)]'
		: 'left-1/2'} -translate-x-1/2"
>
	<RotateHint />
	{#if notice}
		<div
			class="pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 shadow-lg shadow-black/10"
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
</div>

<!-- Bottom strip: a single floating rounded bar (matching the zoom / capture
     bar aesthetic) merging the drill step timeline and the replay controls.
     Hidden in free play; reserves real layout space — the canvas frame above
     shrinks by the shell's measured height (padding included). Zoom + undo/redo
     stay floating separately, lifted above the strip while it's visible.
     ReplayBar stays mounted inside even when hidden so its imperative
     load()/replay() entry points remain callable from TopBar in free play. -->
<BottomStrip {docked} hidden={!stripVisible} bind:el={stripEl}>
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
	{#if !isReplaying && caps.timeline}
		<StepStrip {game} />
	{/if}
</BottomStrip>

{#if !isReplaying}
	<!-- Floating zoom + undo/redo, lifted above the strip when visible. -->
	<div
		class="pointer-events-none fixed left-0 z-40 px-[max(1rem,env(safe-area-inset-left))]"
		style="bottom: calc({stripVisible
			? stripHeight
			: 0}px + max(0.5rem, env(safe-area-inset-bottom)))"
	>
		<div class="pointer-events-auto flex items-center gap-2">
			<ZoomControl {game} />
			<UndoRedoControls />
		</div>
	</div>
	<Hud {game} />
{/if}
