import { get } from 'svelte/store';
import Konva from 'konva';

import { boardState } from '$lib/stores/konvaBoardState';
import {
	BASE_ZOOM,
	CENTER_POINT_OFFSET,
	MAX_ZOOM,
	MIN_ZOOM,
	OUTER_VERTICAL_OFFSET_1,
	OUTER_VERTICAL_OFFSET_2,
	VERTICAL_OFFSET_1,
	VERTICAL_OFFSET_2,
	ZOOM_INCREMENT
} from '$lib/constants';

import { KonvaTrackGeometry, type Point } from './KonvaTrackGeometry';
import { KonvaPlayerManager } from './KonvaPlayerManager';
import { KonvaPackManager } from './KonvaPackManager';
import { KonvaRecorder } from './KonvaRecorder';
import { Watermark, type WatermarkSize } from './Watermark';
import type { CaptureZone } from '$lib/utils/capture';
import type { Snapshot, TimelineSample } from '$lib/recording/timeline/types';

const FRAME_DEFAULT_MARGIN = 0.1;

export class KonvaGame {
	private width: number;
	private height: number;

	private stage: Konva.Stage;
	private trackSurfaceLayer: Konva.Layer;
	private trackLinesLayer: Konva.Layer;
	private playersLayer: Konva.Layer;
	private engagementZoneLayer: Konva.Layer;

	private trackGeometry: KonvaTrackGeometry;
	private playerManager!: KonvaPlayerManager;
	private packManager!: KonvaPackManager;

	private watermark: Watermark;

	/** When true, replay drives the board: editing is locked and pack logic is not double-run. */
	private replayMode = false;

	constructor(containerId: string, width: number, height: number) {
		// Initialize basic properties first
		this.width = width;
		this.height = height;

		// This shouldn't be needed, since it's the default
		// But I feel a slight delay without it
		Konva.dragDistance = 0;

		// Create main stage
		this.stage = new Konva.Stage({
			container: containerId,
			width: this.width,
			height: this.height,
			draggable: true,
			pixelRatio: window.devicePixelRatio
		});

		// Add dragend listener for position persistence
		this.stage.on('dragend', () => {
			this.updatePersistedState();
		});

		// Apply persisted view settings
		this.loadViewSettings();

		// Create track geometry (depends on points)
		this.trackGeometry = new KonvaTrackGeometry(this.initializePoints());

		// Create a separate layer for track lines
		this.trackSurfaceLayer = new Konva.Layer();
		this.trackLinesLayer = new Konva.Layer();
		this.engagementZoneLayer = new Konva.Layer();
		this.playersLayer = new Konva.Layer();

		// Add in correct order:
		// 1. Track surface (bottom)
		this.trackGeometry.addTrackSurfaceToLayer(this.trackSurfaceLayer);
		this.stage.add(this.trackSurfaceLayer);

		// 2. Engagement zone (middle)
		this.stage.add(this.engagementZoneLayer);

		// 3. Track lines (over engagement zone)
		this.trackGeometry.addTrackLinesToLayer(this.trackLinesLayer);
		this.stage.add(this.trackLinesLayer);

		// 4. Players (top)
		this.stage.add(this.playersLayer);

		this.playerManager = new KonvaPlayerManager(this.playersLayer, this.trackGeometry);
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer,
			this.trackGeometry
		);

		// Register a single delegated handler for player interactions.
		// Registered once here (not in the managers) so it survives rebuilds and
		// always dispatches to the current playerManager/packManager instances.
		this.playersLayer.on('dragmove dragend touchmove touchend', (e) => {
			this.playerManager.handleDragMove(e);
			if (!this.replayMode) {
				this.packManager.determinePack();
			}
		});

		this.playersLayer.on('collision', (e) => {
			this.playerManager.handleCollision(e);
		});

		this.playerManager.initialLoad();
		this.packManager.determinePack();
		this.playersLayer.batchDraw();

		// Resize handling: window + visualViewport (mobile address bar / keyboard).
		// Debounced; see applyResize for the fit/restore logic.
		window.addEventListener('resize', this.handleResize);
		window.visualViewport?.addEventListener('resize', this.onVisualViewportResize);

		this.prevPortrait = this.isPortrait();
		this.watermark = new Watermark();

		// If the default view crops the track (e.g. small/mobile portrait), fit it.
		this.fitIfOverflowing();
	}

	destroy() {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		window.removeEventListener('resize', this.handleResize);
		window.visualViewport?.removeEventListener('resize', this.onVisualViewportResize);
		this.trackSurfaceLayer.destroy();
		this.trackLinesLayer.destroy();
		this.engagementZoneLayer.destroy();
		this.playersLayer.destroy();
		this.stage.destroy();
	}

	private initializePoints(): Record<string, Point> {
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		return {
			A: { x: centerX + CENTER_POINT_OFFSET, y: centerY },
			B: { x: centerX - CENTER_POINT_OFFSET, y: centerY },
			C: {
				x: centerX + CENTER_POINT_OFFSET,
				y: centerY - VERTICAL_OFFSET_1
			},
			D: {
				x: centerX + CENTER_POINT_OFFSET,
				y: centerY + VERTICAL_OFFSET_1
			},
			E: {
				x: centerX - CENTER_POINT_OFFSET,
				y: centerY - VERTICAL_OFFSET_1
			},
			F: {
				x: centerX - CENTER_POINT_OFFSET,
				y: centerY + VERTICAL_OFFSET_1
			},
			G: {
				x: centerX + CENTER_POINT_OFFSET,
				y: centerY - VERTICAL_OFFSET_2
			},
			H: {
				x: centerX - CENTER_POINT_OFFSET,
				y: centerY + VERTICAL_OFFSET_2
			},
			I: {
				x: centerX + CENTER_POINT_OFFSET,
				y: centerY - OUTER_VERTICAL_OFFSET_1
			},
			J: {
				x: centerX + CENTER_POINT_OFFSET,
				y: centerY + OUTER_VERTICAL_OFFSET_2
			},
			K: {
				x: centerX - CENTER_POINT_OFFSET,
				y: centerY - OUTER_VERTICAL_OFFSET_2
			},
			L: {
				x: centerX - CENTER_POINT_OFFSET,
				y: centerY + OUTER_VERTICAL_OFFSET_1
			}
		};
	}

	private resizeTimer: ReturnType<typeof setTimeout> | undefined;
	private prevPortrait = false;

	private isPortrait() {
		return this.height > this.width;
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

	private applyResize() {
		const el = this.stage.container();
		const newW = el?.clientWidth ?? window.innerWidth;
		const newH = el?.clientHeight ?? window.innerHeight;
		// Skip no-op / scale-only events.
		if (Math.abs(newW - this.width) < 1 && Math.abs(newH - this.height) < 1) return;

		const orientationChanged = this.prevPortrait !== newH > newW;
		this.recalculateDimensions();
		this.prevPortrait = this.isPortrait();
		this.rebuildTrackAndPlayers();

		if (this.replayMode) return; // replay drives the board; don't touch the view.

		if (orientationChanged) {
			// Track shape vs viewport changed a lot: re-fit the whole track.
			this.fitToTrack();
		} else {
			// Keep the user's zoom/pan; the track re-centers via fresh geometry.
			this.loadViewSettings();
			this.stage.batchDraw();
		}
	}

	private recalculateDimensions() {
		// Measure the container (sized by CSS dvh/dvw) so the canvas matches the
		// visible viewport; fall back to the window if unavailable.
		const el = this.stage.container();
		this.width = el?.clientWidth ?? window.innerWidth;
		this.height = el?.clientHeight ?? window.innerHeight;

		this.stage.width(this.width);
		this.stage.height(this.height);
	}

	private rebuildTrackAndPlayers() {
		// Clear all layers
		this.trackSurfaceLayer.destroyChildren();
		this.trackLinesLayer.destroyChildren();
		this.engagementZoneLayer.destroyChildren();
		this.playersLayer.destroyChildren();

		// Recreate track geometry with fresh points
		this.trackGeometry = new KonvaTrackGeometry(this.initializePoints());

		// Redraw track
		this.trackGeometry.addTrackSurfaceToLayer(this.trackSurfaceLayer);
		this.trackGeometry.addTrackLinesToLayer(this.trackLinesLayer);

		// Reinitialize player manager with fresh track
		this.playerManager = new KonvaPlayerManager(this.playersLayer, this.trackGeometry);

		// Either load from state or default lineup based on current state
		const state = get(boardState);
		if (state.teamPlayers && state.teamPlayers.length > 0) {
			this.playerManager.initialLoad();
		} else {
			this.playerManager.loadDefaultLineup();
		}

		// Update pack manager
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer,
			this.trackGeometry
		);

		// Recalculate pack
		this.packManager.determinePack();

		// Redraw all layers
		this.trackSurfaceLayer.batchDraw();
		this.trackLinesLayer.batchDraw();
		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
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
		const sx = this.width / 2 - cx * scale;
		const sy = this.height / 2 - cy * scale;

		this.stage.scale({ x: scale, y: scale });
		this.stage.position({ x: sx, y: sy });

		if (!this.replayMode) {
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
	private fitIfOverflowing() {
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

	private updatePersistedState() {
		// Replay drives the board programmatically; don't persist those frames.
		if (this.replayMode) return;

		const centerX = this.width / 2;
		const centerY = this.height / 2;

		// Calculate relative position from center
		const relativeX = this.stage.x() / centerX;
		const relativeY = this.stage.y() / centerY;

		const teamPlayers = this.playerManager.getTeamPlayers().map((player) => {
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

		const skatingOfficials = this.playerManager.getSkatingOfficials().map((official) => {
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

	private loadViewSettings() {
		const state = get(boardState);
		if (state.viewSettings) {
			const centerX = this.width / 2;
			const centerY = this.height / 2;

			// Convert relative positions back to absolute
			const absoluteX = state.viewSettings.relativeX * centerX;
			const absoluteY = state.viewSettings.relativeY * centerY;

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

	loadState() {
		// Clear existing players and layers
		this.playersLayer.destroyChildren();
		this.engagementZoneLayer.destroyChildren();

		// Load view settings
		this.loadViewSettings();

		// Create a new player manager and load players from state
		this.playerManager = new KonvaPlayerManager(this.playersLayer, this.trackGeometry);
		this.playerManager.initialLoad();

		// Update pack manager with new player manager
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer,
			this.trackGeometry
		);

		// Recalculate pack and engagement zone
		this.packManager.determinePack();

		// Redraw all layers
		this.trackSurfaceLayer.batchDraw();
		this.trackLinesLayer.batchDraw();
		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
		this.stage.batchDraw();
	}

	resetBoard() {
		// Reset stage position and scale
		this.stage.position({ x: 0, y: 0 });
		this.stage.scale({ x: BASE_ZOOM, y: BASE_ZOOM });

		// Make sure dimensions are current
		this.recalculateDimensions();

		// Reset persisted state first
		boardState.set({
			version: 3,
			createdAt: new Date().toISOString(),
			teamPlayers: [],
			skatingOfficials: [],
			viewSettings: {
				zoom: BASE_ZOOM,
				relativeX: 0,
				relativeY: 0
			}
		});

		// Rebuild everything with fresh dimensions
		this.rebuildTrackAndPlayers();

		this.stage.batchDraw();
		this.updatePersistedState();
	}

	createRecorder(): KonvaRecorder {
		return new KonvaRecorder({ stage: this.stage, watermark: this.watermark });
	}

	/** Exposes the stage for capture/replay modules that need to attach listeners. */
	getStage(): Konva.Stage {
		return this.stage;
	}

	/** Exposes the players layer for capture listeners. */
	getPlayersLayer(): Konva.Layer {
		return this.playersLayer;
	}

	isReplaying(): boolean {
		return this.replayMode;
	}

	/**
	 * Enters/exits replay mode. Entering locks the board (no dragging/panning);
	 * exiting restores editing and reloads the user's saved board state.
	 */
	setReplayMode(enabled: boolean): void {
		this.replayMode = enabled;
		this.stage.draggable(!enabled);
		this.playerManager.setPlayersDraggable(!enabled);
		if (!enabled) {
			// Restore the user's board after replay.
			this.loadState();
		}
	}

	/**
	 * Captures the current board (player/official relative positions + view) as a
	 * snapshot. The caller stamps `t`. Used by TimelineRecorder for capture.
	 */
	getSnapshot(): Snapshot {
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		const teamPlayers = this.playerManager.getTeamPlayers().map((player) => {
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

		const skatingOfficials = this.playerManager.getSkatingOfficials().map((official) => {
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

		return {
			teamPlayers,
			skatingOfficials,
			view: {
				zoom: this.stage.scaleX(),
				relativeX: this.stage.x() / centerX,
				relativeY: this.stage.y() / centerY
			}
		};
	}

	/**
	 * Reconciles the board to a sample (roster by id, positions, view) and redraws
	 * the pack/engagement zone. Used by TimelinePlayer for replay.
	 */
	applySnapshot(sample: TimelineSample): void {
		const wasReplaying = this.replayMode;
		this.replayMode = true;
		try {
			const centerX = this.width / 2;
			const centerY = this.height / 2;

			this.playerManager.reconcileTeamPlayers(sample.teamPlayers, centerX, centerY);
			this.playerManager.reconcileSkatingOfficials(sample.skatingOfficials, centerX, centerY);
			this.playerManager.setPlayersDraggable(false);

			this.playerManager.getTeamPlayers().forEach((p) => p.updateInBounds(this.trackGeometry));

			this.stage.scale({ x: sample.view.zoom, y: sample.view.zoom });
			this.stage.position({
				x: sample.view.relativeX * centerX,
				y: sample.view.relativeY * centerY
			});

			this.packManager.determinePack();
			this.trackSurfaceLayer.batchDraw();
			this.trackLinesLayer.batchDraw();
			this.engagementZoneLayer.batchDraw();
			this.playersLayer.batchDraw();
		} finally {
			this.replayMode = wasReplaying;
		}
	}

	exportAsImage(pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
		const sourceCanvas = this.stage.toCanvas({ pixelRatio });
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0);
		this.watermark.draw(ctx, canvas.width, canvas.height, watermark);
		return canvas.toDataURL();
	}

	/** Captures a viewport sub-region as a PNG data URL (with watermark). */
	exportZoneImage(zone: CaptureZone, pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
		const sourceCanvas = this.stage.toCanvas({
			x: zone.xFrac * this.width,
			y: zone.yFrac * this.height,
			width: zone.wFrac * this.width,
			height: zone.hFrac * this.height,
			pixelRatio
		});
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0);
		this.watermark.draw(ctx, canvas.width, canvas.height, watermark);
		return canvas.toDataURL();
	}

	/** Shared watermark (preloaded at construction); used by image and video export. */
	getWatermark(): Watermark {
		return this.watermark;
	}
}
