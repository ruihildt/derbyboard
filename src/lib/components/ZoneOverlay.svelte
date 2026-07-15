<script lang="ts">
	import { untrack } from 'svelte';
	import type { CaptureZone } from '$lib/utils/capture';

	let {
		zone,
		ratio = null,
		interactive = true,
		onchange
	}: {
		zone: CaptureZone;
		/** Aspect ratio to enforce, or null for free-form. */
		ratio?: number | null;
		interactive?: boolean;
		onchange: (zone: CaptureZone) => void;
	} = $props();

	let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 720);

	const MIN_SIZE = 80;
	// Minimum gap between the zone and every viewport edge so handles stay reachable.
	const EDGE_MARGIN = 16;

	function fromZone(z: CaptureZone): {
		left: number;
		top: number;
		width: number;
		height: number;
	} {
		return {
			left: z.xFrac * vw,
			top: z.yFrac * vh,
			width: z.wFrac * vw,
			height: z.hFrac * vh
		};
	}

	const init = untrack(() => fromZone(zone));
	let left = $state(init.left);
	let top = $state(init.top);
	let width = $state(init.width);
	let height = $state(init.height);

	function clampBox(
		l: number,
		t: number,
		w: number,
		h: number
	): { x: number; y: number; w: number; h: number } {
		const maxW = vw - 2 * EDGE_MARGIN;
		const maxH = vh - 2 * EDGE_MARGIN;
		let cw = w;
		let ch = h;
		if (ratio !== null) {
			const fit = Math.min(maxW, maxH * ratio);
			cw = Math.min(Math.max(cw, MIN_SIZE), fit);
			ch = cw / ratio;
		} else {
			cw = Math.min(Math.max(cw, MIN_SIZE), maxW);
			ch = Math.min(Math.max(ch, MIN_SIZE), maxH);
		}
		return {
			x: Math.max(EDGE_MARGIN, Math.min(l, vw - cw - EDGE_MARGIN)),
			y: Math.max(EDGE_MARGIN, Math.min(t, vh - ch - EDGE_MARGIN)),
			w: cw,
			h: ch
		};
	}

	const box = $derived(clampBox(left, top, width, height));

	// Re-sync local px from the controlled `zone` prop when it (or the viewport /
	// ratio) changes externally — but never while a drag is in progress.
	let lastSynced = '';
	$effect(() => {
		const sig = `${zone.xFrac},${zone.yFrac},${zone.wFrac},${zone.hFrac},${ratio},${vw},${vh}`;
		if (sig === lastSynced) return;
		lastSynced = sig;
		const v = fromZone(zone);
		left = v.left;
		top = v.top;
		width = v.width;
		height = v.height;
	});

	function emit() {
		onchange({
			xFrac: box.x / vw,
			yFrac: box.y / vh,
			wFrac: box.w / vw,
			hFrac: box.h / vh
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
		const dirX = e.clientX >= drag.anchorX ? 1 : -1;
		const dirY = e.clientY >= drag.anchorY ? 1 : -1;
		let w: number;
		let h: number;
		if (ratio !== null) {
			// Preserve ratio by taking the larger implied width.
			const rawW = Math.abs(e.clientX - drag.anchorX);
			const rawH = Math.abs(e.clientY - drag.anchorY);
			w = Math.max(rawW, rawH * ratio);
			h = w / ratio;
		} else {
			w = Math.max(Math.abs(e.clientX - drag.anchorX), MIN_SIZE);
			h = Math.max(Math.abs(e.clientY - drag.anchorY), MIN_SIZE);
		}
		left = dirX > 0 ? drag.anchorX : drag.anchorX - w;
		top = dirY > 0 ? drag.anchorY : drag.anchorY - h;
		width = w;
		height = h;
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
		aria-label="Capture selection"
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
