<script lang="ts">
	import { ChevronDownOutline } from 'flowbite-svelte-icons';
	import { CAPTURE_FORMATS, FORMAT_LABELS, type CaptureFormat } from '$lib/utils/capture';

	let {
		format,
		disabled = false,
		onchange
	}: {
		format: CaptureFormat;
		disabled?: boolean;
		onchange: (format: CaptureFormat) => void;
	} = $props();

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

	function select(f: CaptureFormat) {
		onchange(f);
		open = false;
	}

	function menuItem(active: boolean) {
		return `block w-full rounded px-2 py-1 text-left text-sm ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
	}
</script>

<div bind:this={menuRef} class="relative flex items-center">
	<button
		class="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-700 {disabled
			? 'cursor-not-allowed opacity-50'
			: 'hover:bg-primary-200'}"
		onclick={() => (open = !open)}
		{disabled}
		aria-label="Capture zone format"
	>
		{FORMAT_LABELS[format]}
		<ChevronDownOutline class="h-3.5 w-3.5" />
	</button>

	{#if open}
		<div class="absolute bottom-full left-0 z-40 mb-1 w-40 rounded-lg bg-white p-1 shadow-xl">
			{#each CAPTURE_FORMATS as f (f)}
				<button class={menuItem(format === f)} onclick={() => select(f)}>
					{FORMAT_LABELS[f]}
				</button>
			{/each}
		</div>
	{/if}
</div>
