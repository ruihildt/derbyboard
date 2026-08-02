<script lang="ts">
	import { selectedAnnotationId } from '$lib/stores/selection';
	import { setAnnotationScope, getActiveStep } from '$lib/doc/clipOps';
	import type { KonvaGame } from '$lib/konva/KonvaGame';

	let { game }: { game: KonvaGame } = $props();

	let screenX = $state(0);
	let screenY = $state(0);
	let isStepScoped = $state(false);
	let stepLabel = $state('');
	let hasStep = $state(false);
	let visible = $state(false);

	let rafId = 0;
	// Active whenever a mark is selected (no settings gate — unlike the entity HUD).
	let active = $derived(!!$selectedAnnotationId);

	function tick() {
		const data = game.getAnnotationHudData($selectedAnnotationId);
		if (data) {
			screenX = data.screenX;
			screenY = data.screenY;
			isStepScoped = data.isStepScoped;
			stepLabel = data.stepLabel;
			hasStep = !!getActiveStep();
			visible = true;
		} else {
			visible = false;
		}
		rafId = requestAnimationFrame(tick);
	}

	$effect(() => {
		if (!active) {
			visible = false;
			return;
		}
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	function toggleScope() {
		const id = $selectedAnnotationId;
		if (!id) return;
		if (isStepScoped) {
			setAnnotationScope(id, null);
		} else {
			const step = getActiveStep();
			if (step) setAnnotationScope(id, step.id);
		}
	}
</script>

{#if active && visible}
	<div
		class="pointer-events-none fixed z-20 -translate-x-1/2 -translate-y-full"
		style="left: {screenX}px; top: {screenY - 22}px"
	>
		<div
			class="pointer-events-auto flex items-center gap-2 rounded-lg bg-gray-900/85 px-2.5 py-1 text-xs text-white shadow-lg shadow-black/20 backdrop-blur-sm"
		>
			<span class="font-semibold">{isStepScoped ? stepLabel : 'All steps'}</span>
			{#if hasStep}
				<button
					type="button"
					class="rounded bg-white/10 px-2 py-0.5 font-medium hover:bg-white/20"
					onclick={toggleScope}
				>
					{isStepScoped ? 'Show on all steps' : 'Only this step'}
				</button>
			{/if}
		</div>
	</div>
{/if}
