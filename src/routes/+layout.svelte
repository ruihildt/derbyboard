<script>
	import { onMount } from 'svelte';
	import '../app.css';

	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/sw.js')
				.catch((err) => console.warn('[sw] registration failed', err));
		}
	});
</script>

<slot></slot>
