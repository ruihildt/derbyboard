<script lang="ts">
	import { ChevronDownOutline, ImageOutline, VideoCameraOutline } from 'flowbite-svelte-icons';
	import { isMobile } from '$lib/stores/viewport';

	export type CaptureMode = 'screenshot' | 'video';

	let {
		mode,
		disabled = false,
		onchange
	}: {
		mode: CaptureMode;
		disabled?: boolean;
		onchange: (mode: CaptureMode) => void;
	} = $props();

	const MODES: { value: CaptureMode; label: string }[] = [
		{ value: 'screenshot', label: 'Image' },
		{ value: 'video', label: 'Video' }
	];

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

	function select(m: CaptureMode) {
		onchange(m);
		open = false;
	}

	function menuItem(active: boolean) {
		return `flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
	}
</script>

<div bind:this={menuRef} class="relative flex items-center">
	<button
		class="flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-700 {disabled
			? 'cursor-not-allowed opacity-50'
			: 'hover:bg-primary-200'}"
		onclick={() => (open = !open)}
		{disabled}
		aria-label="Capture mode"
	>
		{#if mode === 'screenshot'}
			<ImageOutline class="h-4 w-4" />
			<span class:hidden={$isMobile}>Image</span>
		{:else}
			<VideoCameraOutline class="h-4 w-4" />
			<span class:hidden={$isMobile}>Video</span>
		{/if}
		<ChevronDownOutline class="h-3.5 w-3.5" />
	</button>

	{#if open}
		<div class="absolute bottom-full left-0 z-40 mb-1 rounded-lg bg-white p-1 shadow-xl">
			{#each MODES as m (m.value)}
				<button class={menuItem(mode === m.value)} onclick={() => select(m.value)}>
					{#if m.value === 'screenshot'}
						<ImageOutline class="h-4 w-4" />
					{:else}
						<VideoCameraOutline class="h-4 w-4" />
					{/if}
					{m.label}
				</button>
			{/each}
		</div>
	{/if}
</div>
