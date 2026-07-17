const LOGO_SRC = '/derbyboard-logo.svg';

export type WatermarkSize = 'hidden' | 'small' | 'medium' | 'large';

/** Logo width as a fraction of the canvas/region width, per selected size. */
export const WATERMARK_FRACTIONS: Record<WatermarkSize, number> = {
	hidden: 0,
	small: 0.12,
	medium: 0.2,
	large: 0.3
};

/** Corner inset (padding) as a fraction of the canvas/region width. */
export const WATERMARK_PAD_FRACTION = 0.03;

/**
 * Loads the derbyboard logo once and stamps it as a screen-fixed watermark
 * (bottom-right corner) onto a canvas. Shared by image export and video
 * recording so the branding appears in both outputs.
 *
 * Both the logo size and its inset from the corner scale with the canvas
 * width, so the watermark looks identical (relatively) on a phone or a large
 * monitor — it never floats far from the border on small regions.
 */
export class Watermark {
	private image: HTMLImageElement;
	private loaded = false;

	constructor() {
		this.image = new Image();
		this.image.onload = () => {
			this.loaded = true;
		};
		this.image.src = LOGO_SRC;
	}

	/**
	 * Draw the watermark into the bottom-right corner of the given context, in
	 * the canvas's current logical space (i.e. the output resolution). `size`
	 * selects the relative width; 'hidden' draws nothing.
	 */
	draw(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		size: WatermarkSize = 'medium'
	): void {
		if (!this.loaded || !this.image.complete) return;

		const frac = WATERMARK_FRACTIONS[size];
		if (frac <= 0) return;

		// Never wider than half the canvas/region.
		const w = Math.min(width * frac, width / 2);
		const h = w * (this.image.naturalHeight / this.image.naturalWidth);
		if (w <= 0 || h <= 0) return;

		const padding = width * WATERMARK_PAD_FRACTION;
		ctx.drawImage(this.image, width - w - padding, height - h - padding, w, h);
	}
}
