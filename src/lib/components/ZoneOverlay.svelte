<script lang="ts">
	import { untrack } from 'svelte';
	import type { CaptureZone } from '$lib/utils/capture';
	import WatermarkPreview from './WatermarkPreview.svelte';

	let {
		zone,
		ratio = null,
		interactive = true,
		mode = 'board',
		watermark = false,
		onchange
	}: {
		zone: CaptureZone;
		/** Aspect ratio to enforce, or null for free-form. */
		ratio?: number | null;
		interactive?: boolean;
		/** 'edit' shows resize handles; the region interior is always pass-through to the canvas. */
		mode?: 'board' | 'edit';
		/** Show the watermark preview inside the region. */
		watermark?: boolean;
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
	type Drag = {
		handle: Handle;
		originLeft: number;
		originTop: number;
		originW: number;
		originH: number;
	};
	let drag: Drag | null = null;
	let animating = $state(false);
	let centerTimer: ReturnType<typeof setTimeout> | undefined;

	function beginResize(e: PointerEvent, handle: Handle) {
		if (!interactive) return;
		e.preventDefault();
		e.stopPropagation();
		if (centerTimer) {
			clearTimeout(centerTimer);
			centerTimer = undefined;
		}
		animating = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = {
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
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', endDrag);
		// Lock the resized size to its clamped value, then animate to page center.
		width = box.w;
		height = box.h;
		centerZone();
	}

	// Slide the zone to the center of the page (size unchanged), then persist.
	// The box's CSS transition performs the animation.
	function centerZone() {
		const targetLeft = (vw - box.w) / 2;
		const targetTop = (vh - box.h) / 2;
		animating = true;
		// Defer the value change to the next frame so the transition style is
		// applied first; otherwise the browser won't animate the move.
		requestAnimationFrame(() => {
			left = targetLeft;
			top = targetTop;
			if (centerTimer) clearTimeout(centerTimer);
			centerTimer = setTimeout(() => {
				animating = false;
				emit();
			}, 320);
		});
	}

	// Re-center (animated) whenever the recording zone mode is toggled.
	let prevMode = untrack(() => mode);
	$effect(() => {
		if (mode === prevMode || !interactive) return;
		prevMode = mode;
		centerZone();
	});

	// Re-center when the zone format changes too — this is the action available
	// while edit mode is off (board mode), so centering triggers then as well.
	let prevRatio = untrack(() => ratio);
	$effect(() => {
		if (ratio === prevRatio || !interactive) return;
		prevRatio = ratio;
		centerZone();
	});

	function onResize() {
		vw = window.innerWidth;
		vh = window.innerHeight;
	}
</script>

<svelte:window onresize={onResize} />

<div class="pointer-events-none absolute inset-0 z-20">
	<div
		class="absolute shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]"
		style="left: {box.x}px; top: {box.y}px; width: {box.w}px; height: {box.h}px; pointer-events: none; transition: {animating
			? 'left 0.3s ease-out, top 0.3s ease-out'
			: 'none'};"
	>
		{#if watermark}
			<WatermarkPreview />
		{/if}
		{#if interactive && mode === 'edit'}
			<!-- Full-edge resize hit bands (the whole edge is draggable). -->
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top"
				class="pointer-events-auto absolute -top-5 left-11 right-11 h-11 cursor-ns-resize touch-none"
				onpointerdown={(e) => beginResize(e, 't')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom"
				class="pointer-events-auto absolute -bottom-5 left-11 right-11 h-11 cursor-ns-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'b')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize left"
				class="pointer-events-auto absolute -left-5 top-11 bottom-11 w-11 cursor-ew-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'l')}
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize right"
				class="pointer-events-auto absolute -right-5 top-11 bottom-11 w-11 cursor-ew-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'r')}
			></div>
			<!-- Corner handles: transparent 44px hit zones, with the L-bracket rendered
				separately, hugging the corner from outside and flush with the vertex. -->
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-left"
				class="pointer-events-auto absolute -left-1 -top-1 h-11 w-11 cursor-nwse-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'tl')}
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -left-0.5 -top-0.5 h-10 w-10 border-l-2 border-t-2 border-primary-600"
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize top-right"
				class="pointer-events-auto absolute -right-1 -top-1 h-11 w-11 cursor-nesw-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'tr')}
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -right-0.5 -top-0.5 h-10 w-10 border-r-2 border-t-2 border-primary-600"
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-left"
				class="pointer-events-auto absolute -left-1 -bottom-1 h-11 w-11 cursor-nesw-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'bl')}
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -left-0.5 -bottom-0.5 h-10 w-10 border-b-2 border-l-2 border-primary-600"
			></div>
			<div
				role="button"
				tabindex="-1"
				aria-label="Resize bottom-right"
				class="pointer-events-auto absolute -right-1 -bottom-1 h-11 w-11 cursor-nwse-resize touch-none"
				onpointerdown={(e) => beginResize(e, 'br')}
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -right-0.5 -bottom-0.5 h-10 w-10 border-b-2 border-r-2 border-primary-600"
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
