<script lang="ts">
	import { untrack } from 'svelte';
	import { ASPECT_RATIO, type AspectRatio } from '$lib/utils/recording';
	import type { TimelineRegion } from '$lib/recording/timeline/types';

	let {
		ratio,
		region,
		interactive = true,
		onchange
	}: {
		ratio: AspectRatio;
		region: TimelineRegion;
		interactive?: boolean;
		onchange?: (r: TimelineRegion) => void;
	} = $props();

	let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 720);

	const MIN_WIDTH = 80;
	// Minimum gap between the region and every viewport edge so the resize handles
	// always stay reachable.
	const EDGE_MARGIN = 16;

	function fromRegion(r: TimelineRegion): { w: number; left: number; top: number } {
		const arVal = ASPECT_RATIO[ratio];
		const w = r.widthFrac * vw;
		return {
			w,
			left: r.centerXFrac * vw - w / 2,
			top: r.centerYFrac * vh - w / (2 * arVal)
		};
	}

	const init = untrack(() => fromRegion(region));
	let width = $state(init.w);
	let left = $state(init.left);
	let top = $state(init.top);

	function clampBox(
		l: number,
		t: number,
		w: number
	): { x: number; y: number; w: number; h: number } {
		const arVal = ASPECT_RATIO[ratio];
		const fit = Math.min(vw - 2 * EDGE_MARGIN, (vh - 2 * EDGE_MARGIN) * arVal);
		let cw = w;
		if (cw > fit) cw = fit;
		if (cw < MIN_WIDTH) cw = MIN_WIDTH;
		const ch = cw / arVal;
		return {
			x: Math.max(EDGE_MARGIN, Math.min(l, vw - cw - EDGE_MARGIN)),
			y: Math.max(EDGE_MARGIN, Math.min(t, vh - ch - EDGE_MARGIN)),
			w: cw,
			h: ch
		};
	}

	const box = $derived(clampBox(left, top, width));

	// Re-sync local px from the controlled `region` prop when it (or the viewport /
	// ratio) changes externally — but never while a drag is in progress.
	let lastSynced = '';
	$effect(() => {
		const sig = `${region.widthFrac},${region.centerXFrac},${region.centerYFrac},${ratio},${vw},${vh}`;
		if (sig === lastSynced) return;
		lastSynced = sig;
		const v = fromRegion(region);
		width = v.w;
		left = v.left;
		top = v.top;
	});

	function emit() {
		onchange?.({
			widthFrac: box.w / vw,
			centerXFrac: (box.x + box.w / 2) / vw,
			centerYFrac: (box.y + box.h / 2) / vh
		});
	}

	type Drag =
		| { mode: 'move'; startX: number; startY: number; originLeft: number; originTop: number }
		| { mode: 'resize'; anchorX: number; anchorY: number };
	let drag: Drag | null = null;
	let moving = $state(false);

	let boxCursor = $derived(!interactive ? '' : moving ? 'cursor-grabbing' : 'cursor-grab');

	function beginMove(e: PointerEvent) {
		if (!interactive) return;
		e.preventDefault();
		drag = {
			mode: 'move',
			startX: e.clientX,
			startY: e.clientY,
			originLeft: left,
			originTop: top
		};
		moving = true;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', endDrag);
	}

	function beginResize(e: PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') {
		if (!interactive) return;
		e.preventDefault();
		e.stopPropagation();
		const ax = corner === 'tl' || corner === 'bl' ? box.x + box.w : box.x;
		const ay = corner === 'tl' || corner === 'tr' ? box.y + box.h : box.y;
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
		const arVal = ASPECT_RATIO[ratio];
		const rawW = Math.abs(e.clientX - drag.anchorX);
		const rawH = Math.abs(e.clientY - drag.anchorY);
		// Preserve ratio by taking the larger implied width.
		const w = Math.max(rawW, rawH * arVal);
		const h = w / arVal;
		const dirX = e.clientX >= drag.anchorX ? 1 : -1;
		const dirY = e.clientY >= drag.anchorY ? 1 : -1;
		left = dirX > 0 ? drag.anchorX : drag.anchorX - w;
		top = dirY > 0 ? drag.anchorY : drag.anchorY - h;
		width = w;
	}

	function endDrag() {
		drag = null;
		moving = false;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', endDrag);
		emit();
	}

	function onResize() {
		vw = window.innerWidth;
		vh = window.innerHeight;
	}
</script>

<svelte:window onresize={onResize} />

<div class="pointer-events-none absolute inset-0 z-20">
	<div
		class="absolute border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)] {boxCursor}"
		style="left: {box.x}px; top: {box.y}px; width: {box.w}px; height: {box.h}px; pointer-events: {interactive
			? 'auto'
			: 'none'};"
		onpointerdown={beginMove}
		role="button"
		tabindex="-1"
		aria-label="Recording frame"
	>
		{#if interactive}
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
