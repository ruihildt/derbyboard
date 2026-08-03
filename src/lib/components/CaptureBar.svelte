<script lang="ts">
	import { captureSettings } from '$lib/stores/captureSettings';
	import RegionModeToggle from './RegionModeToggle.svelte';

	let {
		regionMode = $bindable<'board' | 'edit'>('board'),
		isRecording = false
	}: {
		regionMode?: 'board' | 'edit';
		isRecording?: boolean;
	} = $props();
</script>

{#if !isRecording && $captureSettings.format !== 'full'}
	<!-- Region edit toggle: shown only for non-full formats and hidden while
	     recording. The capture mode itself is selected from the toolbar. -->
	<div class="control-bar flex items-center rounded-lg bg-white shadow-lg shadow-black/10">
		<RegionModeToggle bind:mode={regionMode} />
	</div>
{/if}
