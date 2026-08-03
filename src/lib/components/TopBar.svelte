<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { getCapabilities } from '$lib/experiences/capabilities';
	import { toolMode, isCaptureTool, type DrawTool } from '$lib/stores/toolMode';
	import { captureMode, type CaptureMode } from '$lib/stores/captureMode';
	import { captureScreenshot } from '$lib/utils/screenshot';
	import {
		BookOpenOutline,
		CameraPhotoOutline,
		DrawSquareOutline,
		VideoCameraOutline
	} from 'flowbite-svelte-icons';

	import Menu from './Menu.svelte';
	import ToolSettingsPanel from './ToolSettingsPanel.svelte';
	import ExperienceSwitcher from './ExperienceSwitcher.svelte';
	import RecordControl from './RecordControl.svelte';

	let {
		game,
		docked = false,
		isRecording = $bindable(false),
		onOpenArchive,
		onOpenNews,
		onOpenBoardSettings,
		onOpenLibrary,
		onRecorded
	}: {
		game: KonvaGame;
		/** When true the Library sidebar is docked: the bar frames only the
		 * canvas area (right-inset by the sidebar width) so its centered
		 * content and right-anchored trigger follow the canvas, not the viewport. */
		docked?: boolean;
		isRecording?: boolean;
		onOpenArchive?: () => void;
		onOpenNews?: () => void;
		onOpenBoardSettings?: () => void;
		onOpenLibrary?: () => void;
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	// Busy signal from the video record control (covers countdown + active
	// recording). Disables capture-tool switching mid-recording.
	let videoLocked = $state(false);

	// Main menu open state — lifted so the settings panel can hide while the
	// menu occupies the same slot.
	let menuOpen = $state(false);

	// Capabilities are derived from the doc shape. Touch both stores so this
	// re-derives when either the document or the authoring session changes.
	const caps = $derived.by(() => {
		void $boardDoc;
		void $authoringSession;
		return getCapabilities($boardDoc);
	});

	const tools: { id: DrawTool; label: string; icon: string }[] = [
		{ id: 'hand', label: 'Pan (hand)', icon: '' },
		{ id: 'select', label: 'Select', icon: '' },
		{ id: 'drawPath', label: 'Draw movement path', icon: '' },
		{ id: 'pen', label: 'Freehand pen', icon: '✏' },
		{ id: 'arrow', label: 'Arrow', icon: '→' },
		{ id: 'zone', label: 'Zone', icon: '◯' },
		{ id: 'label', label: 'Label', icon: 'A' },
		{ id: 'erase', label: 'Erase', icon: '' }
	];

	// Capture tools live in the toolbar as their own group, separated from the
	// drawing tools. They arm the tool (mutually exclusive with the drawing
	// tools); the action control (record / capture button) renders top-right.
	const captureTools: { id: CaptureMode; label: string }[] = [
		{ id: 'video', label: 'Video' },
		{ id: 'screenshot', label: 'Screenshot' }
	];

	// Reset to the neutral tool whenever the current tool isn't admitted by the
	// active experience (e.g. a drawing tool armed in Drill, then the board
	// drops back to Free; or the `hand` tool armed in Free, then a clip turns
	// the board into Drill). Capture tools are always available and exempt.
	$effect(() => {
		if (isCaptureTool($toolMode)) return;
		if (!caps.admittedTools.includes($toolMode)) {
			toolMode.set('select');
		}
	});
</script>

<div
	class="pointer-events-none fixed top-0 z-30 {docked
		? 'left-0 right-[24rem]'
		: 'inset-x-0'} px-[max(0.75rem,env(safe-area-inset-left))] py-[max(0.5rem,env(safe-area-inset-top))]"
>
	<!-- Left column: Menu and the contextual settings panel share the same
	     slot — opening the menu hides the settings panel content. The wrapper
	     is pass-through so its empty area (it otherwise spans the full bar
	     width) doesn't block the capture-zone resize handles drawn below it
	     (ZoneOverlay, z-20). The Menu trigger and panel opt back in to
	     pointer events on their own roots. -->
	<div class="pointer-events-none flex flex-col items-start gap-2">
		<Menu bind:open={menuOpen} {game} {onOpenArchive} {onOpenNews} {onOpenBoardSettings} />
		{#if !menuOpen}
			<ToolSettingsPanel {game} />
		{/if}
	</div>

	<!-- Unified control bar (centered): board interactions only. The switcher
	     is shared across Free Play and Drill; the drawing tools appear only in
	     Drill (behind a divider). The switcher badge indicates the mode. -->
	<div
		class="pointer-events-auto flex absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] -translate-x-1/2 items-center gap-0.5"
	>
		<div
			class="flex flex-wrap items-center justify-center rounded-2xl bg-white p-1 shadow-lg shadow-black/10"
		>
			<ExperienceSwitcher />

			{#if caps.admittedTools.length > 0}
				<div class="mx-0.5 h-6 w-px self-center bg-gray-200"></div>
				<div class="flex items-center gap-0.5">
					{#each tools as tool (tool.id)}
						{#if caps.admittedTools.includes(tool.id)}
							<button
								type="button"
								class="flex min-h-11 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors {$toolMode ===
								tool.id
									? 'bg-primary-100 text-primary-700'
									: 'text-gray-600 hover:bg-primary-50'}"
								onclick={() => toolMode.set(tool.id)}
								aria-label={tool.label}
								title={tool.label}
							>
								{#if tool.id === 'select'}
									<!-- Mouse-cursor glyph: the Select tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M5.5 2.5v15l3.2-3 2.3 5 1.8-.8-2.3-5 4.5 0z" />
									</svg>
								{:else if tool.id === 'hand'}
									<!-- Open-hand glyph: the dedicated Pan tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M18 11V6a2 2 0 0 0-4 0" />
										<path d="M14 10V4a2 2 0 0 0-4 0v2" />
										<path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
										<path
											d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
										/>
									</svg>
								{:else if tool.id === 'drawPath'}
									<DrawSquareOutline class="h-[18px] w-[18px]" aria-hidden="true" />
								{:else if tool.id === 'erase'}
									<!-- Eraser glyph: tap an annotation to delete it. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path
											d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"
										/>
										<path d="M22 21H7" />
										<path d="m5 11 9 9" />
									</svg>
								{:else}
									{tool.icon}
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Capture tools: always available, separated from the drawing
			     palette. They arm the tool (mutually exclusive with the drawing
			     tools). Disabled while recording. -->
			<div class="mx-0.5 h-6 w-px self-center bg-gray-200"></div>
			<div class="flex items-center gap-0.5">
				{#each captureTools as tool (tool.id)}
					<button
						type="button"
						class="flex min-h-11 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors {$toolMode ===
						tool.id
							? 'bg-primary-100 text-primary-700'
							: 'text-gray-600 hover:bg-primary-50'} {videoLocked
							? 'cursor-not-allowed opacity-50'
							: ''}"
						onclick={() => {
							if (videoLocked) return;
							toolMode.set(tool.id);
							captureMode.set(tool.id);
						}}
						disabled={videoLocked}
						aria-label={tool.label}
						title={tool.label}
					>
						{#if tool.id === 'video'}
							<VideoCameraOutline class="h-[18px] w-[18px]" aria-hidden="true" />
						{:else}
							<CameraPhotoOutline class="h-[18px] w-[18px]" aria-hidden="true" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Top-right cluster: the capture action bar sits to the left of the
	     Library trigger. It's always shown — Video renders the record button
	     (with mic toggle), anything else defaults to the screenshot capture
	     button. The Library trigger itself is hidden while the sidebar is
	     docked, but the capture bar stays visible just left of the sidebar. -->
	<div
		class="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] flex items-center gap-1"
	>
		{#if $captureMode === 'video'}
			<div class="flex items-center rounded-lg bg-white p-1 shadow-lg shadow-black/5">
				<RecordControl bind:isRecording bind:locked={videoLocked} {game} {onRecorded} />
			</div>
		{:else}
			<div class="flex items-center rounded-lg bg-white p-1 shadow-lg shadow-black/5">
				<button
					type="button"
					class="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm text-gray-700 hover:bg-primary-200"
					onclick={() => captureScreenshot(game)}
					aria-label="Capture screenshot"
				>
					<CameraPhotoOutline class="h-5 w-5 text-gray-700" />
					Capture
				</button>
			</div>
		{/if}
		{#if !docked}
			<button
				type="button"
				onclick={onOpenLibrary}
				class="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white p-2 text-gray-700 shadow-lg shadow-black/5 hover:bg-primary-200"
				aria-label="Library"
				title="Library"
			>
				<BookOpenOutline class="h-6 w-6" />
			</button>
		{/if}
	</div>
</div>
