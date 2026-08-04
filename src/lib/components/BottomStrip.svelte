<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		docked,
		hidden = false,
		el = $bindable(),
		children
	}: {
		/** True when the Library sidebar is docked: strip stops at its left edge. */
		docked: boolean;
		/** True in free play: strip collapses (display:none) and reserves no space. */
		hidden?: boolean;
		/** Root shell element — the parent measures its height to reserve layout
		 * space above it (the shell's padding is included so margins count). */
		el?: HTMLDivElement | undefined;
		children?: Snippet;
	} = $props();
</script>

<!--
	Bottom strip zone: a floating rounded bar (matching the zoom / capture bar
	aesthetic) that reserves real layout space — the canvas frame shrinks above
	it, like the pinned sidebar narrows it from the right. The shell is a
	pass-through fixed container with edge padding (0.75rem sides, 0.5rem
	bottom + safe-area, 0.25rem top for the bar's top shadow); the visible bar
	inside is the floating pill (rounded-lg bg-white shadow). Contents are
	mode-switched by the parent: drill shows the step timeline, replay shows
	replay controls. The strip stops at the docked sidebar's left edge.
-->
<div
	bind:this={el}
	class="pointer-events-none fixed bottom-0 left-0 z-40 px-[max(0.75rem,env(safe-area-inset-left))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 {docked
		? 'right-[18rem]'
		: 'right-0'}"
	class:hidden
>
	<div class="pointer-events-auto rounded-lg bg-white shadow-lg shadow-black/10">
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
