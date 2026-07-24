<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { boardSettings } from '$lib/stores/boardSettings';
	import type { PackMethod } from '$lib/trackMath';
	import type { KonvaGame } from '$lib/konva/KonvaGame';

	let { game }: { game: KonvaGame } = $props();
	let isOpen = $state(false);

	// Imperative entry point used by the Menu's "Board settings" item.
	export function open() {
		isOpen = true;
	}

	const options: { value: PackMethod; label: string; hint: string }[] = [
		{ value: 'sector', label: 'Sector', hint: 'Hip distance measured along the track.' },
		{
			value: 'rectangle',
			label: 'Rectangle',
			hint: 'Official WFTDA perpendicular method — more accurate through the turns.'
		}
	];

	function choose(method: PackMethod) {
		boardSettings.update((s) => ({ ...s, packMethod: method }));
		game.refreshPack();
	}
</script>

<Modal bind:open={isOpen} size="sm" classes={{ close: 'hover:bg-primary-200' }}>
	<div class="px-5 pb-2 pt-4">
		<h2 class="mb-4 text-lg font-semibold text-gray-800">Board settings</h2>

		<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
			Pack measuring method
		</h3>
		<div class="space-y-2">
			{#each options as opt (opt.value)}
				<button
					type="button"
					class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors {$boardSettings.packMethod === opt.value
						? 'border-primary-400 bg-primary-100'
						: 'border-gray-200 bg-white hover:bg-primary-50'}"
					onclick={() => choose(opt.value)}
				>
					<span
						class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 {$boardSettings.packMethod === opt.value
							? 'border-primary-500'
							: 'border-gray-300'}"
					>
						{#if $boardSettings.packMethod === opt.value}
							<span class="h-2 w-2 rounded-full bg-primary-500"></span>
						{/if}
					</span>
					<span>
						<span class="block text-sm font-medium text-gray-800">{opt.label}</span>
						<span class="block text-xs text-gray-500">{opt.hint}</span>
					</span>
				</button>
			{/each}
		</div>
	</div>
</Modal>
