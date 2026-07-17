import { persisted } from 'svelte-persisted-store';
import type { WatermarkSize } from '$lib/konva/Watermark';
import type { Quality } from '$lib/utils/codec';

export type VideoFps = 30 | 60;
export type ImageScale = 1 | 2 | 3 | 4;

export interface ExportSettings {
	video: { resolution: Quality; fps: VideoFps };
	image: { scale: ImageScale };
	/** Watermark size stamped on exported images and videos ('hidden' = off). */
	watermark: WatermarkSize;
}

/**
 * Persisted export defaults shared by the VideoExportDialog (video) and the
 * screenshot capture (image). Defaults: 1080p @ 60fps, 2× image scale, medium watermark.
 */
export const exportSettings = persisted<ExportSettings>('derbyboard-export', {
	video: { resolution: '1080p', fps: 60 },
	image: { scale: 2 },
	watermark: 'medium'
});
