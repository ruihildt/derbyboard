import { persisted } from 'svelte-persisted-store';
import type { PackMethod } from '$lib/trackMath';

/**
 * Board-wide settings, persisted across sessions. Currently holds the pack
 * measuring method (Sector vs Rectangle); extend here as more board settings
 * are added.
 */
export interface BoardSettings {
	packMethod: PackMethod;
	autoFace?: boolean;
	entityHudVisible?: boolean;
	directionMarkerVisible?: boolean;
}

export const boardSettings = persisted<BoardSettings>('derbyboard-board-settings', {
	packMethod: 'sector',
	autoFace: true,
	entityHudVisible: false,
	directionMarkerVisible: true
});
