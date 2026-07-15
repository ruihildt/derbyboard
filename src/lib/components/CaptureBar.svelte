<script lang="ts">
	import { CameraPhotoOutline, VideoCameraOutline } from 'flowbite-svelte-icons';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { TimelineProject } from '$lib/recording/timeline/types';
	import RecordControl from './RecordControl.svelte';
	import ScreenshotControl from './ScreenshotControl.svelte';

	let {
		game,
		activeTab = $bindable<'video' | 'screenshot'>('video'),
		isRecording = $bindable(false),
		onLoadReplay,
		onRecorded
	}: {
		game: KonvaGame;
		activeTab?: 'video' | 'screenshot';
		isRecording?: boolean;
		onLoadReplay?: () => void;
		onRecorded?: (project: TimelineProject, audioBlob: Blob | null) => void;
	} = $props();

	// Busy signal from the video controls (covers countdown + active recording).
	let videoLocked = $state(false);

	function tabClass(active: boolean) {
		return `flex items-center gap-1.5 rounded px-2 py-1 text-sm ${
			videoLocked
				? 'cursor-not-allowed opacity-50'
				: active
					? 'bg-primary-200 text-gray-900'
					: 'text-gray-600 hover:bg-gray-100'
		}`;
	}
</script>

<div class="flex items-center gap-2">
	<!-- Tabs -->
	<div class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-lg shadow-black/10">
		<button
			class={tabClass(activeTab === 'screenshot')}
			onclick={() => !videoLocked && (activeTab = 'screenshot')}
			disabled={videoLocked}
			aria-label="Take a screenshot"
		>
			<CameraPhotoOutline class="h-4 w-4" />
			Screenshot
		</button>
		<button
			class={tabClass(activeTab === 'video')}
			onclick={() => !videoLocked && (activeTab = 'video')}
			disabled={videoLocked}
			aria-label="Record a video"
		>
			<VideoCameraOutline class="h-4 w-4" />
			Video
		</button>
	</div>

	<!-- Active controls (mutually exclusive) -->
	{#if activeTab === 'video'}
		<RecordControl bind:isRecording bind:locked={videoLocked} {game} {onLoadReplay} {onRecorded} />
	{:else}
		<ScreenshotControl {game} disabled={videoLocked} />
	{/if}
</div>
