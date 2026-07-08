<script lang="ts">
	import { ASPECT_RATIO, type AspectRatio } from '$lib/utils/recording';
	import type { Region } from '$lib/konva/recorder/types';

	let {
		ratio,
		active = true,
		onChange
	}: {
		ratio: AspectRatio;
		active?: boolean;
		onChange: (region: Region) => void;
	} = $props();

	// Selection state in viewport CSS pixels. Height is derived from width and the
	// aspect ratio, so the frame is always ratio-locked.
	let left = $state(0);
	let top = $state(0);
	let width = $state(0);

	let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 720);

	function maxFitWidth(ar: number): number {
		return Math.min(vw, vh * ar);
	}

	const region = $derived.by(() => {
		const ar = ASPECT_RATIO[ratio];
		let w = width;
		const fit = maxFitWidth(ar);
		if (w > fit) w = fit;
		if (w < 80) w = 80;
		const h = w / ar;
		const x = Math.max(0, Math.min(left, vw - w));
		const y = Math.max(0, Math.min(top, vh - h));
		return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
	});

	// Report the clamped region up whenever it changes.
	$effect(() => {
		onChange(region);
	});

	// Initialize a centered frame once we know the viewport.
	$effect(() => {
		if (width !== 0) return;
		const ar = ASPECT_RATIO[ratio];
		const w = maxFitWidth(ar) * 0.8;
		width = w;
		left = (vw - w) / 2;
		top = (vh - w / ar) / 2;
	});

	function onResize() {
		vw = window.innerWidth;
		vh = window.innerHeight;
	}

	type Drag =
		| { mode: 'move'; startX: number; startY: number; originLeft: number; originTop: number }
		| { mode: 'resize'; anchorX: number; anchorY: number };
	let drag: Drag | null = null;

	function beginMove(e: PointerEvent) {
		if (!active) return;
		e.preventDefault();
		drag = {
			mode: 'move',
			startX: e.clientX,
			startY: e.clientY,
			originLeft: left,
			originTop: top
		};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
	}

	function beginResize(e: PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') {
		if (!active) return;
		e.preventDefault();
		e.stopPropagation();
		// Anchor = the opposite corner, which stays fixed during the resize.
		const ax = corner === 'tl' || corner === 'bl' ? region.x + region.w : region.x;
		const ay = corner === 'tl' || corner === 'tr' ? region.y + region.h : region.y;
		drag = { mode: 'resize', anchorX: ax, anchorY: ay };
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
	}

	function onPointerMove(e: PointerEvent) {
		if (!drag) return;
		if (drag.mode === 'move') {
			left = drag.originLeft + (e.clientX - drag.startX);
			top = drag.originTop + (e.clientY - drag.startY);
			return;
		}
		const ar = ASPECT_RATIO[ratio];
		const rawW = Math.abs(e.clientX - drag.anchorX);
		const rawH = Math.abs(e.clientY - drag.anchorY);
		// Preserve ratio by taking the larger implied width.
		const w = Math.max(rawW, rawH * ar);
		const h = w / ar;
		const dirX = e.clientX >= drag.anchorX ? 1 : -1;
		const dirY = e.clientY >= drag.anchorY ? 1 : -1;
		left = dirX > 0 ? drag.anchorX : drag.anchorX - w;
		top = dirY > 0 ? drag.anchorY : drag.anchorY - h;
		width = w;
	}

	function endDrag() {
		drag = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', endDrag);
	}
</script>

<svelte:window onresize={onResize} />

<div class="pointer-events-none absolute inset-0 z-20">
	<div
		class="absolute border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)] {active
			? 'cursor-move'
			: ''}"
		style="left: {region.x}px; top: {region.y}px; width: {region.w}px; height: {region.h}px; pointer-events: {active
			? 'auto'
			: 'none'};"
		onpointerdown={beginMove}
		role="button"
		tabindex="-1"
		aria-label="Recording selection"
	>
		{#if active}
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-left"
				class="absolute -left-1 -top-1 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border border-gray-400 bg-white"
				onpointerdown={(e) => beginResize(e, 'tl')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-right"
				class="absolute -right-1 -top-1 h-3 w-3 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize rounded-full border border-gray-400 bg-white"
				onpointerdown={(e) => beginResize(e, 'tr')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-left"
				class="absolute -bottom-1 -left-1 h-3 w-3 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize rounded-full border border-gray-400 bg-white"
				onpointerdown={(e) => beginResize(e, 'bl')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-right"
				class="absolute -bottom-1 -right-1 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border border-gray-400 bg-white"
				onpointerdown={(e) => beginResize(e, 'br')}
			></div>
		{/if}
	</div>
</div>
