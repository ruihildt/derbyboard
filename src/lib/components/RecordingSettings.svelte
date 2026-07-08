<script lang="ts">
	import { AdjustmentsVerticalOutline } from 'flowbite-svelte-icons';
	import { recordingSettings } from '$lib/stores/recordingSettings';
	import type { AspectRatio, EngineKind, RecordingMode } from '$lib/utils/recording';
	import type { Quality } from '$lib/utils/codec';

	let { disabled = false } = $props<{ disabled?: boolean }>();

	let open = $state(false);

	const ratios: AspectRatio[] = ['16:9', '1:1', '4:3'];
	const qualities: Quality[] = ['720p', '1080p', '1440p', '2160p'];

	function setMode(mode: RecordingMode) {
		recordingSettings.update((s) => ({ ...s, mode }));
	}
	function setRatio(ratio: AspectRatio) {
		recordingSettings.update((s) => ({ ...s, ratio }));
	}
	function setQuality(quality: Quality) {
		recordingSettings.update((s) => ({ ...s, quality }));
	}
	function setEngine(engine: EngineKind) {
		recordingSettings.update((s) => ({ ...s, engine }));
	}

	function pill(active: boolean) {
		return `rounded px-2 py-1 text-xs ${active ? 'bg-primary-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`;
	}
</script>

<div class="relative">
	<button
		class="bg-white !p-2 shadow-lg shadow-black/5 hover:bg-primary-200 {open
			? 'ring-2 ring-primary-300'
			: ''}"
		class:opacity-50={disabled}
		class:pointer-events-none={disabled}
		onclick={() => (open = !open)}
		aria-label="Recording settings"
	>
		<AdjustmentsVerticalOutline class="h-5 w-5" color="gray" />
	</button>

	{#if open}
		<div class="absolute right-0 top-11 w-44 rounded-lg bg-white p-3 shadow-xl">
			<div class="mb-3">
				<div class="mb-1 text-xs font-semibold text-gray-500">Area</div>
				<div class="flex gap-1">
					<button class={pill($recordingSettings.mode === 'full')} onclick={() => setMode('full')}>
						Full
					</button>
					<button
						class={pill($recordingSettings.mode === 'region')}
						onclick={() => setMode('region')}>Region</button
					>
				</div>
			</div>

			<div class="mb-3">
				<div class="mb-1 text-xs font-semibold text-gray-500">Aspect ratio</div>
				<div class="flex gap-1">
					{#each ratios as r (r)}
						<button class={pill($recordingSettings.ratio === r)} onclick={() => setRatio(r)}>
							{r}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<div class="mb-1 text-xs font-semibold text-gray-500">Quality</div>
				<div class="grid grid-cols-2 gap-1">
					{#each qualities as q (q)}
						<button class={pill($recordingSettings.quality === q)} onclick={() => setQuality(q)}>
							{q}
						</button>
					{/each}
				</div>
			</div>

			<div class="mt-3 border-t border-gray-100 pt-3">
				<div class="mb-1 text-xs font-semibold text-gray-500">Engine</div>
				<div class="flex gap-1">
					<button
						class={pill($recordingSettings.engine === 'tocanvas')}
						onclick={() => setEngine('tocanvas')}
					>
						Standard
					</button>
					<button
						class={pill($recordingSettings.engine === 'clone')}
						onclick={() => setEngine('clone')}>Clone</button
					>
				</div>
				<p class="mt-1 text-[10px] leading-tight text-gray-400">
					Clone is experimental; verify output before relying on it.
				</p>
			</div>
		</div>
	{/if}
</div>
