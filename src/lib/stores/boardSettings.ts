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
	annotationsVisible?: boolean;
	pathsVisible?: boolean;
	pathOverlay?: 'off' | 'all' | 'selected';
	onionSkin?: boolean;
	onionSkinDepth?: 1 | 2;
}

export const boardSettings = persisted<BoardSettings>('derbyboard-board-settings', {
	packMethod: 'sector',
	autoFace: true,
	entityHudVisible: false,
	directionMarkerVisible: true,
	annotationsVisible: true,
	pathsVisible: true,
	pathOverlay: 'off',
	onionSkin: false,
	onionSkinDepth: 1
});
