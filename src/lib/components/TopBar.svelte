<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { getCapabilities } from '$lib/experiences/capabilities';
	import { toolMode, isCaptureTool, type DrawTool } from '$lib/stores/toolMode';
	import { captureMode, type CaptureMode } from '$lib/stores/captureMode';
	import { captureScreenshot } from '$lib/utils/screenshot';
	import { 		BookOpenOutline,
		CameraPhotoOutline
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
		{ id: 'lasso', label: 'Lasso select', icon: '' },
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
	// active experience (e.g. a drawing tool armed in Staged, then the board
	// drops back to Live; or the `hand` tool armed in Live, then a clip turns
	// the board into Staged). Capture tools are always available and exempt.
	$effect(() => {
		if (isCaptureTool($toolMode)) return;
		if (!caps.admittedTools.includes($toolMode)) {
			toolMode.set('select');
		}
	});
</script>

<div
	class="pointer-events-none fixed top-0 z-30 {docked
		? 'left-0 right-[18rem]'
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
	     is shared across Live and Staged; the drawing tools appear only in
	     Staged (behind a divider). The switcher badge indicates the mode. -->
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
						{#if tool.id === 'drawPath'}
							<div class="mx-0.5 h-6 w-px self-center bg-gray-200"></div>
						{/if}
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
										viewBox="0 0 36 36"
										fill="currentColor"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M14.58,32.31a1,1,0,0,1-.94-.65L4,5.65A1,1,0,0,1,5.25,4.37l26,9.68a1,1,0,0,1-.05,1.89l-8.36,2.57,8.3,8.3a1,1,0,0,1,0,1.41l-3.26,3.26a1,1,0,0,1-.71.29h0a1,1,0,0,1-.71-.29l-8.33-8.33-2.6,8.45a1,1,0,0,1-.93.71Zm3.09-12a1,1,0,0,1,.71.29l8.79,8.79L29,27.51l-8.76-8.76a1,1,0,0,1,.41-1.66l7.13-2.2L6.6,7l7.89,21.2L16.71,21a1,1,0,0,1,.71-.68Z"/>
									</svg>
								{:else if tool.id === 'lasso'}
									<!-- Lasso glyph: the Lasso select tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.4"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M7 22a5 5 0 01-2-4" />
										<path d="M3.3 14A6.8 6.8 0 012 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 01-5-1" />
										<path d="M5 18a2 2 0 100-4 2 2 0 000 4z" />
									</svg>
								{:else if tool.id === 'hand'}
									<!-- Open-hand glyph: the dedicated Pan tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M14 3.5V11V4.5C14 3.67157 14.6716 3 15.5 3C16.3284 3 17 3.67157 17 4.5V11V7.5C17 6.67157 17.6716 6 18.5 6C19.3284 6 20 6.67157 20 7.5V16C20 19.3137 17.3137 22 14 22H12.8727C11.3483 22 9.88112 21.4198 8.76904 20.3772L3.81045 15.7285C3.09365 15.0565 3.0754 13.9246 3.77016 13.2298C4.44939 12.5506 5.55063 12.5506 6.22985 13.2298L8.00001 15V6.5C8.00001 5.67157 8.67158 5 9.50001 5C10.3284 5 11 5.67157 11 6.5V11V3.5C11 2.67157 11.6716 2 12.5 2C13.3284 2 14 2.67157 14 3.5Z" />
									</svg>
								{:else if tool.id === 'drawPath'}
									<!-- Draw movement path glyph. -->
									<svg
										class="h-[21px] w-[21px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M4 15V8.5a4.5 4.5 0 0 1 9 0v7a2.5 2.5 0 1 0 5 0V8.83a3.001 3.001 0 1 1 2 0v6.67a4.5 4.5 0 1 1-9 0v-7a2.5 2.5 0 0 0-5 0V15h3l-4 5-4-5h3zm15-8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
									</svg>
								{:else if tool.id === 'pen'}
									<!-- Freehand pen glyph. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path
											d="M15.728 9.686l-1.414-1.414L5 17.586V19h1.414l9.314-9.314zm1.414-1.414l1.414-1.414-1.414-1.414-1.414 1.414 1.414 1.414zM7.242 21H3v-4.243L16.435 3.322a1 1 0 0 1 1.414 0l2.829 2.829a1 1 0 0 1 0 1.414L7.243 21z"
										/>
									</svg>
								{:else if tool.id === 'arrow'}
									<!-- Arrow glyph: the Arrow annotation tool. -->
									<svg
										class="h-[21px] w-[21px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M17.71 16.29L9.42 8H15a1 1 0 0 0 0-2H7.05a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1H7a1 1 0 0 0 1-1V9.45l8.26 8.26a1 1 0 0 0 1.42 0 1 1 0 0 0 .03-1.42z"/>
									</svg>
								{:else if tool.id === 'zone'}
									<!-- Zone glyph: the Zone annotation tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 297 297"
										fill="currentColor"
										stroke="currentColor"
										stroke-width="6"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M165.797,288.71c-16.89,0-23.974-15.545-26.301-20.652c-1.919-4.214-4.4-6.728-6.637-6.728
		c-1.343,0-2.797,0.826-3.621,2.059c-10.602,15.854-29.265,25.322-49.922,25.322c-34.197,0-62.021-27.887-62.021-62.166
		c0-21.166,8.271-38.889,22.124-47.404c3.865-2.381,5.826-4.702,5.826-6.9c0-2.814-3.012-4.884-5.989-5.476
		C15.409,162.026,0,144.645,0,122.485c0-24.713,20.065-44.82,44.729-44.82c11.259,0,22.653,4.772,30.479,12.766
		c3.585,3.661,7.638,5.365,12.756,5.365c8.769,0,16.306-6.502,16.459-14.196c0.047-2.183-0.073-9.916-0.124-12.712
		c-0.001-0.063-0.002-0.124-0.002-0.185c0-33.875,27.013-60.413,61.499-60.413c34.199,0,62.024,27.887,62.024,62.166
		c0,14.94-7.221,31.259-12.493,43.174l-0.237,0.537c-3.781,8.552-3.697,16.272,0.246,22.327c4.468,6.86,13.725,11.124,24.159,11.124
		c1.115,0,2.254-0.048,3.384-0.143c2.557-0.215,7.247-0.388,9.649-0.428c0.243-0.004,0.471-0.006,0.7-0.006
		c24.135,0,43.77,20.104,43.77,44.818c0,24.714-20.065,44.82-44.729,44.82c-12.84,0-22.554-6.859-30.36-12.371
		c-0.97-0.685-1.936-1.366-2.905-2.034c-4.171-2.877-7.974-4.159-12.333-4.159c-4.903,0-9.571,2.035-13.147,5.728
		c-3.759,3.884-5.732,9.02-5.557,14.46c0.102,3.117,0.82,5.201,1.91,8.355c1.066,3.087,2.392,6.927,3.264,12.284
		c1.13,6.959-0.928,13.939-5.793,19.656C181.964,284.93,173.906,288.71,165.797,288.71z M132.859,241.057
		c10.559,0,19.702,6.778,25.084,18.596c4.004,8.785,6.701,8.785,7.854,8.785c2.142,0,4.599-1.195,6.113-2.975
		c0.55-0.647,1.44-1.931,1.222-3.269c-0.591-3.637-1.477-6.201-2.414-8.916c-1.317-3.814-2.812-8.137-3.012-14.318
		c-0.355-10.979,3.642-21.355,11.255-29.217c7.319-7.563,17.421-11.899,27.712-11.899c8.487,0,16.285,2.532,23.837,7.739
		c1.029,0.709,2.061,1.436,3.094,2.166c6.58,4.646,12.264,8.658,18.668,8.658c13.484,0,24.456-11.011,24.456-24.547
		c0-13.534-10.541-24.547-23.498-24.547l-0.364,0.004c-2.324,0.04-6.461,0.206-8.29,0.359c-1.692,0.142-3.401,0.213-5.079,0.213
		c-17.474,0-32.855-7.6-41.145-20.331c-7.756-11.908-8.395-26.679-1.8-41.591l0.237-0.541c4.543-10.262,10.761-24.316,10.761-34.971
		c0-23.1-18.73-41.893-41.752-41.893c-23.473,0-41.181,17.214-41.227,40.053c0.025,1.451,0.185,10.525,0.121,13.406
		c-0.373,18.766-16.85,34.047-36.727,34.047c-10.633,0-19.798-3.854-27.24-11.454c-3.972-4.057-10.25-6.677-15.995-6.677
		c-13.485,0-24.457,11.012-24.457,24.547c0,12.422,8.573,21.542,22.935,24.395c13.139,2.611,22.313,13.039,22.313,25.359
		c0,6.678-2.686,16.292-15.477,24.166c-9.2,5.656-12.476,19.276-12.476,30.139c0,23.1,18.729,41.894,41.749,41.894
		c13.875,0,26.239-6.103,33.074-16.325C116.959,245.29,124.8,241.057,132.859,241.057z"/>
									</svg>
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
								{:else if tool.id === 'label'}
									<!-- Text field glyph: the Label tool. -->
									<svg
										class="h-[21px] w-[21px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M7.88383 7.75C7.48429 7.74996 7.11779 7.74992 6.81782 7.78733C6.48915 7.82833 6.13878 7.9242 5.83756 8.19187C5.78618 8.23753 5.73753 8.28618 5.69187 8.33756C5.4242 8.63878 5.32833 8.98915 5.28733 9.31782C5.24992 9.61779 5.24996 9.98428 5.25 10.3838L5.25001 10.425C5.25001 10.8392 5.58579 11.175 6.00001 11.175C6.41422 11.175 6.75001 10.8392 6.75001 10.425C6.75001 9.97047 6.75137 9.69931 6.7758 9.50348C6.80023 9.30765 7.00348 9.2758 7.00348 9.2758C7.19931 9.25137 7.47047 9.25001 7.92501 9.25001H8.25001V14.75H7.00001C6.58579 14.75 6.25001 15.0858 6.25001 15.5C6.25001 15.9142 6.58579 16.25 7.00001 16.25H11C11.4142 16.25 11.75 15.9142 11.75 15.5C11.75 15.0858 11.4142 14.75 11 14.75H9.75001V9.25001H10.075C10.5295 9.25001 10.8007 9.25137 10.9965 9.2758C10.9965 9.2758 11.1998 9.30765 11.2242 9.50348C11.2486 9.69931 11.25 9.97047 11.25 10.425C11.25 10.8392 11.5858 11.175 12 11.175C12.4142 11.175 12.75 10.8392 12.75 10.425L12.75 10.3838C12.7501 9.98428 12.7501 9.61779 12.7127 9.31782C12.6717 8.98915 12.5758 8.63878 12.3081 8.33756C12.2625 8.28618 12.2138 8.23753 12.1624 8.19187C11.8612 7.9242 11.5109 7.82833 11.1822 7.78733C11.5109 7.82833 10.8822 7.74992 10.1162 7.75H7.88383Z"/>
										<path fill-rule="evenodd" clip-rule="evenodd" d="M14.0564 3.25H9.94358C8.10583 3.24998 6.65019 3.24997 5.51098 3.40314C4.33856 3.56076 3.38961 3.89288 2.64124 4.64124C1.89288 5.38961 1.56076 6.33856 1.40314 7.51098C1.24997 8.65019 1.24998 10.1058 1.25 11.9436V12.0564C1.24998 13.8942 1.24997 15.3498 1.40314 16.489C1.56076 17.6614 1.89288 18.6104 2.64124 19.3588C3.38961 20.1071 4.33856 20.4392 5.51098 20.5969C6.65018 20.75 8.1058 20.75 9.94354 20.75H14.0564C15.8942 20.75 17.3498 20.75 18.489 20.5969C19.6614 20.4392 20.6104 20.1071 21.3588 19.3588C22.1071 18.6104 22.4392 17.6614 22.5969 16.489C22.75 15.3498 22.75 13.8942 22.75 12.0565V11.9436C22.75 10.1059 22.75 8.65018 22.5969 7.51098C22.4392 6.33856 22.1071 5.38961 21.3588 4.64124C20.6104 3.89288 19.6614 3.56076 18.489 3.40314C17.3498 3.24997 15.8942 3.24998 14.0564 3.25ZM3.7019 5.7019C4.12511 5.27869 4.70476 5.02502 5.71085 4.88976C6.73851 4.75159 8.09318 4.75 10 4.75H14C15.9068 4.75 17.2615 4.75159 18.2892 4.88976C19.2952 5.02502 19.8749 5.27869 20.2981 5.7019C20.7213 6.12511 20.975 6.70476 21.1102 7.71085C21.2484 8.73851 21.25 10.0932 21.25 12C21.25 13.9068 21.2484 15.2615 21.1102 16.2892C20.975 17.2952 20.7213 17.8749 20.2981 18.2981C19.8749 18.7213 19.2952 18.975 18.2892 19.1102C17.2615 19.2484 15.9068 19.25 14 19.25H10C8.09318 19.25 6.73851 19.2484 5.71085 19.1102C4.70476 18.975 4.12511 18.7213 3.7019 18.2981C3.27869 17.8749 3.02502 17.2952 2.88976 16.2892C2.75159 15.2615 2.75 13.9068 2.75 12C2.75 10.0932 2.75159 8.73851 2.88976 7.71085C3.02502 6.70476 3.27869 6.12511 3.7019 5.7019Z"/>
									</svg>
								{:else}
									{tool.icon}
								{/if}
							</button>
						{#if tool.id === 'drawPath'}
							<div class="mx-0.5 h-6 w-px self-center bg-gray-200"></div>
						{/if}
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
							<!-- Video glyph: the Video capture tool. -->
							<svg
								class="h-[18px] w-[18px]"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M16 10L18.5768 8.45392C19.3699 7.97803 19.7665 7.74009 20.0928 7.77051C20.3773 7.79703 20.6369 7.944 20.806 8.17433C21 8.43848 21 8.90095 21 9.8259V14.1741C21 15.099 21 15.5615 20.806 15.8257C20.6369 16.056 20.3773 16.203 20.0928 16.2295C19.7665 16.2599 19.3699 16.022 18.5768 15.5461L16 14M6.2 18H12.8C13.9201 18 14.4802 18 14.908 17.782C15.2843 17.5903 15.5903 17.2843 15.782 16.908C16 16.4802 16 15.9201 16 14.8V9.2C16 8.0799 16 7.51984 15.782 7.09202C15.5903 6.71569 15.2843 6.40973 14.908 6.21799C14.4802 6 13.9201 6 12.8 6H6.2C5.0799 6 4.51984 6 4.09202 6.21799C3.71569 6.40973 3.40973 6.71569 3.21799 7.09202C3 7.51984 3 8.07989 3 9.2V14.8C3 15.9201 3 16.4802 3.21799 16.908C3.40973 17.2843 3.71569 17.5903 4.09202 17.782C4.51984 18 5.07989 18 6.2 18Z" />
							</svg>
						{:else if tool.id === 'screenshot'}
							<!-- Screenshot glyph: the Screenshot capture tool. -->
							<svg
								class="h-[18px] w-[18px]"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4.27209 20.7279L10.8686 14.1314C11.2646 13.7354 11.4627 13.5373 11.691 13.4632C11.8918 13.3979 12.1082 13.3979 12.309 13.4632C12.5373 13.5373 12.7354 13.7354 13.1314 14.1314L19.6839 20.6839M14 15L16.8686 12.1314C17.2646 11.7354 17.4627 11.5373 17.691 11.4632C17.8918 11.3979 18.1082 11.3979 18.309 11.4632C18.5373 11.5373 18.7354 11.7354 19.1314 12.1314L22 15M10 9C10 10.1046 9.10457 11 8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9ZM6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z" />
							</svg>
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
