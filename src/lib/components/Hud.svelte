<script lang="ts">
	import { boardSettings } from '$lib/stores/boardSettings';
	import { selectedEntityId } from '$lib/stores/selection';
	import type { KonvaGame } from '$lib/konva/KonvaGame';

	let { game }: { game: KonvaGame } = $props();

	let screenX = $state(0);
	let screenY = $state(0);
	let label = $state('');

	let rafId = 0;
	let active = $derived(($boardSettings.entityHudVisible ?? false) && !!$selectedEntityId);

	function tick() {
		const data = game.getEntityHudData();
		if (data) {
			screenX = data.screenX;
			screenY = data.screenY;
			label = data.label;
		}
		rafId = requestAnimationFrame(tick);
	}

	$effect(() => {
		if (!active) return;
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});
</script>

{#if active}
	<div
		class="pointer-events-none fixed z-20 -translate-x-1/2 -translate-y-full"
		style="left: {screenX}px; top: {screenY - 22}px"
	>
		<div
			class="flex items-center gap-2 rounded-lg bg-gray-900/85 px-2.5 py-1 text-xs text-white shadow-lg shadow-black/20 backdrop-blur-sm"
		>
			<span class="font-semibold">{label}</span>
		</div>
	</div>
{/if}
