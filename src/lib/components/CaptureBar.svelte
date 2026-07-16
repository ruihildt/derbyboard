<script lang="ts">
	import { CogOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { isMobile } from '$lib/stores/viewport';
	import { type CaptureFormat } from '$lib/utils/capture';
	import CaptureModeSelect from './CaptureModeSelect.svelte';
	import RecordControl from './RecordControl.svelte';
	import ScreenshotControl from './ScreenshotControl.svelte';
	import SettingsModal from './SettingsModal.svelte';
	import ZoneFormatSelect from './ZoneFormatSelect.svelte';

	let {
		game,
		activeTab = $bindable<'video' | 'screenshot'>('video'),
		isRecording = $bindable(false),
		onRecorded
	}: {
		game: KonvaGame;
		activeTab?: 'video' | 'screenshot';
		isRecording?: boolean;
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	// Busy signal from the video controls (covers countdown + active recording).
	let videoLocked = $state(false);
	let settingsOpen = $state(false);

	function setFormat(format: CaptureFormat) {
		// Reset the zone so the page re-initializes a default fitting the new format.
		captureSettings.update((s) => ({ ...s, format, zone: undefined }));
	}
</script>

<div class="flex items-stretch gap-2">
	{#if !videoLocked}
		<!-- Toolbar: Settings | Custom Region | Screenshot/Video (hidden while recording) -->
		<div class="flex items-center gap-2 rounded-lg bg-white shadow-lg shadow-black/10">
			<button
				class="flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-700 hover:bg-primary-200"
				onclick={() => (settingsOpen = true)}
				aria-label="Settings"
			>
				<CogOutline class="h-4 w-4" />
				<span class:hidden={$isMobile}>Settings</span>
			</button>

			<div class="h-7 w-px bg-gray-200"></div>

			<ZoneFormatSelect
				format={$captureSettings.format}
				disabled={videoLocked}
				onchange={setFormat}
			/>

			<div class="h-7 w-px bg-gray-200"></div>

			<CaptureModeSelect
				mode={activeTab}
				disabled={videoLocked}
				onchange={(m) => (activeTab = m)}
			/>
		</div>
	{/if}

	<!-- Recording Bar: active controls (always visible; the start/stop focus while recording) -->
	<div class="flex items-center rounded-lg bg-white shadow-lg shadow-black/10">
		{#if activeTab === 'video'}
			<RecordControl bind:isRecording bind:locked={videoLocked} {game} {onRecorded} />
		{:else}
			<ScreenshotControl {game} disabled={videoLocked} />
		{/if}
	</div>
</div>

<SettingsModal bind:open={settingsOpen} />
