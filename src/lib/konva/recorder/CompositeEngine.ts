import type { FrameRequest, RecorderEngine } from './types';

/**
 * Composites the display stage's live layer canvases into the capture canvas each
 * frame via drawImage. Konva keeps those layer canvases up to date as the user
 * interacts, so this captures movement, pack/engagement-zone changes and pan/zoom
 * without any per-frame allocation or re-rasterization — safe to run at 30fps.
 *
 * This is the default engine. Output resolution is bounded by the display canvas
 * (viewport × devicePixelRatio); region mode crops and scales the selected area to
 * the target dimensions.
 */
export class CompositeEngine implements RecorderEngine {
	prepare() {
		// Stateless: reads the live display layer canvases directly.
	}

	renderFrame({ stage, ctx, output, region, watermark }: FrameRequest): void {
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, output.w, output.h);

		for (const layer of stage.getLayers()) {
			const canvas = layer.getNativeCanvasElement();
			if (region) {
				// Region is in CSS px; map to the layer canvas's backing pixels.
				const dpr = canvas.width / stage.width();
				ctx.drawImage(
					canvas,
					region.x * dpr,
					region.y * dpr,
					region.w * dpr,
					region.h * dpr,
					0,
					0,
					output.w,
					output.h
				);
			} else {
				ctx.drawImage(canvas, 0, 0, output.w, output.h);
			}
		}

		if (watermark) {
			watermark.draw(ctx, output.w, output.h);
		}
	}

	destroy() {
		// Stateless: nothing to release.
	}
}
