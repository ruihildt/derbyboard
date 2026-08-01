<script lang="ts">
	import { ChevronDownOutline } from 'flowbite-svelte-icons';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { getCapabilities, type Experience } from '$lib/experiences/capabilities';
	import { createAuthoredClipFromBoard, exitToFree } from '$lib/doc/clipOps';

	// Capabilities are derived from the doc shape (whether an authored clip is
	// active). Touch both stores so this re-derives when either changes.
	const caps = $derived.by(() => {
		void $boardDoc;
		void $authoringSession;
		return getCapabilities($boardDoc);
	});

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

	interface Transition {
		label: string;
		run: () => void;
	}

	/**
	 * The transitions allowed from the current experience. Free → Drill
	 * snapshots the board as step 0 (non-destructive); → Free Play exits
	 * authoring and restores the free board. UX plan §7.
	 */
	const transitions = $derived.by<Transition[]>(() => {
		const exp = caps.experience;
		void $boardDoc;
		if (exp === 'free') {
			return [{ label: '→ Drill', run: () => createAuthoredClipFromBoard() }];
		}
		return [{ label: '→ Free Play', run: () => exitToFree() }];
	});

	function choose(t: Transition) {
		open = false;
		t.run();
	}

	const BADGE: Record<Experience, string> = {
		free: 'bg-gray-100 text-gray-700',
		drill: 'bg-primary-100 text-primary-700'
	};
</script>

<div bind:this={menuRef} class="relative flex items-center">
	<button
		class="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium hover:bg-primary-200 {BADGE[
			caps.experience
		]}"
		onclick={() => (open = !open)}
		aria-label="Switch experience"
	>
		{caps.label}
		<ChevronDownOutline class="h-3.5 w-3.5" />
	</button>

	{#if open}
		<div class="absolute left-0 top-full z-40 mt-1 min-w-[10rem] rounded-lg bg-white p-1 shadow-xl">
			{#each transitions as t (t.label)}
				<button
					class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-primary-200"
					onclick={() => choose(t)}
				>
					{t.label}
				</button>
			{/each}
		</div>
	{/if}
</div>
