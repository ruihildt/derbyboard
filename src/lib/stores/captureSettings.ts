import { persisted } from 'svelte-persisted-store';
import type { CaptureFormat, CaptureZone } from '$lib/utils/capture';

/**
 * Shared capture selection for both screenshot and video modes: the zone
 * format and the (optional) selection rect. A single source of truth so the
 * selection persists across the Screenshot/Video tabs.
 */
export interface CaptureSettings {
	format: CaptureFormat;
	zone?: CaptureZone;
}

export const captureSettings = persisted<CaptureSettings>('derbyboard-capture2', {
	format: 'full'
});
