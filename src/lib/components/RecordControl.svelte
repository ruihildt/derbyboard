<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import { MicrophoneOutline, MicrophoneSlashOutline, StopSolid } from 'flowbite-svelte-icons';
	import { get } from 'svelte/store';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { TimelineRecorder } from '$lib/recording/timeline/TimelineRecorder';
	import { AudioCapture } from '$lib/recording/timeline/AudioCapture';
	import { captureSettings } from '$lib/stores/captureSettings';
	import { formatRatio } from '$lib/utils/capture';
	import type { TimelineProject } from '$lib/recording/timeline/types';

	let {
		isRecording = $bindable(false),
		game = $bindable(),
		locked = $bindable(false),
		disabled = false,
		onRecorded
	}: {
		isRecording: boolean;
		game: KonvaGame;
		locked?: boolean;
		disabled?: boolean;
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	let recorder = $state<TimelineRecorder | null>(null);
	let audioCapture = $state<AudioCapture | null>(null);
	let audioActive = false;
	let withAudio = $state(false);
	let countdown = $state<number | null>(null);
	let countdownTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let countdownToken = 0;
	let elapsedTime = $state(0);
	let timeInterval = $state<ReturnType<typeof setInterval> | null>(null);

	// Keep the bindable `locked` output in sync with the internal busy state so the
	// parent (CaptureBar) can disable tab switching during the countdown too.
	$effect(() => {
		locked = isRecording || countdown !== null || disabled;
	});

	async function startRecording() {
		const token = ++countdownToken;
		countdown = 3;
		countdownTimer = setInterval(() => {
			countdown = countdown! - 1;
		}, 1000);

		await new Promise((resolve) => setTimeout(resolve, 3000));

		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
		// A later cancel/supersede bumped the token; abandon the start.
		if (token !== countdownToken) return;
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
			const s = get(captureSettings);
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

	function cancelCountdown() {
		countdownToken++;
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
		countdown = null;
	}

	async function toggleRecording() {
		if (isRecording) {
			await stopRecording();
		} else if (countdown !== null) {
			cancelCountdown();
		} else {
			await startRecording();
		}
	}
</script>

<div class="flex items-center gap-1">
	<!-- Sound -->
	<ToolbarButton
		class={locked
			? '!m-0 flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1 cursor-not-allowed opacity-50'
			: '!m-0 flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1 hover:bg-primary-200'}
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
		class="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm text-gray-700 !m-0 {disabled
			? 'cursor-not-allowed'
			: 'hover:bg-primary-200'}"
		onclick={toggleRecording}
		{disabled}
		aria-label={isRecording ? 'Stop' : countdown !== null ? 'Cancel' : 'Record'}
	>
		{#if isRecording}
			<StopSolid class="text-red-600" />
		{:else if countdown !== null}
			<span class="h-2.5 w-2.5 bg-red-600"></span>
		{:else}
			<span class="h-2.5 w-2.5 rounded-full bg-red-600"></span>
		{/if}
		{isRecording ? 'Stop' : countdown !== null ? `Starting in ${countdown}...` : 'Record'}
	</ToolbarButton>

	{#if isRecording}
		<div class="ml-1 mr-2 tabular-nums text-gray-600">
			{Math.floor(elapsedTime / 60000)}:{Math.floor((elapsedTime % 60000) / 1000)
				.toString()
				.padStart(2, '0')}
		</div>
	{/if}
</div>
