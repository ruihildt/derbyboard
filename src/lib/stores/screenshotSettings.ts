import { persisted } from 'svelte-persisted-store';
import type { CaptureFormat, CaptureZone } from '$lib/utils/capture';

export interface ScreenshotSettings {
	format: CaptureFormat;
	zone?: CaptureZone;
}

export const screenshotSettings = persisted<ScreenshotSettings>('derbyboard-screenshot-v2', {
	format: 'custom'
});
