<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import {
		MicrophoneOutline,
		MicrophoneSlashOutline,
		PlayOutline,
		StopSolid
	} from 'flowbite-svelte-icons';
	import { get } from 'svelte/store';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { TimelineRecorder } from '$lib/recording/timeline/TimelineRecorder';
	import { AudioCapture } from '$lib/recording/timeline/AudioCapture';
	import { recordingSettings } from '$lib/stores/recordingSettings';
	import { formatRatio, type CaptureFormat } from '$lib/utils/capture';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import ZoneFormatSelect from './ZoneFormatSelect.svelte';

	let {
		isRecording = $bindable(false),
		game = $bindable(),
		locked = $bindable(false),
		disabled = false,
		onLoadReplay,
		onRecorded
	}: {
		isRecording: boolean;
		game: KonvaGame;
		locked?: boolean;
		disabled?: boolean;
		onLoadReplay?: () => void;
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	let recorder = $state<TimelineRecorder | null>(null);
	let audioCapture = $state<AudioCapture | null>(null);
	let audioActive = false;
	let withAudio = $state(false);
	let countdown = $state<number | null>(null);
	let elapsedTime = $state(0);
	let timeInterval = $state<ReturnType<typeof setInterval> | null>(null);

	// Keep the bindable `locked` output in sync with the internal busy state so the
	// parent (CaptureBar) can disable tab switching during the countdown too.
	$effect(() => {
		locked = isRecording || countdown !== null || disabled;
	});

	function setFormat(format: CaptureFormat) {
		// Reset the zone so the page re-initializes a default fitting the new format.
		recordingSettings.update((s) => ({ ...s, format, zone: undefined }));
	}

	async function startRecording() {
		countdown = 3;
		const countdownInterval = setInterval(() => {
			countdown = countdown! - 1;
		}, 1000);

		await new Promise((resolve) => setTimeout(resolve, 3000));
		clearInterval(countdownInterval);
		countdown = null;

		if (!game) return;

		// Capture mic audio first (shared clock origin with the timeline).
		audioActive = false;
		if (withAudio) {
			audioCapture = new AudioCapture();
			audioActive = await audioCapture.start();
		}

		// Start the data-driven timeline capture.
		recorder = new TimelineRecorder(game);
		recorder.start();
		isRecording = true;

		// Track elapsed time.
		const startTime = Date.now();
		timeInterval = setInterval(() => {
			elapsedTime = Date.now() - startTime;
		}, 1000);
	}

	async function stopRecording() {
		if (!recorder || !isRecording) return;

		if (timeInterval) {
			clearInterval(timeInterval);
			timeInterval = null;
		}

		try {
			const { project } = recorder.stop();
			const audioBlob = audioActive && audioCapture ? await audioCapture.stop() : null;
			const s = get(recordingSettings);
			if (s.format !== 'full') {
				project.frame = { region: s.zone ?? game.defaultZone(formatRatio(s.format)) };
			}
			onRecorded?.(project, audioBlob);
		} catch (e) {
			console.error('[RecordControl] stop failed', e);
		} finally {
			recorder = null;
			audioCapture = null;
			audioActive = false;
			isRecording = false;
			elapsedTime = 0;
		}
	}

	async function toggleRecording() {
		if (isRecording) {
			await stopRecording();
		} else {
			await startRecording();
		}
	}
</script>

<div class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-lg shadow-black/10">
	<!-- Zone format selector -->
	<ZoneFormatSelect format={$recordingSettings.format} disabled={locked} onchange={setFormat} />

	<!-- Sound -->
	<ToolbarButton
		class={locked ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary-200'}
		onclick={() => (withAudio = !withAudio)}
		disabled={locked}
		aria-label={withAudio ? 'Disable microphone' : 'Enable microphone'}
	>
		{#if withAudio}
			<MicrophoneOutline class="text-sm text-gray-700" />
		{:else}
			<MicrophoneSlashOutline class="text-gray-700" />
		{/if}
	</ToolbarButton>

	<!-- Record / stop -->
	<ToolbarButton
		class="flex items-center gap-2 px-3 text-sm text-gray-700 {countdown !== null || disabled
			? 'cursor-not-allowed'
			: 'hover:bg-primary-200'}"
		onclick={toggleRecording}
		disabled={countdown !== null || disabled}
		aria-label={isRecording ? 'Stop' : 'Record'}
	>
		{#if isRecording}
			<StopSolid class="text-red-600" />
		{:else}
			<span class="h-2.5 w-2.5 rounded-full bg-red-600"></span>
		{/if}
		{isRecording ? 'Stop' : countdown !== null ? `Starting in ${countdown}...` : 'Record'}
	</ToolbarButton>

	{#if isRecording}
		<div class="mx-1 tabular-nums text-gray-600">
			{Math.floor(elapsedTime / 60000)}:{Math.floor((elapsedTime % 60000) / 1000)
				.toString()
				.padStart(2, '0')}
		</div>
	{/if}

	<div class="mx-1 h-6 w-px bg-gray-200"></div>

	<!-- Load replay -->
	<ToolbarButton
		class={locked ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary-200'}
		onclick={() => onLoadReplay?.()}
		disabled={locked}
		aria-label="Load replay"
	>
		<PlayOutline class="h-5 w-5 text-gray-700" />
	</ToolbarButton>
</div>
