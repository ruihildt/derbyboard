import { get } from 'svelte/store';
import type { KonvaGame } from '$lib/konva/KonvaGame';
import { captureSettings } from '$lib/stores/captureSettings';
import { exportSettings } from '$lib/stores/exportSettings';
import { formatRatio } from '$lib/utils/capture';

/**
 * Captures a screenshot of the current board: full page or the selected
 * capture zone, stamped with the configured branding, and triggers a
 * download of the resulting PNG.
 */
export function captureScreenshot(game: KonvaGame): void {
	const s = get(captureSettings);
	const {
		image: { scale },
		branding
	} = get(exportSettings);
	const dataUrl =
		s.format === 'full'
			? game.exportAsImage(scale, branding)
			: game.exportZoneImage(s.zone ?? game.defaultZone(formatRatio(s.format)), scale, branding);
	const link = document.createElement('a');
	link.download = `derbyboard-${new Date().toISOString().slice(0, 10)}.png`;
	link.href = dataUrl;
	link.click();
}
