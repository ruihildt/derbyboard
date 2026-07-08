<script lang="ts">
	import { onMount } from 'svelte';
	import { Game } from '$lib/classes/Game';
	import { panMode } from '$lib/stores/panMode';

	let { highResCanvas = $bindable(), game = $bindable() } = $props<{
		highResCanvas: HTMLCanvasElement;
		game: Game;
	}>();

	let canvas: HTMLCanvasElement;
	let isDragging = false;
	let lastX = 0;
	let lastY = 0;

	function handleMouseDown(e: MouseEvent) {
		if ($panMode) {
			isDragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		if ($panMode && isDragging) {
			const deltaX = e.clientX - lastX;
			const deltaY = e.clientY - lastY;
			game.scalingManager.setPan(-deltaX, -deltaY);
			lastX = e.clientX;
			lastY = e.clientY;
		}
	}

	function handleMouseUp() {
		isDragging = false;
	}

	function handleTouchStart(e: TouchEvent) {
		if ($panMode) {
			isDragging = true;
			lastX = e.touches[0].clientX;
			lastY = e.touches[0].clientY;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if ($panMode && isDragging) {
			const deltaX = e.touches[0].clientX - lastX;
			const deltaY = e.touches[0].clientY - lastY;
			game.scalingManager.setPan(-deltaX, -deltaY);
			lastX = e.touches[0].clientX;
			lastY = e.touches[0].clientY;
		}
	}

	function handleTouchEnd() {
		isDragging = false;
	}

	onMount(() => {
		const resizeCanvas = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};

		resizeCanvas();
		window.addEventListener('resize', resizeCanvas);

		requestAnimationFrame(() => {
			game = new Game(canvas, highResCanvas, false);
			game.gameLoop();
		});

		return () => {
			window.removeEventListener('resize', resizeCanvas);
			game?.cleanup();
		};
	});
</script>

<div class="h-full w-full">
	<canvas
		bind:this={canvas}
		width={window.innerWidth}
		height={window.innerHeight}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseUp}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		ontouchcancel={handleTouchEnd}
	></canvas>
	<canvas bind:this={highResCanvas} class="hidden"></canvas>
</div>
