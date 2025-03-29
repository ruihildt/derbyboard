<script lang="ts">
	let { videoBlob = $bindable(), close } = $props<{
		videoBlob: Blob;
		close: () => void;
	}>();

	let videoUrl = URL.createObjectURL(videoBlob);
	let videoElement: HTMLVideoElement;

	$effect(() => {
		if (videoElement) {
			videoElement.load();
		}
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="h-full w-full">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		controls={true}
		src={videoUrl}
		preload="auto"
		playsinline
		class="h-full w-full object-contain"
	></video>
</div>
