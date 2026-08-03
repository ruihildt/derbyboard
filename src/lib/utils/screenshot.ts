import { get } from 'svelte/store';
import type { KonvaGame } from '$lib/konva/KonvaGame';
import { captureSettings } from '$lib/stores/captureSettings';
import { exportSettings } from '$lib/stores/exportSettings';
import { formatRatio } from '$lib/utils/capture';

/**
 * Captures a screenshot of the current board: full page or the selected
 * capture zone, stamped with the configured watermark, and triggers a
 * download of the resulting PNG.
 */
export function captureScreenshot(game: KonvaGame): void {
	const s = get(captureSettings);
	const {
		image: { scale },
		watermark
	} = get(exportSettings);
	const dataUrl =
		s.format === 'full'
			? game.exportAsImage(scale, watermark)
			: game.exportZoneImage(s.zone ?? game.defaultZone(formatRatio(s.format)), scale, watermark);
	const link = document.createElement('a');
	link.download = `derbyboard-${new Date().toISOString().slice(0, 10)}.png`;
	link.href = dataUrl;
	link.click();
}
