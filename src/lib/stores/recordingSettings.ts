import { persisted } from 'svelte-persisted-store';
import type { Quality } from '$lib/utils/codec';
import type { AspectRatio, EngineKind, RecordingMode } from '$lib/utils/recording';

export interface RecordingSettings {
	mode: RecordingMode;
	ratio: AspectRatio;
	quality: Quality;
	engine: EngineKind;
}

/** Coarse-pointer or small screens default to a lighter quality tier. */
function defaultQuality(): Quality {
	if (typeof window === 'undefined') return '1080p';
	const coarse = window.matchMedia?.('(pointer: coarse)').matches;
	const small = Math.min(window.innerWidth, window.innerHeight) < 600;
	return coarse || small ? '720p' : '1080p';
}

export const recordingSettings = persisted<RecordingSettings>('derbyboard-recording', {
	mode: 'full',
	ratio: '16:9',
	quality: defaultQuality(),
	engine: 'composite'
});
