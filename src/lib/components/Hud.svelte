<script lang="ts">
	import { get } from 'svelte/store';
	import { boardSettings } from '$lib/stores/boardSettings';
	import { selectedEntityId } from '$lib/stores/selection';
	import { boardDoc } from '$lib/doc/store';
	import { hudLabel, type KonvaGame } from '$lib/konva/KonvaGame';

	let { game }: { game: KonvaGame } = $props();

	let screenX = $state(0);
	let screenY = $state(0);

	let rafId = 0;
	let active = $derived(($boardSettings.entityHudVisible ?? false) && !!$selectedEntityId);

	// The label only changes with the document or selection — computed
	// reactively here, NOT per frame in the rAF tick (which previously did a
	// doc read + entity find + pose lookup + label build at 60fps).
	let label = $derived.by(() => {
		const id = $selectedEntityId;
		if (!id) return '';
		const entity = $boardDoc.entities.find((e) => e.id === id);
		return entity ? hudLabel(entity) : '';
	});

	// Only the screen position genuinely needs per-frame tracking
	// (pan/zoom/drag/playback move it without any store changing).
	function tick() {
		const id = get(selectedEntityId);
		if (id) {
			const pos = game.getEntityScreenPos(id);
			if (pos) {
				screenX = pos.x;
				screenY = pos.y;
			}
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
