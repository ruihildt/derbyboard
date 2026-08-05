import { get } from 'svelte/store';
import type Konva from 'konva';

import {
	BASE_ZOOM,
	CENTER_POINT_OFFSET,
	MAX_ZOOM,
	MIN_ZOOM,
	OUTER_VERTICAL_OFFSET_1,
	OUTER_VERTICAL_OFFSET_2,
	VERTICAL_OFFSET_2,
	ZOOM_INCREMENT
} from '$lib/constants';
import { boardState } from '$lib/stores/konvaBoardState';
import type { CaptureZone } from '$lib/utils/capture';
import type { KonvaPlayerManager } from '../KonvaPlayerManager';

const FRAME_DEFAULT_MARGIN = 0.1;

/** TEMPORARY diagnostic for the "zoom drifts down" bug: logs every stage
 * scale change with its trigger. Remove once the cause is confirmed. */
function logZoom(source: string, from: number, to: number, extra?: unknown) {
	if (Math.abs(from - to) < 1e-9) return;
	console.debug(
		`[zoom-debug] ${source}: ${(from * 100).toFixed(2)}% -> ${(to * 100).toFixed(2)}%`,
		extra ?? ''
	);
}

export interface ViewportHooks {
	isReplayMode: () => boolean;
	getPlayerManager: () => KonvaPlayerManager;
	/** Rebuild track geometry + players around the new center. */
	onRebuild: () => void;
	/** Re-project step overlays (paths/annotations/onion skin) after a rebuild. */
	onOverlaysChanged: () => void;
	/** Replay branch of resize handling; true when replay is active. */
	onReplayResize: () => boolean;
}

/**
 * Viewport state and geometry: the canvas dimensions, zoom/pan transforms
 * (anchored at center, a gesture point, or the whole-track fit), persisted
 * view settings, and debounced resize handling (window + visualViewport for
 * the mobile address bar / keyboard).
 *
 * The stage transform is the single source of truth for zoom/pan; this class
 * owns the canvas width/height everything else (projection, replay fit,
 * export) measures against.
 */
export class ViewportController {
	private width: number;
	private height: number;
	private resizeTimer: ReturnType<typeof setTimeout> | undefined;
	private prevPortrait = false;

	constructor(
		private stage: Konva.Stage,
		width: number,
		height: number,
		private hooks: ViewportHooks
	) {
		this.width = width;
		this.height = height;
	}

	get size(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}

	private isPortrait() {
		return this.height > this.width;
	}

	/** Adds the window/visualViewport listeners and records the orientation. */
	attach(): void {
		this.prevPortrait = this.isPortrait();
		window.addEventListener('resize', this.handleResize);
		window.visualViewport?.addEventListener('resize', this.onVisualViewportResize);
	}

	destroy(): void {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		window.removeEventListener('resize', this.handleResize);
		window.visualViewport?.removeEventListener('resize', this.onVisualViewportResize);
	}

	// Debounced entry point shared by `resize` and `visualViewport` events.
	private handleResize = () => {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		this.resizeTimer = setTimeout(() => this.applyResize(), 150);
	};

	private onVisualViewportResize = () => {
		// visualViewport also fires for scale-only changes (page pinch-zoom);
		// applyResize no-ops when the layout size hasn't actually changed.
		this.handleResize();
	};

	/**
	 * Public resize hook for layout-driven container changes the window
	 * `resize` listener can't see (e.g. a docked sidebar shrinking the canvas
	 * via CSS). Routes through the same debounced `handleResize` so the stage
	 * re-measures its container and the track re-fits.
	 */
	resize(): void {
		this.handleResize();
	}

	private applyResize() {
		const el = this.stage.container();
		const newW = el?.clientWidth ?? window.innerWidth;
		const newH = el?.clientHeight ?? window.innerHeight;
		// Skip no-op / scale-only events.
		if (Math.abs(newW - this.width) < 1 && Math.abs(newH - this.height) < 1) return;
		console.debug(
			`[zoom-debug] applyResize: ${this.width}x${this.height} -> ${newW}x${newH}, stage zoom ${(this.stage.scaleX() * 100).toFixed(2)}%, persisted zoom ${((get(boardState).viewSettings?.zoom ?? 1) * 100).toFixed(2)}%`
		);

		const orientationChanged = this.prevPortrait !== newH > newW;
		this.recalculateDimensions();
		this.prevPortrait = this.isPortrait();
		this.hooks.onRebuild();

		// Replay drives the board: recompute the source→viewport fit and
		// re-render the last sample (a paused replay must not go stale).
		if (this.hooks.onReplayResize()) return;

		if (orientationChanged) {
			// Track shape vs viewport changed a lot: re-fit the whole track.
			this.fitToTrack();
		} else {
			// Keep the user's zoom/pan; the track re-centers via fresh geometry.
			this.loadViewSettings();
			this.stage.batchDraw();
		}

		// Step overlays (paths, annotations, onion skin) are drawn with absolute
		// pixel coordinates baked in at render time via projectPoint(), which
		// is anchored to the stage center (width/2, height/2). The track + players
		// were just rebuilt around the new center, so re-project these overlays too
		// — otherwise paths stay floating at their old pixel positions instead of
		// following the player. (Replay is handled by renderSampleTransform above.)
		// In Live the step is undefined but board-level annotations still need
		// re-projecting, so this runs in both experiences.
		this.hooks.onOverlaysChanged();
	}

	/** Measures the container (sized by CSS dvh/dvw) so the canvas matches the
	 * visible viewport; falls back to the window if unavailable. */
	recalculateDimensions() {
		const el = this.stage.container();
		this.width = el?.clientWidth ?? window.innerWidth;
		this.height = el?.clientHeight ?? window.innerHeight;

		this.stage.width(this.width);
		this.stage.height(this.height);
	}

	// Increase zoom level within MAX_ZOOM limit
	zoomIn() {
		const newScale = Math.min(this.stage.scaleX() + ZOOM_INCREMENT, MAX_ZOOM);
		this.updateZoom(newScale);
	}

	zoomOut() {
		// Decrease zoom level within MIN_ZOOM limit
		const newScale = Math.max(this.stage.scaleX() - ZOOM_INCREMENT, MIN_ZOOM);
		this.updateZoom(newScale);
	}

	// Reset zoom and position to default values
	resetZoom() {
		const state = get(boardState);
		boardState.set({
			...state,
			viewSettings: {
				zoom: BASE_ZOOM,
				relativeX: 0,
				relativeY: 0
			}
		});
		this.stage.scale({ x: BASE_ZOOM, y: BASE_ZOOM });
		this.stage.position({ x: 0, y: 0 });
		this.stage.batchDraw();
	}

	/** Track bounding box in unscaled board (stage-local) coordinates. */
	getTrackBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
		const cx = this.width / 2;
		const cy = this.height / 2;
		const outerTurnRadius = OUTER_VERTICAL_OFFSET_2 + VERTICAL_OFFSET_2;
		return {
			minX: cx - CENTER_POINT_OFFSET - outerTurnRadius,
			maxX: cx + CENTER_POINT_OFFSET + outerTurnRadius,
			minY: cy - OUTER_VERTICAL_OFFSET_1,
			maxY: cy + OUTER_VERTICAL_OFFSET_1
		};
	}

	/** Live stage transform for mapping board coordinates to viewport pixels. */
	getView(): { zoom: number; x: number; y: number } {
		return { zoom: this.stage.scaleX(), x: this.stage.x(), y: this.stage.y() };
	}

	/**
	 * Default zone (whole track + margin) as viewport-relative fractions.
	 * When `ratio` is null the zone is free-form; otherwise it is fitted to the
	 * given aspect ratio. Clamped inside the viewport.
	 */
	defaultZone(ratio: number | null): CaptureZone {
		const b = this.getTrackBounds();
		const { zoom, x: sx, y: sy } = this.getView();

		const bw = (b.maxX - b.minX) * FRAME_DEFAULT_MARGIN;
		const bh = (b.maxY - b.minY) * FRAME_DEFAULT_MARGIN;
		const cx = (b.minX + b.maxX) / 2;
		const cy = (b.minY + b.maxY) / 2;
		const ebw = b.maxX - b.minX + 2 * bw;
		const ebh = b.maxY - b.minY + 2 * bh;

		let rw: number;
		let rh: number;
		if (ratio === null) {
			rw = ebw;
			rh = ebh;
		} else if (ebw / ebh > ratio) {
			rw = ebw;
			rh = ebw / ratio;
		} else {
			rh = ebh;
			rw = ebh * ratio;
		}

		const left = sx + (cx - rw / 2) * zoom;
		const top = sy + (cy - rh / 2) * zoom;
		const w = rw * zoom;
		const h = rh * zoom;

		// Clamp inside the viewport.
		const x0 = Math.max(0, left);
		const y0 = Math.max(0, top);
		const x1 = Math.min(this.width, left + w);
		const y1 = Math.min(this.height, top + h);

		return {
			xFrac: x0 / this.width,
			yFrac: y0 / this.height,
			wFrac: (x1 - x0) / this.width,
			hFrac: (y1 - y0) / this.height
		};
	}

	/**
	 * Fits the whole track (with margin) inside the viewport and centers it,
	 * persisting the resulting view unless in replay mode. Used on orientation
	 * change and whenever the default view would crop the track.
	 */
	fitToTrack(margin = FRAME_DEFAULT_MARGIN) {
		const b = this.getTrackBounds();
		const tw = (b.maxX - b.minX) * (1 + 2 * margin);
		const th = (b.maxY - b.minY) * (1 + 2 * margin);
		const cx = (b.minX + b.maxX) / 2;
		const cy = (b.minY + b.maxY) / 2;

		const scale = Math.min(this.width / tw, this.height / th, MAX_ZOOM);
		logZoom('fitToTrack', this.stage.scaleX(), scale, `viewport ${this.width}x${this.height}`);
		const sx = this.width / 2 - cx * scale;
		const sy = this.height / 2 - cy * scale;

		this.stage.scale({ x: scale, y: scale });
		this.stage.position({ x: sx, y: sy });

		if (!this.hooks.isReplayMode()) {
			boardState.update((s) => ({
				...s,
				viewSettings: {
					zoom: scale,
					relativeX: sx / (this.width / 2),
					relativeY: sy / (this.height / 2)
				}
			}));
		}

		this.stage.batchDraw();
	}

	/** Fits the track only if it currently overflows the viewport. */
	fitIfOverflowing() {
		const b = this.getTrackBounds();
		const zoom = this.stage.scaleX();
		const tw = (b.maxX - b.minX) * zoom;
		const th = (b.maxY - b.minY) * zoom;
		if (tw > this.width || th > this.height) {
			this.fitToTrack();
		}
	}

	// Update zoom while maintaining the center point
	private updateZoom(newScale: number) {
		logZoom('updateZoom (zoom buttons)', this.stage.scaleX(), newScale);
		// Get current center point
		const centerX = this.stage.width() / 2;
		const centerY = this.stage.height() / 2;

		// Get current position relative to center
		const relativeX = (centerX - this.stage.x()) / this.stage.scaleX();
		const relativeY = (centerY - this.stage.y()) / this.stage.scaleX();

		// Calculate new position to maintain the same center point
		const newX = centerX - relativeX * newScale;
		const newY = centerY - relativeY * newScale;

		const state = get(boardState);
		boardState.set({
			...state,
			viewSettings: {
				zoom: newScale,
				relativeX: newX / centerX,
				relativeY: newY / centerY
			}
		});

		this.stage.scale({ x: newScale, y: newScale });
		this.stage.position({ x: newX, y: newY });
		this.stage.batchDraw();
	}

	/**
	 * Zoom while keeping the world point under `viewportPoint` (a stage-space pixel)
	 * fixed in place. Used by pinch (anchored at the midpoint) and wheel (cursor).
	 * The caller persists the resulting view; this only applies the transform.
	 */
	zoomAt(viewportPoint: { x: number; y: number }, newScale: number) {
		const s = this.stage.scaleX();
		const worldX = (viewportPoint.x - this.stage.x()) / s;
		const worldY = (viewportPoint.y - this.stage.y()) / s;
		const clamped = Math.min(Math.max(newScale, MIN_ZOOM), MAX_ZOOM);
		logZoom('zoomAt (wheel/pinch)', s, clamped);
		this.stage.scale({ x: clamped, y: clamped });
		this.stage.position({
			x: viewportPoint.x - worldX * clamped,
			y: viewportPoint.y - worldY * clamped
		});
		this.stage.batchDraw();
	}

	/** Persists the current entity positions + view (no-op during replay). */
	updatePersistedState() {
		// Replay drives the board programmatically; don't persist those frames.
		if (this.hooks.isReplayMode()) return;

		const playerManager = this.hooks.getPlayerManager();
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		// Calculate relative position from center
		const relativeX = this.stage.x() / centerX;
		const relativeY = this.stage.y() / centerY;

		const teamPlayers = playerManager.getTeamPlayers().map((player) => {
			const pos = player.getPosition();
			return {
				id: player.id,
				relative: {
					x: pos.x - centerX,
					y: pos.y - centerY
				},
				role: player.role,
				team: player.team
			};
		});

		const skatingOfficials = playerManager.getSkatingOfficials().map((official) => {
			const pos = official.getPosition();
			return {
				id: official.id,
				relative: {
					x: pos.x - centerX,
					y: pos.y - centerY
				},
				role: official.role
			};
		});

		boardState.set({
			version: 3,
			createdAt: new Date().toISOString(),
			teamPlayers,
			skatingOfficials,
			viewSettings: {
				zoom: this.stage.scaleX(),
				relativeX,
				relativeY
			}
		});
	}

	/** Applies the persisted view settings (zoom + relative pan) to the stage. */
	loadViewSettings() {
		const state = get(boardState);
		if (state.viewSettings) {
			const centerX = this.width / 2;
			const centerY = this.height / 2;

			// Convert relative positions back to absolute
			const absoluteX = state.viewSettings.relativeX * centerX;
			const absoluteY = state.viewSettings.relativeY * centerY;

			logZoom('loadViewSettings (resize snap-back)', this.stage.scaleX(), state.viewSettings.zoom);

			this.stage.scale({
				x: state.viewSettings.zoom,
				y: state.viewSettings.zoom
			});

			this.stage.position({
				x: absoluteX,
				y: absoluteY
			});

			this.stage.batchDraw();
		}
	}
}
