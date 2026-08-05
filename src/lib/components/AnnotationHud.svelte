<script lang="ts">
	import { selectedAnnotationId } from '$lib/stores/selection';
	import { setAnnotationScope } from '$lib/doc/clipOps';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { effectiveAnchors } from '$lib/konva/annotationTransform';
	import { annotationVisibleOnStep, scopeLabel } from '$lib/doc/annotationScope';
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import type { PlanarPoint } from '$lib/doc/types';

	let { game }: { game: KonvaGame } = $props();

	let screenX = $state(0);
	let screenY = $state(0);

	let rafId = 0;
	// Active whenever a mark is selected (no settings gate — unlike the entity HUD).
	let active = $derived(!!$selectedAnnotationId);

	// Everything except the screen position is derived reactively from the
	// stores — the previous implementation recomputed all of this (multiple
	// doc reads, clip/step finds, anchor transform, label strings) at 60fps.
	let ann = $derived($boardDoc.annotations?.find((a) => a.id === $selectedAnnotationId));
	let clip = $derived($boardDoc.clips.find((c) => c.id === $boardDoc.activeClipId));
	let steps = $derived(clip && clip.kind === 'authored' ? clip.steps : []);
	let step = $derived(
		clip && clip.kind === 'authored'
			? clip.steps[Math.max(0, Math.min($authoringSession.activeStepIndex, clip.steps.length - 1))]
			: undefined
	);
	// Hidden when the selected mark isn't visible on this step (a scoped mark
	// whose range doesn't cover the active step).
	let visible = $derived(!!ann && annotationVisibleOnStep(ann, step?.id, steps));
	let isStepScoped = $derived(!!ann?.scope);
	let scopeText = $derived(ann ? scopeLabel(ann, steps) : 'All');
	let hasStep = $derived(!!step);

	// Bounding-box centroid in planar metres (after the transform) — changes
	// only when the document does, not per frame.
	let centroid: PlanarPoint | null = $derived.by(() => {
		if (!ann) return null;
		const pts = effectiveAnchors(ann);
		if (pts.length === 0) return null;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const p of pts) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
		return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
	});

	// Only the screen position needs per-frame tracking (pan/zoom).
	function tick() {
		if (centroid) {
			const pos = game.planeToScreen(centroid);
			screenX = pos.x;
			screenY = pos.y;
		}
		rafId = requestAnimationFrame(tick);
	}

	$effect(() => {
		if (!active) return;
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	function toggleScope() {
		const id = $selectedAnnotationId;
		if (!id) return;
		if (isStepScoped) {
			setAnnotationScope(id, null);
		} else if (step) {
			setAnnotationScope(id, step.id);
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
			<span class="font-semibold">{scopeText}</span>
			{#if hasStep}
				<button
					type="button"
					class="rounded bg-white/10 px-2 py-0.5 font-medium hover:bg-white/20"
					onclick={toggleScope}
				>
					{isStepScoped ? 'All' : 'Current'}
				</button>
			{/if}
		</div>
	</div>
{/if}
