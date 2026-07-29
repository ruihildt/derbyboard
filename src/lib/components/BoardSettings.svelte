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

	function toggleAutoFace() {
		boardSettings.update((s) => ({ ...s, autoFace: !s.autoFace }));
		game.refreshHeadings();
	}

	function toggleEntityHud() {
		boardSettings.update((s) => ({ ...s, entityHudVisible: !s.entityHudVisible }));
	}

	function toggleDirectionMarker() {
		game.setDirectionMarkerVisible(!($boardSettings.directionMarkerVisible ?? true));
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
					class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors {$boardSettings.packMethod ===
					opt.value
						? 'border-primary-400 bg-primary-100'
						: 'border-gray-200 bg-white hover:bg-primary-50'}"
					onclick={() => choose(opt.value)}
				>
					<span
						class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 {$boardSettings.packMethod ===
						opt.value
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

		<div class="mt-6">
			<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
				Heading and motion
			</h3>
			<div class="space-y-2">
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors {$boardSettings.directionMarkerVisible !==
					false
						? 'border-primary-400 bg-primary-100'
						: 'border-gray-200 bg-white hover:bg-primary-50'}"
					onclick={toggleDirectionMarker}
				>
					<span
						class="flex h-4 w-4 items-center justify-center rounded border-2 {$boardSettings.directionMarkerVisible !==
						false
							? 'border-primary-500 bg-primary-500'
							: 'border-gray-300 bg-white'}"
					>
						{#if $boardSettings.directionMarkerVisible !== false}
							<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="3"
									d="M5 13l4 4L19 7"
								/>
							</svg>
						{/if}
					</span>
					<span>
						<span class="block text-sm font-medium text-gray-800">Facing markers</span>
						<span class="block text-xs text-gray-500"
							>Show each skater's looking direction. Tap a skater and drag the knob to set it.</span
						>
					</span>
				</button>

				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors {$boardSettings.autoFace ===
					true
						? 'border-primary-400 bg-primary-100'
						: 'border-gray-200 bg-white hover:bg-primary-50'}"
					onclick={toggleAutoFace}
				>
					<span
						class="flex h-4 w-4 items-center justify-center rounded border-2 {$boardSettings.autoFace ===
						true
							? 'border-primary-500 bg-primary-500'
							: 'border-gray-300 bg-white'}"
					>
						{#if $boardSettings.autoFace === true}
							<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="3"
									d="M5 13l4 4L19 7"
								/>
							</svg>
						{/if}
					</span>
					<span>
						<span class="block text-sm font-medium text-gray-800">Auto-face skaters</span>
						<span class="block text-xs text-gray-500">Skaters face their direction of motion.</span>
					</span>
				</button>

				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors {$boardSettings.entityHudVisible ===
					true
						? 'border-primary-400 bg-primary-100'
						: 'border-gray-200 bg-white hover:bg-primary-50'}"
					onclick={toggleEntityHud}
				>
					<span
						class="flex h-4 w-4 items-center justify-center rounded border-2 {$boardSettings.entityHudVisible ===
						true
							? 'border-primary-500 bg-primary-500'
							: 'border-gray-300 bg-white'}"
					>
						{#if $boardSettings.entityHudVisible === true}
							<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="3"
									d="M5 13l4 4L19 7"
								/>
							</svg>
						{/if}
					</span>
					<span>
						<span class="block text-sm font-medium text-gray-800">Entity HUD</span>
						<span class="block text-xs text-gray-500"
							>Shows the team and role of the selected skater.</span
						>
					</span>
				</button>
			</div>
		</div>
	</div>
</Modal>
