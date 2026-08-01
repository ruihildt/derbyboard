<script lang="ts">
	import { Drawer } from 'flowbite-svelte';
	import { CloseOutline, MapPinOutline } from 'flowbite-svelte-icons';
	import { PRESETS, presetEntities, type Preset } from '$lib/data/presets';
	import { loadPresetEntities } from '$lib/doc/clipOps';

	let { onDockedChange } = $props<{ onDockedChange?: (docked: boolean) => void }>();
	let hidden = $state(true);
	/** When pinned, the sidebar stays put: it ignores outside-click close,
	 * stays open after choosing an item, and drops its left-edge shadow to
	 * read as docked. Pinned persists across close/reopen (same instance). */
	let pinned = $state(false);

	// Report the docked state (pinned AND open) so the page can shrink the
	// canvas and re-frame the bars. Fires on mount and whenever either changes.
	$effect(() => {
		onDockedChange?.(pinned && !hidden);
	});

	// Imperative entry point used by the top-right Library trigger.
	export function open() {
		hidden = false;
	}

	type Tab = 'starters' | 'drills' | 'strats';
	let tab = $state<Tab>('starters');

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'starters', label: 'Starters' },
		{ id: 'drills', label: 'Drills' },
		{ id: 'strats', label: 'Strats' }
	];

	function onWindowPointerDown(e: PointerEvent) {
		if (hidden || pinned) return;
		const panel = document.querySelector('.library-drawer');
		if (!panel) return;
		const target = e.target;
		if (
			target instanceof Element &&
			!panel.contains(target) &&
			!target.closest('.library-trigger')
		) {
			hidden = true;
		}
	}

	function choose(preset: Preset) {
		loadPresetEntities(presetEntities(preset));
		// Stay open after choosing when pinned; otherwise dismiss.
		if (!pinned) hidden = true;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<Drawer
	bind:hidden
	placement="right"
	modal={false}
	dismissable={false}
	class="library-drawer w-96 {pinned ? '' : 'shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.1)]'}"
>
	<div class="mb-2 flex shrink-0 items-center justify-between">
		<h5 class="pl-5 text-xl font-bold">Library</h5>
		<div class="flex items-center pr-1">
			<button
				onclick={() => (pinned = !pinned)}
				class="rounded-lg p-2 {pinned
					? 'bg-primary-100 text-primary-700'
					: 'text-gray-500 hover:bg-primary-200'}"
				aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
				title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
			>
				<MapPinOutline class="h-5 w-5" />
			</button>
			<button
				onclick={() => (hidden = true)}
				class="rounded-lg p-2 hover:bg-primary-200"
				aria-label="Close"
				title="Close"
			>
				<CloseOutline class="h-5 w-5" />
			</button>
		</div>
	</div>

	<!-- Tabs -->
	<div class="flex shrink-0 gap-1 px-2 pb-2">
		{#each TABS as t (t.id)}
			<button
				class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {tab === t.id
					? 'bg-primary-100 text-primary-700'
					: 'text-gray-600 hover:bg-primary-200'}"
				onclick={() => (tab = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto pe-2 pl-2">
		{#if tab === 'starters'}
			<ul class="flex flex-col gap-1">
				{#each PRESETS as preset (preset.id)}
					<li>
						<button
							class="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-primary-200"
							onclick={() => choose(preset)}
						>
							{preset.name}
						</button>
					</li>
				{/each}
			</ul>
		{:else if tab === 'drills'}
			<p class="px-3 py-8 text-center text-sm text-gray-400">No drills saved yet.</p>
		{:else}
			<p class="px-3 py-8 text-center text-sm text-gray-400">No strats saved yet.</p>
		{/if}
	</div>
</Drawer>
