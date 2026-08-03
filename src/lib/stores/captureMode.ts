import { writable } from 'svelte/store';

/** Which capture control the top-right action bar renders. Set only when a
 * capture tool (video/screenshot) is explicitly armed; switching to a non-
 * capture tool leaves the last-chosen mode in place so the action bar is
 * stable until the user picks the other capture tool. Defaults to screenshot. */
export type CaptureMode = 'video' | 'screenshot';

export const captureMode = writable<CaptureMode>('screenshot');
