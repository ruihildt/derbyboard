import type Konva from 'konva';

import type { CaptureZone } from '$lib/utils/capture';
import { Branding, type BrandingSize } from '../Branding';

/**
 * Board image export: full-board and zone-cropped PNG data URLs with the
 * shared branding applied. Owns the preloaded {@link Branding} instance so
 * image and video export share one asset load.
 */
export class BoardExporter {
	private branding = new Branding();

	constructor(
		private stage: Konva.Stage,
		private getViewportSize: () => { width: number; height: number }
	) {}

	/** Shared branding (preloaded at construction); used by image and video export. */
	getBranding(): Branding {
		return this.branding;
	}

	/** Full board as a PNG data URL (with branding). */
	exportAsImage(pixelRatio = 2, branding: BrandingSize = 'medium'): string {
		const sourceCanvas = this.stage.toCanvas({ pixelRatio });
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0);
		this.branding.draw(ctx, canvas.width, canvas.height, branding);
		return canvas.toDataURL();
	}

	/** Captures a viewport sub-region as a PNG data URL (with branding). */
	exportZoneImage(zone: CaptureZone, pixelRatio = 2, branding: BrandingSize = 'medium'): string {
		const { width, height } = this.getViewportSize();
		const sourceCanvas = this.stage.toCanvas({
			x: zone.xFrac * width,
			y: zone.yFrac * height,
			width: zone.wFrac * width,
			height: zone.hFrac * height,
			pixelRatio
		});
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0);
		this.branding.draw(ctx, canvas.width, canvas.height, branding);
		return canvas.toDataURL();
	}
}
