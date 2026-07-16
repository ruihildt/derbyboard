<script lang="ts">
	import { CloseOutline } from 'flowbite-svelte-icons';
	import { uiPrefs } from '$lib/stores/uiPrefs';

	function dismiss() {
		uiPrefs.update((u) => ({ ...u, rotateHintDismissed: true }));
	}
</script>

{#if !$uiPrefs.rotateHintDismissed}
	<!-- Visible only on small portrait screens (see the `mobile-portrait` variant).
	     Rendered inline above the capture bar by its parent. -->
	<div
		class="hidden max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700 shadow-lg shadow-black/10 mobile-portrait:flex"
		role="status"
	>
		<span class="text-center">Rotate your device for a wider view of the track.</span>
		<button
			type="button"
			class="flex shrink-0 items-center rounded p-1 text-gray-500 hover:bg-primary-200 hover:text-gray-700"
			onclick={dismiss}
			aria-label="Dismiss"
		>
			<CloseOutline class="h-4 w-4" />
		</button>
	</div>
{/if}
