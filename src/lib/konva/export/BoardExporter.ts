import type Konva from 'konva';

import type { CaptureZone } from '$lib/utils/capture';
import { Watermark, type WatermarkSize } from '../Watermark';

/**
 * Board image export: full-board and zone-cropped PNG data URLs with the
 * shared watermark applied. Owns the preloaded {@link Watermark} instance so
 * image and video export share one asset load.
 */
export class BoardExporter {
	private watermark = new Watermark();

	constructor(
		private stage: Konva.Stage,
		private getViewportSize: () => { width: number; height: number }
	) {}

	/** Shared watermark (preloaded at construction); used by image and video export. */
	getWatermark(): Watermark {
		return this.watermark;
	}

	/** Full board as a PNG data URL (with watermark). */
	exportAsImage(pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
		const sourceCanvas = this.stage.toCanvas({ pixelRatio });
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0);
		this.watermark.draw(ctx, canvas.width, canvas.height, watermark);
		return canvas.toDataURL();
	}

	/** Captures a viewport sub-region as a PNG data URL (with watermark). */
	exportZoneImage(zone: CaptureZone, pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
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
		this.watermark.draw(ctx, canvas.width, canvas.height, watermark);
		return canvas.toDataURL();
	}
}
