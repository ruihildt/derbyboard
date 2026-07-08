const LOGO_SRC = '/derbyboard-logo.svg';
const SIZE_MULTIPLIER = 0.5;
const PADDING = 40;

/**
 * Loads the derbyboard logo once and stamps it as a screen-fixed watermark
 * (bottom-right corner) onto a canvas. Shared by image export and video
 * recording so the branding appears in both outputs.
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
	 * Draw the watermark into the bottom-right corner of the given context.
	 * Coordinates use the canvas's current logical space; `scale` sizes the logo
	 * for high-DPI / recording canvases (e.g. pixelRatio or a scaling factor).
	 */
	draw(ctx: CanvasRenderingContext2D, width: number, height: number, scale = 1): void {
		if (!this.loaded || !this.image.complete) return;

		const w = this.image.naturalWidth * SIZE_MULTIPLIER * scale;
		const h = this.image.naturalHeight * SIZE_MULTIPLIER * scale;
		if (w <= 0 || h <= 0) return;

		const padding = PADDING * scale;
		ctx.drawImage(this.image, width - w - padding, height - h - padding, w, h);
	}
}
