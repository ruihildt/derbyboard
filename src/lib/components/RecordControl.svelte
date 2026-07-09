<script lang="ts">
	import { Toolbar, ToolbarButton } from 'flowbite-svelte';
	import { MicrophoneOutline, MicrophoneSlashOutline, StopSolid } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { TimelineRecorder } from '$lib/recording/timeline/TimelineRecorder';
	import { AudioCapture } from '$lib/recording/timeline/AudioCapture';
	import { saveProjectFile } from '$lib/recording/timeline/projectFile';

	let {
		isRecording = $bindable(false),
		game = $bindable(),
		disabled = false
	}: {
		isRecording: boolean;
		game: KonvaGame;
		disabled?: boolean;
	} = $props();

	let recorder = $state<TimelineRecorder | null>(null);
	let audioCapture = $state<AudioCapture | null>(null);
	let audioActive = false;
	let withAudio = $state(false);
	let countdown = $state<number | null>(null);
	let elapsedTime = $state(0);
	let timeInterval = $state<ReturnType<typeof setInterval> | null>(null);

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
			await saveProjectFile(project, audioBlob);
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

<Toolbar class="inline-flex rounded-lg !p-1 shadow-lg shadow-black/5">
	<ToolbarButton
		class={isRecording || countdown !== null || disabled
			? 'cursor-not-allowed opacity-50'
			: 'hover:bg-primary-200'}
		onclick={() => (withAudio = !withAudio)}
		disabled={isRecording || countdown !== null || disabled}
	>
		{#if withAudio}
			<MicrophoneOutline class="text-sm text-gray-700" />
		{:else}
			<MicrophoneSlashOutline class="text-gray-700" />
		{/if}
	</ToolbarButton>

	<ToolbarButton
		class="flex items-center gap-2 px-3 text-sm text-gray-700 {countdown !== null || disabled
			? 'cursor-not-allowed'
			: 'hover:bg-primary-200'}"
		onclick={toggleRecording}
		disabled={countdown !== null || disabled}
	>
		{#if isRecording}
			<StopSolid class="text-red-600" />
		{:else}
			<span class="h-2.5 w-2.5 rounded-full bg-red-600"></span>
		{/if}
		{isRecording ? 'Stop' : countdown !== null ? `Starting in ${countdown}...` : 'Record'}
	</ToolbarButton>

	{#if isRecording}
		<div class="mx-2">
			{Math.floor(elapsedTime / 60000)}:{Math.floor((elapsedTime % 60000) / 1000)
				.toString()
				.padStart(2, '0')}
		</div>
	{/if}
</Toolbar>
