<script lang="ts">
	import { ToolbarButton } from 'flowbite-svelte';
	import {
		ChevronDownOutline,
		MicrophoneOutline,
		MicrophoneSlashOutline,
		PlayOutline,
		StopSolid
	} from 'flowbite-svelte-icons';
	import { get } from 'svelte/store';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { TimelineRecorder } from '$lib/recording/timeline/TimelineRecorder';
	import { AudioCapture } from '$lib/recording/timeline/AudioCapture';
	import { saveProjectFile } from '$lib/recording/timeline/projectFile';
	import { recordingSettings } from '$lib/stores/recordingSettings';
	import type { AspectRatio } from '$lib/utils/recording';

	let {
		isRecording = $bindable(false),
		game = $bindable(),
		disabled = false,
		onLoadReplay
	}: {
		isRecording: boolean;
		game: KonvaGame;
		disabled?: boolean;
		onLoadReplay?: () => void;
	} = $props();

	let recorder = $state<TimelineRecorder | null>(null);
	let audioCapture = $state<AudioCapture | null>(null);
	let audioActive = false;
	let withAudio = $state(false);
	let countdown = $state<number | null>(null);
	let elapsedTime = $state(0);
	let timeInterval = $state<ReturnType<typeof setInterval> | null>(null);

	let open = $state(false);
	let menuRef: HTMLDivElement | undefined;

	// Close the dropdown on any pointer down outside of it (e.g. on the board).
	$effect(() => {
		if (!open) return;
		function onPointerDown(e: PointerEvent) {
			if (menuRef && !menuRef.contains(e.target as Node)) {
				open = false;
			}
		}
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	const ratios: AspectRatio[] = ['16:9', '4:3', '1:1'];

	const locked = $derived(isRecording || countdown !== null || disabled);
	const selectionLabel = $derived(
		$recordingSettings.mode === 'full' ? 'Full page' : $recordingSettings.ratio
	);

	function selectFull() {
		recordingSettings.update((s) => ({ ...s, mode: 'full' }));
		open = false;
	}
	function selectRatio(ratio: AspectRatio) {
		recordingSettings.update((s) => ({ ...s, mode: 'region', ratio }));
		open = false;
	}

	function menuItem(active: boolean) {
		return `block w-full rounded px-2 py-1 text-left text-sm ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
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
			if (s.mode === 'region') {
				project.frame = { ratio: s.ratio, region: s.region ?? game.defaultRegion(s.ratio) };
			}
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

<div class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-lg shadow-black/10">
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

	<!-- Area / aspect ratio -->
	<div bind:this={menuRef} class="relative flex items-center">
		<button
			class="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-700 {locked
				? 'cursor-not-allowed opacity-50'
				: 'hover:bg-primary-200'}"
			onclick={() => (open = !open)}
			disabled={locked}
			aria-label="Recording area"
		>
			{selectionLabel}
			<ChevronDownOutline class="h-3.5 w-3.5" />
		</button>

		{#if open}
			<div class="absolute bottom-full left-0 z-40 mb-1 w-32 rounded-lg bg-white p-1 shadow-xl">
				<button class={menuItem($recordingSettings.mode === 'full')} onclick={selectFull}>
					Full page
				</button>
				{#each ratios as r (r)}
					<button
						class={menuItem($recordingSettings.mode === 'region' && $recordingSettings.ratio === r)}
						onclick={() => selectRatio(r)}>{r}</button
					>
				{/each}
			</div>
		{/if}
	</div>

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
