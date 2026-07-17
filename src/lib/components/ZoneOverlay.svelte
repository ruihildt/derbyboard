<script lang="ts">
	import { untrack } from 'svelte';
	import type { CaptureZone } from '$lib/utils/capture';

	let {
		zone,
		ratio = null,
		interactive = true,
		mode = 'board',
		onchange
	}: {
		zone: CaptureZone;
		/** Aspect ratio to enforce, or null for free-form. */
		ratio?: number | null;
		interactive?: boolean;
		/** 'edit' shows resize handles; 'board' is fully pass-through (visual guide). */
		mode?: 'board' | 'edit';
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

	type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
	type Drag =
		| { mode: 'move'; startX: number; startY: number; originLeft: number; originTop: number }
		| {
				mode: 'resize';
				handle: Handle;
				originLeft: number;
				originTop: number;
				originW: number;
				originH: number;
		  };
	let drag: Drag | null = null;
	let moving = $state(false);

	// In Edit mode the box interior is a move target (grab cursor); otherwise the
	// box is pass-through and shows no special cursor.
	let boxCursor = $derived(
		interactive && mode === 'edit' ? (moving ? 'cursor-grabbing' : 'cursor-grab') : ''
	);

	function beginMove(e: PointerEvent) {
		if (!interactive || mode !== 'edit') return;
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

	function beginResize(e: PointerEvent, handle: Handle) {
		if (!interactive) return;
		e.preventDefault();
		e.stopPropagation();
		drag = {
			mode: 'resize',
			handle,
			originLeft: box.x,
			originTop: box.y,
			originW: box.w,
			originH: box.h
		};
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
		const { originLeft: ol, originTop: ot, originW: ow, originH: oh, handle } = drag;
		const moveL = handle.includes('l');
		const moveR = handle.includes('r');
		const moveT = handle.includes('t');
		const moveB = handle.includes('b');

		let l = ol;
		let t = ot;
		let w = ow;
		let h = oh;

		if (ratio !== null) {
			// Implied dimensions from whichever axis the active handle drives.
			let dw: number | null = moveL ? ol + ow - e.clientX : moveR ? e.clientX - ol : null;
			let dh: number | null = moveT ? ot + oh - e.clientY : moveB ? e.clientY - ot : null;
			// Drive width by the larger implied dimension (matches corner behavior).
			if (dw !== null && dh !== null) w = Math.max(dw, dh * ratio);
			else if (dw !== null) w = dw;
			else if (dh !== null) w = dh * ratio;
			w = Math.max(w, MIN_SIZE);
			h = w / ratio;
			if (moveL) l = ol + ow - w;
			if (moveT) t = ot + oh - h;
		} else {
			if (moveL) {
				w = Math.max(ol + ow - e.clientX, MIN_SIZE);
				l = ol + ow - w;
			}
			if (moveR) w = Math.max(e.clientX - ol, MIN_SIZE);
			if (moveT) {
				h = Math.max(ot + oh - e.clientY, MIN_SIZE);
				t = ot + oh - h;
			}
			if (moveB) h = Math.max(e.clientY - ot, MIN_SIZE);
		}
		left = l;
		top = t;
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
		class="absolute shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)] {boxCursor}"
		style="left: {box.x}px; top: {box.y}px; width: {box.w}px; height: {box.h}px; pointer-events: {interactive &&
		mode === 'edit'
			? 'auto'
			: 'none'};"
		onpointerdown={beginMove}
		role="button"
		tabindex="-1"
		aria-label="Capture selection"
	>
		{#if interactive && mode === 'edit'}
			<!-- Full-edge resize hit bands (the whole edge is draggable). -->
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top"
				class="pointer-events-auto absolute inset-x-0 top-0 h-3 cursor-ns-resize"
				onpointerdown={(e) => beginResize(e, 't')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom"
				class="pointer-events-auto absolute inset-x-0 bottom-0 h-3 cursor-ns-resize"
				onpointerdown={(e) => beginResize(e, 'b')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize left"
				class="pointer-events-auto absolute inset-y-0 left-0 w-3 cursor-ew-resize"
				onpointerdown={(e) => beginResize(e, 'l')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize right"
				class="pointer-events-auto absolute inset-y-0 right-0 w-3 cursor-ew-resize"
				onpointerdown={(e) => beginResize(e, 'r')}
			></div>
			<!-- Corner handles: solid inward L-brackets hugging the zone from outside. -->
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-left"
				class="pointer-events-auto absolute -left-0.5 -top-0.5 h-10 w-10 cursor-nwse-resize border-l-2 border-t-2 border-primary-600"
				onpointerdown={(e) => beginResize(e, 'tl')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-right"
				class="pointer-events-auto absolute -right-0.5 -top-0.5 h-10 w-10 cursor-nesw-resize border-r-2 border-t-2 border-primary-600"
				onpointerdown={(e) => beginResize(e, 'tr')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-left"
				class="pointer-events-auto absolute -left-0.5 -bottom-0.5 h-10 w-10 cursor-nesw-resize border-b-2 border-l-2 border-primary-600"
				onpointerdown={(e) => beginResize(e, 'bl')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-right"
				class="pointer-events-auto absolute -right-0.5 -bottom-0.5 h-10 w-10 cursor-nwse-resize border-b-2 border-r-2 border-primary-600"
				onpointerdown={(e) => beginResize(e, 'br')}
			></div>
			<!-- Edge midpoint markers: short inset lines (decoration only). -->
			<div
				aria-hidden="true"
				class="pointer-events-none absolute left-1/2 -top-0.5 h-0.5 w-10 -translate-x-1/2 bg-primary-600"
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -bottom-0.5 left-1/2 h-0.5 w-10 -translate-x-1/2 bg-primary-600"
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -left-0.5 top-1/2 h-10 w-0.5 -translate-y-1/2 bg-primary-600"
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -right-0.5 top-1/2 h-10 w-0.5 -translate-y-1/2 bg-primary-600"
			></div>
		{/if}
	</div>
</div>
