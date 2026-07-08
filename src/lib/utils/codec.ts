export type RecorderContainer = 'webm' | 'mp4';

export type Quality = '720p' | '1080p' | '1440p' | '2160p';

export interface RecorderCodec {
	/** mimeType for MediaRecorder; empty string lets the browser choose its default. */
	readonly mimeType: string;
	readonly container: RecorderContainer;
	/** Blob type used when assembling the final file. */
	readonly blobType: string;
}

/** Approximate target bitrates (bits/sec) per quality tier. */
export const BITRATE_BY_QUALITY: Record<Quality, number> = {
	'720p': 5_000_000,
	'1080p': 10_000_000,
	'1440p': 18_000_000,
	'2160p': 35_000_000
};

const CANDIDATES: readonly RecorderCodec[] = [
	{
		mimeType: 'video/webm;codecs=vp8,opus',
		container: 'webm',
		blobType: 'video/webm; codecs=vp8,opus'
	},
	{
		mimeType: 'video/webm;codecs=vp9,opus',
		container: 'webm',
		blobType: 'video/webm; codecs=vp9,opus'
	},
	{ mimeType: 'video/webm', container: 'webm', blobType: 'video/webm' },
	{ mimeType: 'video/mp4;codecs=h264,aac', container: 'mp4', blobType: 'video/mp4' },
	{ mimeType: 'video/mp4', container: 'mp4', blobType: 'video/mp4' }
];

let cached: RecorderCodec | null = null;

/**
 * Picks the best MediaRecorder codec the current browser supports.
 *
 * WebM/VP8 is preferred (existing behavior on Chromium/Firefox); MP4/H.264 is the
 * fallback so iOS Safari — which does not support WebM recording — can record too.
 * When nothing matches, an empty mimeType is returned so MediaRecorder uses its own
 * default.
 */
export function pickRecorderCodec(): RecorderCodec {
	if (cached) return cached;
	if (typeof MediaRecorder === 'undefined') {
		cached = CANDIDATES[0];
		return cached;
	}
	const match = CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType));
	cached = match ?? { mimeType: '', container: 'webm', blobType: 'video/webm' };
	return cached;
}
