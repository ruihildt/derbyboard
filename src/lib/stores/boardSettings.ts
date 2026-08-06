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
	/** Whole-board view rotation in degrees, snapped to 90° steps (0/90/180/270).
	 * Rotates the track and every drawn element as a group around the board
	 * centre; labels and the watermark keep their upright orientation. */
	boardRotation?: number;
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
	onionSkinDepth: 1,
	boardRotation: 0
});
