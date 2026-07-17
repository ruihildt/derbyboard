<script lang="ts">
	import { CogOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { isMobile } from '$lib/stores/viewport';
	import { formatRatio, type CaptureFormat } from '$lib/utils/capture';
	import CaptureModeSelect from './CaptureModeSelect.svelte';
	import RecordControl from './RecordControl.svelte';
	import RegionModeToggle from './RegionModeToggle.svelte';
	import ScreenshotControl from './ScreenshotControl.svelte';
	import SettingsModal from './SettingsModal.svelte';
	import ZoneFormatSelect from './ZoneFormatSelect.svelte';

	let {
		game,
		activeTab = $bindable<'video' | 'screenshot'>('video'),
		isRecording = $bindable(false),
		regionMode = $bindable<'board' | 'edit'>('board'),
		onRecorded
	}: {
		game: KonvaGame;
		activeTab?: 'video' | 'screenshot';
		isRecording?: boolean;
		regionMode?: 'board' | 'edit';
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	// Busy signal from the video controls (covers countdown + active recording).
	let videoLocked = $state(false);
	let settingsOpen = $state(false);

	function setFormat(format: CaptureFormat) {
		captureSettings.update((s) => ({
			...s,
			format,
			// Set the new default zone directly. Clearing to `undefined` makes
			// captureZone falsy, unmounting the overlay and remounting it — which
			// resets the centering baseline so the ratio-change centering never
			// fires. Keeping a valid zone keeps it mounted so that effect runs.
			zone: format === 'full' ? s.zone : game.defaultZone(formatRatio(format))
		}));
	}
</script>

<div class="flex items-stretch gap-2">
	{#if !videoLocked}
		<!-- Toolbar: Settings | Custom Region | Screenshot/Video (hidden while recording) -->
		<div class="control-bar flex items-center gap-1 rounded-lg bg-white shadow-lg shadow-black/10">
			<button
				class="flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-700 hover:bg-primary-200"
				onclick={() => (settingsOpen = true)}
				aria-label="Settings"
			>
				<CogOutline class="h-4 w-4" />
				<span class:hidden={$isMobile}>Settings</span>
			</button>

			<ZoneFormatSelect
				format={$captureSettings.format}
				disabled={videoLocked}
				onchange={setFormat}
			/>

			{#if $captureSettings.format !== 'full'}
				<RegionModeToggle bind:mode={regionMode} />
			{/if}

			<CaptureModeSelect
				mode={activeTab}
				disabled={videoLocked}
				onchange={(m) => (activeTab = m)}
			/>
		</div>
	{/if}

	<!-- Recording Bar: active controls (always visible; the start/stop focus while recording) -->
	<div class="control-bar flex items-center rounded-lg bg-white shadow-lg shadow-black/10">
		{#if activeTab === 'video'}
			<RecordControl bind:isRecording bind:locked={videoLocked} {game} {onRecorded} />
		{:else}
			<ScreenshotControl {game} disabled={videoLocked} />
		{/if}
	</div>
</div>

<SettingsModal bind:open={settingsOpen} />
