<script lang="ts">
	let { videoBlob = $bindable() } = $props<{
		videoBlob: Blob;
	}>();

	let videoUrl = URL.createObjectURL(videoBlob);
	let videoElement: HTMLVideoElement | undefined;

	$effect(() => {
		if (videoElement) {
			videoElement.load();
		}
	});
</script>

<div class="h-full w-full">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoElement}
		controls={true}
		src={videoUrl}
		preload="auto"
		playsinline
		class="h-full w-full object-contain"
	></video>
</div>
