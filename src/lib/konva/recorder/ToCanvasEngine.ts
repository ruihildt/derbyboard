import type { FrameRequest, RecorderEngine } from './types';

/**
 * Re-rasterizes the live display stage into the capture canvas each frame via
 * `stage.toCanvas`. Because it reads the live stage, player movement, pack/
 * engagement-zone updates and pan/zoom are all captured.
 *
 * Region mode passes the selection bounds plus a `pixelRatio` so the framed area
 * is rasterized directly at the output resolution (native, no upscale).
 */
export class ToCanvasEngine implements RecorderEngine {
	prepare() {
		// Stateless: nothing to build.
	}

	renderFrame({ stage, ctx, output, region, watermark, scalingFactor }: FrameRequest): void {
		const frame = region
			? stage.toCanvas({
					x: region.x,
					y: region.y,
					width: region.w,
					height: region.h,
					pixelRatio: output.w / region.w
				})
			: stage.toCanvas({
					x: 0,
					y: 0,
					width: stage.width(),
					height: stage.height(),
					pixelRatio: scalingFactor
				});

		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, output.w, output.h);
		ctx.drawImage(frame, 0, 0);

		if (watermark) {
			watermark.draw(ctx, output.w, output.h, 1);
		}
	}

	destroy() {
		// Stateless: nothing to release.
	}
}
