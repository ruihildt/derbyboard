<script lang="ts">
	import { Toolbar, ToolbarButton } from 'flowbite-svelte';
	import { MicrophoneOutline, MicrophoneSlashOutline, StopSolid } from 'flowbite-svelte-icons';
	import { panMode } from '$lib/stores/panMode';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { KonvaRecorder } from '$lib/konva/KonvaRecorder';

	let {
		recordingComplete,
		isRecording = $bindable(false),
		game = $bindable()
	} = $props<{
		recordingComplete: (blob: Blob) => void;
		isRecording: boolean;
		game: KonvaGame;
	}>();

	let recorder = $state<KonvaRecorder | null>(null);
	let withAudio = $state(false);
	let countdown = $state<number | null>(null);
	let elapsedTime = $state(0);
	let timeInterval = $state<number | null>(null);
	let audioStream = $state<MediaStream | null>(null);

	async function startRecording() {
		panMode.set(false); // Lock panning when recording starts
		countdown = 3;
		const countdownInterval = setInterval(() => {
			countdown = countdown! - 1;
		}, 1000);

		await new Promise((resolve) => setTimeout(resolve, 3000));
		clearInterval(countdownInterval);
		countdown = null;

		if (game) {
			// Initialize the recorder if not already done
			if (!recorder) {
				recorder = new KonvaRecorder(game.getStage());
			}

			// If audio is enabled, get audio stream and set it in the recorder
			if (withAudio) {
				try {
					audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
					recorder.setAudioStream(audioStream);
				} catch (err) {
					console.error('Error accessing the microphone', err);
					// Continue without audio if there's an error
					recorder.setAudioStream(null);
				}
			} else {
				recorder.setAudioStream(null);
			}

			// Start recording
			recorder.startRecording();
			isRecording = true;

			// Track elapsed time
			const startTime = Date.now();
			timeInterval = setInterval(() => {
				elapsedTime = Date.now() - startTime;
			}, 1000);
		}
	}

	async function stopRecording() {
		if (recorder && isRecording) {
			if (timeInterval) {
				clearInterval(timeInterval);
				timeInterval = null;
			}

			// Stop recording and get the blob
			const blob = await recorder.stopRecording();
			recordingComplete(blob);

			// Stop audio stream if it exists
			if (audioStream) {
				audioStream.getTracks().forEach((track) => track.stop());
				audioStream = null;
			}

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
		class={isRecording || countdown !== null
			? 'cursor-not-allowed opacity-50'
			: 'hover:bg-primary-200'}
		onclick={() => (withAudio = !withAudio)}
		disabled={isRecording || countdown !== null}
	>
		{#if withAudio}
			<MicrophoneOutline class="text-sm text-gray-700" />
		{:else}
			<MicrophoneSlashOutline class="text-gray-700" />
		{/if}
	</ToolbarButton>

	<ToolbarButton
		class="flex items-center gap-2 px-3 text-sm text-gray-700 {countdown !== null
			? 'cursor-not-allowed'
			: 'hover:bg-primary-200'}"
		onclick={toggleRecording}
		disabled={countdown !== null}
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
