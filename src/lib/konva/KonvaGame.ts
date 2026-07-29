import { get } from 'svelte/store';
import Konva from 'konva';

import { boardState } from '$lib/stores/konvaBoardState';
import { selectedEntityId, directionControlActive } from '$lib/stores/selection';
import { boardSettings } from '$lib/stores/boardSettings';
import {
	BASE_ZOOM,
	CENTER_POINT_OFFSET,
	MAX_ZOOM,
	MIN_ZOOM,
	OUTER_VERTICAL_OFFSET_1,
	OUTER_VERTICAL_OFFSET_2,
	PLAYER_RADIUS,
	VERTICAL_OFFSET_1,
	VERTICAL_OFFSET_2,
	ZOOM_INCREMENT,
	TRACK_SCALE,
	colors
} from '$lib/constants';

import { KonvaTrackGeometry, type Point } from './KonvaTrackGeometry';
import { KonvaPlayerManager } from './KonvaPlayerManager';
import { KonvaPackManager } from './KonvaPackManager';
import { KonvaRecorder } from './KonvaRecorder';
import { KonvaGestureHandler } from './KonvaGestureHandler';
import { Watermark, type WatermarkSize } from './Watermark';
import { fitSourceToViewport, type CaptureFit, type CaptureZone } from '$lib/utils/capture';
import type { Snapshot, TimelineSample } from '$lib/recording/timeline/types';
import { boardDoc } from '$lib/doc/store';
import { poseStore } from '$lib/doc/poses';
import { migrateBoardState } from '$lib/doc/migrate';
import { fromTrack, toTrack, tangentAt } from '$lib/track/trackFrame';
import { motionHeading } from '$lib/track/heading';
import { tweenSteps, easeInOutCubic } from '$lib/track/tween';
import type { Entity, EntityPose, HeadingMode } from '$lib/doc/types';
import type { TeamPlayerRole, TeamPlayerTeam } from './KonvaTeamPlayer';
import type { SkatingOfficialRole } from './KonvaSkatingOfficial';

const FRAME_DEFAULT_MARGIN = 0.1;

/** Max tail points kept per entity for motion trails. */
const TRAIL_MAX_POINTS = 24;

/** Normalises an angle to (-π, π]. */
function normalizeAngle(a: number): number {
	let x = ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
	if (x <= -Math.PI) x += 2 * Math.PI;
	return x;
}

export class KonvaGame {
	private width: number;
	private height: number;

	private stage: Konva.Stage;
	private trackSurfaceLayer: Konva.Layer;
	private trackLinesLayer: Konva.Layer;
	private playersLayer: Konva.Layer;
	private engagementZoneLayer: Konva.Layer;
	/** Fading team-coloured tails behind entities during authored playback. */
	private trailLayer: Konva.Layer;
	/** Top-most layer for the direction control (knob + guide line) so it sits
	 * above players and every other layer while visible. */
	private controlLayer: Konva.Layer;

	private trackGeometry: KonvaTrackGeometry;
	private playerManager!: KonvaPlayerManager;
	private packManager!: KonvaPackManager;

	private watermark: Watermark;

	/** When true, replay drives the board: editing is locked and pack logic is not double-run. */
	private replayMode = false;

	/**
	 * Authored-clip playback state. Trails, focus/dim and per-step pack-zone
	 * visibility live here as runtime view state (not persisted in the doc).
	 */
	private authoredPlayback = false;
	private trailsEnabled = false;
	private trails = new Map<string, Konva.Line>();
	private focusIds: string[] | null = null;
	/**
	 * Tap-to-select for focus/dim (P3 task 9). When a callback is set, tapping
	 * an entity toggles it into the focus set (capped at 2). Cleared by the UI
	 * when focus mode is exited.
	 */
	private focusTapEnabled = false;
	private focusTapCallback: ((id: string) => void) | null = null;
	/**
	 * Pack/engagement-zone overlay visibility. Held on KonvaGame so it survives
	 * KonvaPackManager re-creation (loadState, rebuildTrackAndPlayers). Forced
	 * to true during replay/export so a hidden authored overlay can't blank a
	 * replay's EZ.
	 */
	private zoneVisible = true;
	/** Saved zoneVisible value before replay forced it to true. */
	private savedZoneVisible = true;

	/**
	 * Rotation handle for manual heading (P4 task 7). Shown only for the
	 * selected entity and hidden during playback/replay.
	 */
	private rotationHandle: Konva.Group | null = null;
	/** Reactive bridge from the selection store to the rotation handle render. */
	private selectionUnsubscribe: (() => void) | null = null;
	private directionControlUnsubscribe: (() => void) | null = null;
	/** Thin dashed guide line between the facing marker and the direction knob. */
	private directionLine: Konva.Line | null = null;
	/** Mode icons rendered on the knob (auto/relative vs locked). */
	private knobAutoMark: Konva.Text | null = null;
	private knobPinMark: Konva.Group | null = null;
	private knobLockMark: Konva.Group | null = null;

	/**
	 * Cached last sample heading map for captured-clip motion-derived heading (P4.5).
	 */
	private capturedPrevS: Map<string, number> = new Map();
	private capturedLastHeading: Map<string, number> = new Map();

	/**
	 * Resets the captured-clip heading state (called on replay start/seek-large-jump).
	 */
	private resetCapturedHeadingState(): void {
		this.capturedPrevS.clear();
		this.capturedLastHeading.clear();
	}

	/**
	 * Canonical capture dimensions for the active replay (null when not
	 * replaying, or replaying without a known source — falls back to the live
	 * viewport-center transform in that case).
	 */
	private replaySource: { w: number; h: number } | null = null;
	/** Cached uniform fit of `replaySource` into the current viewport. */
	private replayFit: CaptureFit = { scale: 1, offX: 0, offY: 0 };
	/** Last replay sample rendered; used to re-render on resize while paused. */
	private lastSample: TimelineSample | null = null;

	private gestureHandler!: KonvaGestureHandler;

	constructor(containerId: string, width: number, height: number) {
		// Initialize basic properties first
		this.width = width;
		this.height = height;

		// Initialize document store from persisted boardState (migration)
		this.initializeDocumentStore();

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
		this.trailLayer = new Konva.Layer();
		this.controlLayer = new Konva.Layer();

		// Add in correct order:
		// 1. Track surface (bottom)
		this.trackGeometry.addTrackSurfaceToLayer(this.trackSurfaceLayer);
		this.stage.add(this.trackSurfaceLayer);

		// 2. Engagement zone (middle)
		this.stage.add(this.engagementZoneLayer);

		// 3. Track lines (over engagement zone)
		this.trackGeometry.addTrackLinesToLayer(this.trackLinesLayer);
		this.stage.add(this.trackLinesLayer);

		// 4. Trails
		this.stage.add(this.trailLayer);

		// 5. Players (top)
		this.stage.add(this.playersLayer);

		// 6. Direction control (knob + guide line) — above everything.
		this.stage.add(this.controlLayer);

		// Build rotation handle (initially hidden).
		this.buildRotationHandle();

		this.playerManager = new KonvaPlayerManager(this.playersLayer);
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer
		);

		// Reactively show/hide/move the rotation handle when selection changes.
		// Without this, tapping an entity set the store but never rendered the
		// handle (the manual direction control was effectively invisible).
		this.selectionUnsubscribe = selectedEntityId.subscribe((id) => {
			this.playerManager.setSelection(id);
			this.updateRotationHandle();
		});

		// The knob + dashed line appear/disappear when direction-control mode
		// toggles (double-click to enter, single-click/canvas to exit).
		this.directionControlUnsubscribe = directionControlActive.subscribe(() => {
			this.updateRotationHandle();
		});

		// Apply the persisted direction-marker visibility on first paint.
		const markerVisible = get(boardSettings).directionMarkerVisible ?? true;
		this.playerManager.setAllHeadingVisible(markerVisible);

		// Register a single delegated handler for player interactions.
		// Registered once here (not in the managers) so it survives rebuilds and
		// always dispatches to the current playerManager/packManager instances.
		this.playersLayer.on('dragstart touchstart', (e) => {
			this.playerManager.handleDragStart(e);
		});

		this.playersLayer.on('dragmove touchmove', (e) => {
			this.playerManager.handleDragMove(e);
			if (!this.replayMode) {
				// rAF-coalesced: dragmove/touchmove can fire faster than one frame
				// (coalesced pointer events on touch), but only the latest state
				// before paint matters, so redundant calls within a frame collapse
				// into one determinePack() + one batchDraw().
				this.packManager.schedulePackUpdate();
				// Keep the direction control (knob) orbiting the dragged skater so
				// the facing marker stays pointed at it during a position move.
				const target = e.target as Konva.Node;
				if (target.hasName('playerGroup')) {
					const player = target.getAttr('player') as { id?: string } | undefined;
					if (player?.id && player.id === get(selectedEntityId)) {
						this.updateRotationHandle();
					}
				}
			}
		});

		// Handle dragend: commit the gesture to the document, then recompute
		// the pack against the now-committed (and identical) positions.
		this.playersLayer.on('dragend touchend', (e) => {
			const target = e.target as Konva.Node;
			if (target.hasName('playerGroup')) {
				const player = target.getAttr('player');
				if (player) {
					this.playerManager.handleDragEnd(player);
				}
			}
			if (!this.replayMode) {
				this.packManager.schedulePackUpdate();
			}
		});

		this.playersLayer.on('collision', (e) => {
			this.playerManager.handleCollision(e);
		});

		// Tap-to-select for focus/dim (P3 task 9): only active when the UI has armed it.
		// Tap-to-select for single-select (P4 task 6): always-on in edit/author mode,
		// disabled during replay.
		// Selection / direction-control interaction model:
		//  - single click on a skater → select it (dotted halo), direction control OFF
		//  - double click on a skater → select it AND activate the direction control
		//    (knob + dashed guide line)
		//  - click another skater → select that one, direction control OFF
		//  - click empty canvas → deselect, direction control OFF
		// Single click resolves immediately (no delay): a double-click simply
		// upgrades the just-selected skater to direction-control mode.
		const playerIdFromEvent = (e: Konva.KonvaEventObject<unknown>): string | null => {
			const target = e.target as Konva.Node;
			if (target.hasName('playerGroup') || target.getParent()?.hasName('playerGroup')) {
				const player = (target.getAttr('player') ?? target.getParent()?.getAttr('player')) as
					{ id?: string } | undefined;
				return player?.id ?? null;
			}
			return null;
		};

		this.stage.on('click tap', (e) => {
			if (this.replayMode) return;

			const id = playerIdFromEvent(e);
			if (id) {
				if (this.focusTapEnabled && this.focusTapCallback) {
					// Focus/dim mode (P3): use callback.
					this.focusTapCallback(id);
					return;
				}
				// Single-select: select the entity, direction control inactive.
				selectedEntityId.set(id);
				directionControlActive.set(false);
			} else {
				// Any non-skater click (empty canvas, track lines, …) deselects
				// entirely and exits direction mode.
				selectedEntityId.set(null);
				directionControlActive.set(false);
			}
		});

		this.stage.on('dblclick dbltap', (e) => {
			if (this.replayMode) return;
			if (this.focusTapEnabled) return; // don't interfere with focus mode
			const id = playerIdFromEvent(e);
			if (id) {
				selectedEntityId.set(id);
				directionControlActive.set(true);
			} else {
				selectedEntityId.set(null);
				directionControlActive.set(false);
			}
		});

		this.playerManager.initialLoad();
		this.packManager.determinePack();
		this.playersLayer.batchDraw();

		// Resize handling: window + visualViewport (mobile address bar / keyboard).
		// Debounced; see applyResize for the fit/restore logic.
		window.addEventListener('resize', this.handleResize);
		window.visualViewport?.addEventListener('resize', this.onVisualViewportResize);

		// Pinch-zoom (touch) + wheel-zoom (desktop), anchored at the gesture point.
		this.gestureHandler = new KonvaGestureHandler(
			this.stage,
			(point, scale) => this.zoomAt(point, scale),
			() => this.replayMode,
			() => this.updatePersistedState()
		);

		this.prevPortrait = this.isPortrait();
		this.watermark = new Watermark();

		// If the default view crops the track (e.g. small/mobile portrait), fit it.
		this.fitIfOverflowing();
	}

	destroy() {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		window.removeEventListener('resize', this.handleResize);
		window.visualViewport?.removeEventListener('resize', this.onVisualViewportResize);
		this.gestureHandler.destroy();
		this.selectionUnsubscribe?.();
		this.directionControlUnsubscribe?.();
		this.playerManager?.destroy();
		this.rotationHandle?.destroy();
		this.directionLine?.destroy();
		this.trackSurfaceLayer.destroy();
		this.trackLinesLayer.destroy();
		this.engagementZoneLayer.destroy();
		this.trailLayer.destroy();
		this.playersLayer.destroy();
		this.controlLayer.destroy();
		this.stage.destroy();
	}

	private initializeDocumentStore() {
		const currentDoc = get(boardDoc);
		if (currentDoc.entities.length === 0) {
			// Migrate from persisted boardState
			const state = get(boardState);
			if (state.teamPlayers.length > 0 || state.skatingOfficials.length > 0) {
				const doc = migrateBoardState(state);
				boardDoc.set(doc);
			}
		}
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

		if (this.replayMode) {
			// Replay drives the board. Recompute the source→viewport fit for the
			// new viewport and re-render the last sample immediately so a paused
			// replay doesn't leave a stale frame.
			if (this.replaySource) {
				this.replayFit = fitSourceToViewport(this.replaySource, {
					w: this.width,
					h: this.height
				});
				if (this.lastSample) {
					this.renderSampleTransform(this.lastSample, this.replaySource, this.replayFit);
				}
			}
			return;
		}

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
		// Clear track layers (no manager owns these; safe to wipe wholesale).
		this.trackSurfaceLayer.destroyChildren();
		this.trackLinesLayer.destroyChildren();
		this.engagementZoneLayer.destroyChildren();
		this.clearTrails();

		// Recreate track geometry with fresh points
		this.trackGeometry = new KonvaTrackGeometry(this.initializePoints());

		// Redraw track
		this.trackGeometry.addTrackSurfaceToLayer(this.trackSurfaceLayer);
		this.trackGeometry.addTrackLinesToLayer(this.trackLinesLayer);

		// Reuse the single long-lived player manager: clear the nodes it owns
		// (NOT layer.destroyChildren(), which would orphan the wrappers it still
		// tracks) and repopulate from the document. This keeps exactly one
		// boardDoc subscription alive for the whole game, eliminating the
		// duplicate-manager leak that double-rendered every player after a reset
		// and then NaN-poisoned them via the collision solver.
		this.playerManager.clear();

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
			this.engagementZoneLayer
		);
		this.applyZoneVisible();

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

	/**
	 * Zoom while keeping the world point under `viewportPoint` (a stage-space pixel)
	 * fixed in place. Used by pinch (anchored at the midpoint) and wheel (cursor).
	 * The caller persists the resulting view; this only applies the transform.
	 */
	private zoomAt(viewportPoint: { x: number; y: number }, newScale: number) {
		const s = this.stage.scaleX();
		const worldX = (viewportPoint.x - this.stage.x()) / s;
		const worldY = (viewportPoint.y - this.stage.y()) / s;
		const clamped = Math.min(Math.max(newScale, MIN_ZOOM), MAX_ZOOM);
		this.stage.scale({ x: clamped, y: clamped });
		this.stage.position({
			x: viewportPoint.x - worldX * clamped,
			y: viewportPoint.y - worldY * clamped
		});
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
		// Clear existing players (via the manager, so its tracking arrays stay
		// in sync — not layer.destroyChildren) and the engagement-zone overlay.
		this.playerManager.clear();
		this.engagementZoneLayer.destroyChildren();

		// Load view settings
		this.loadViewSettings();

		// Load players from state using the existing manager (one subscription).
		this.playerManager.initialLoad();

		// Update pack manager with the (reused) player manager
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer
		);
		this.applyZoneVisible();

		// Recalculate pack and engagement zone
		this.packManager.determinePack();

		// Redraw all layers
		this.trackSurfaceLayer.batchDraw();
		this.trackLinesLayer.batchDraw();
		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
		this.stage.batchDraw();
	}

	/** Recomputes pack/in-play/EZ (e.g. after a board-settings change). */
	refreshPack() {
		this.packManager.determinePack();
	}

	/**
	 * Re-applies the current zoneVisible state to the pack manager. Called
	 * after KonvaPackManager re-creation (loadState, rebuildTrackAndPlayers)
	 * so the overlay setting survives manager replacement.
	 */
	private applyZoneVisible() {
		this.packManager.setZoneVisible(this.zoneVisible);
	}

	resetBoard() {
		// Discard any uncommitted gesture so live poses keyed to ids that are
		// about to be replaced can never commit onto the new document.
		poseStore.abortGesture();

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
	 *
	 * When entering with a `source`, the replay is canonical: every sample is
	 * rendered through a uniform source→viewport fit so playback framing always
	 * matches the capture's proportions and boundaries, regardless of window
	 * size. Without a `source` the legacy viewport-center fallback is used.
	 */
	setReplayMode(enabled: boolean, source?: { w: number; h: number }): void {
		this.replayMode = enabled;
		this.stage.draggable(!enabled);
		this.playerManager.setPlayersDraggable(!enabled);
		if (enabled) {
			// Belt-and-braces: tear down any authoring residue (focus/dim,
			// trails, live-tier overrides) so replay starts from a clean slate
			// regardless of component lifecycle order.
			this.resetAuthoringView();
			// Force the pack/EZ overlay visible during replay so a hidden
			// authored overlay can't blank a replay's EZ.
			this.savedZoneVisible = this.zoneVisible;
			this.zoneVisible = true;
			this.applyZoneVisible();
			this.replaySource = source ?? null;
			this.replayFit =
				source !== undefined
					? fitSourceToViewport(source, { w: this.width, h: this.height })
					: { scale: 1, offX: 0, offY: 0 };
			this.lastSample = null;
			this.resetCapturedHeadingState();
		} else {
			this.replaySource = null;
			this.replayFit = { scale: 1, offX: 0, offY: 0 };
			this.lastSample = null;
			// Restore the user's zoneVisible setting.
			this.zoneVisible = this.savedZoneVisible;
			this.applyZoneVisible();
			// Clear replay overrides so they don't leak into editing.
			poseStore.clearOverrides();
			// Restore the user's board after replay.
			this.loadState();
		}
	}

	/**
	 * Captures the current board (player/official relative positions + view) as
	 * a snapshot. The caller stamps `t`. Used by TimelineRecorder for capture.
	 *
	 * Sources positions from `poseStore.effective`, the single accessor used
	 * by every consumer (renderer, pack manager, this). During a drag it
	 * transparently returns the live (in-gesture) pose — which the player
	 * manager mirrors from the Konva node on every dragmove/collision — so a
	 * recording captures the true position of every entity throughout the
	 * whole gesture, not just the dragged one's final pose.
	 */
	getSnapshot(): Snapshot {
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		const teamPlayers: Snapshot['teamPlayers'] = [];
		const skatingOfficials: Snapshot['skatingOfficials'] = [];

		for (const { entity, pose } of poseStore.effectiveAll()) {
			const meterPos = fromTrack(pose.S, pose.u);
			const relative = { x: meterPos.x * TRACK_SCALE, y: meterPos.y * TRACK_SCALE };

			if (entity.kind === 'skater') {
				teamPlayers.push({
					id: entity.id,
					relative,
					role: entity.role as TeamPlayerRole,
					team: entity.team as TeamPlayerTeam
				});
			} else {
				skatingOfficials.push({
					id: entity.id,
					relative,
					role: entity.role as SkatingOfficialRole
				});
			}
		}

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
	 * Renders one replay sample through a uniform source→viewport fit. Player /
	 * track reconciliation stays anchored at the *current* viewport center (the
	 * existing invariant — track and players are both built at the current
	 * center, so reconciliation must use the current center too). Only the stage
	 * scale/position is composed with the fit, so the frame rectangle and the
	 * board content share one transform and stay aligned.
	 *
	 * For a sample with view `{ zoom: z, relativeX: rx, relativeY: ry }`,
	 * source `{ w: sw, h: sh }`, and current viewport `{ w: vw, h: vh }`:
	 *
	 *   sCx = sw/2, sCy = sh/2   (source center, capture-space)
	 *   cCx = vw/2, cCy = vh/2   (current viewport center)
	 *   p0  = (rx*sCx, ry*sCy)   (capture stage position)
	 *   d   = (cCx - sCx, cCy - sCy)
	 *   stage.scale = fit.scale * z
	 *   stage.pos   = off + fit.scale * (p0 - z*d)
	 *
	 * This maps every capture-screen point `q` to `off + fit.scale*q` (uniform),
	 * so the fitted region rect and the board content move together. Identity
	 * check (viewport == source): fit.scale=1, off=0, d=0 ⇒ scale=z, pos=p0 ⇒
	 * exact capture.
	 */
	private renderSampleTransform(
		sample: TimelineSample,
		source: { w: number; h: number },
		fit: CaptureFit
	): void {
		// Roster / positions reconcile at the CURRENT viewport center (unchanged
		// from the legacy applySnapshot path).
		this.playerManager.reconcileTeamPlayers(sample.teamPlayers, this.width / 2, this.height / 2);
		this.playerManager.reconcileSkatingOfficials(
			sample.skatingOfficials,
			this.width / 2,
			this.height / 2
		);
		this.playerManager.setPlayersDraggable(false);
		this.playerManager.getTeamPlayers().forEach((p) => p.updateInBounds());

		const z = sample.view.zoom;
		const sCx = source.w / 2;
		const sCy = source.h / 2;
		const cCx = this.width / 2;
		const cCy = this.height / 2;
		const dx = cCx - sCx;
		const dy = cCy - sCy;

		this.stage.scale({ x: fit.scale * z, y: fit.scale * z });
		this.stage.position({
			x: fit.offX + fit.scale * (sample.view.relativeX * sCx - z * dx),
			y: fit.offY + fit.scale * (sample.view.relativeY * sCy - z * dy)
		});

		// Publish sample poses as overrides so determinePack() sees exactly
		// what is rendered, not the stale document state. Convert pixel
		// positions to track space (S, u) for the override tier.
		// Use motionHeading (P4.5) for captured clips so skaters face their motion.
		const overrides: Array<[string, { S: number; u: number; heading: number }]> = [];
		for (const tp of sample.teamPlayers) {
			if (!tp.id) continue;
			const meterPos = { x: tp.relative.x / TRACK_SCALE, y: tp.relative.y / TRACK_SCALE };
			const trackPos = toTrack(meterPos);
			const prevS = this.capturedPrevS.get(tp.id) ?? trackPos.s;
			const fallback = this.capturedLastHeading.get(tp.id) ?? 0;
			const u = trackPos.u;
			const heading = motionHeading(prevS, trackPos.s, fallback, u);
			this.capturedPrevS.set(tp.id, trackPos.s);
			this.capturedLastHeading.set(tp.id, heading);
			overrides.push([tp.id, { S: trackPos.s, u: trackPos.u, heading }]);
		}
		for (const so of sample.skatingOfficials) {
			if (!so.id) continue;
			const meterPos = { x: so.relative.x / TRACK_SCALE, y: so.relative.y / TRACK_SCALE };
			const trackPos = toTrack(meterPos);
			const prevS = this.capturedPrevS.get(so.id) ?? trackPos.s;
			const fallback = this.capturedLastHeading.get(so.id) ?? 0;
			const u = trackPos.u;
			const heading = motionHeading(prevS, trackPos.s, fallback, u);
			this.capturedPrevS.set(so.id, trackPos.s);
			this.capturedLastHeading.set(so.id, heading);
			overrides.push([so.id, { S: trackPos.s, u: trackPos.u, heading }]);
		}
		poseStore.setOverrides(overrides);

		this.packManager.determinePack();
		this.trackSurfaceLayer.batchDraw();
		this.trackLinesLayer.batchDraw();
		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();
	}

	/**
	 * Reconciles the board to a sample (roster by id, positions, view) and redraws
	 * the pack/engagement zone. Used by TimelinePlayer for replay.
	 *
	 * In canonical replay (a `source` was supplied to `setReplayMode`), renders
	 * through the uniform source→viewport fit. Otherwise falls back to the
	 * legacy viewport-center transform for any non-replay caller.
	 */
	applySnapshot(sample: TimelineSample): void {
		const wasReplaying = this.replayMode;
		this.replayMode = true;
		try {
			if (this.replaySource) {
				this.renderSampleTransform(sample, this.replaySource, this.replayFit);
			} else {
				const centerX = this.width / 2;
				const centerY = this.height / 2;

				this.playerManager.reconcileTeamPlayers(sample.teamPlayers, centerX, centerY);
				this.playerManager.reconcileSkatingOfficials(sample.skatingOfficials, centerX, centerY);
				this.playerManager.setPlayersDraggable(false);
				this.playerManager.getTeamPlayers().forEach((p) => p.updateInBounds());

				this.stage.scale({ x: sample.view.zoom, y: sample.view.zoom });
				this.stage.position({
					x: sample.view.relativeX * centerX,
					y: sample.view.relativeY * centerY
				});

				// Publish sample poses as overrides so determinePack() sees exactly
				// what is rendered, not the stale document state.
				// Use motionHeading (P4.5) for captured clips so skaters face their motion.
				const overrides: Array<[string, { S: number; u: number; heading: number }]> = [];
				for (const tp of sample.teamPlayers) {
					if (!tp.id) continue;
					const meterPos = { x: tp.relative.x / TRACK_SCALE, y: tp.relative.y / TRACK_SCALE };
					const trackPos = toTrack(meterPos);
					const prevS = this.capturedPrevS.get(tp.id) ?? trackPos.s;
					const fallback = this.capturedLastHeading.get(tp.id) ?? 0;
					const u = trackPos.u;
					const heading = motionHeading(prevS, trackPos.s, fallback, u);
					this.capturedPrevS.set(tp.id, trackPos.s);
					this.capturedLastHeading.set(tp.id, heading);
					overrides.push([tp.id, { S: trackPos.s, u: trackPos.u, heading }]);
				}
				for (const so of sample.skatingOfficials) {
					if (!so.id) continue;
					const meterPos = { x: so.relative.x / TRACK_SCALE, y: so.relative.y / TRACK_SCALE };
					const trackPos = toTrack(meterPos);
					const prevS = this.capturedPrevS.get(so.id) ?? trackPos.s;
					const fallback = this.capturedLastHeading.get(so.id) ?? 0;
					const u = trackPos.u;
					const heading = motionHeading(prevS, trackPos.s, fallback, u);
					this.capturedPrevS.set(so.id, trackPos.s);
					this.capturedLastHeading.set(so.id, heading);
					overrides.push([so.id, { S: trackPos.s, u: trackPos.u, heading }]);
				}
				poseStore.setOverrides(overrides);

				this.packManager.determinePack();
				this.trackSurfaceLayer.batchDraw();
				this.trackLinesLayer.batchDraw();
				this.engagementZoneLayer.batchDraw();
				this.playersLayer.batchDraw();
			}
			this.lastSample = sample;
		} finally {
			this.replayMode = wasReplaying;
		}
	}

	/**
	 * Renders a sample in pure source space (identity fit: scale=1, off=0) so the
	 * export crop is capture-canonical regardless of the live window. Used by the
	 * mp4/png exporter, which stages the board at source dims before cropping.
	 * Forces the pack/EZ overlay visible during export so a hidden authored
	 * overlay can't blank the exported EZ.
	 */
	applySnapshotCanonical(sample: TimelineSample, source: { w: number; h: number }): void {
		const wasReplaying = this.replayMode;
		const wasZoneVisible = this.zoneVisible;
		this.replayMode = true;
		this.zoneVisible = true;
		this.applyZoneVisible();
		try {
			this.renderSampleTransform(sample, source, { scale: 1, offX: 0, offY: 0 });
		} finally {
			this.replayMode = wasReplaying;
			this.zoneVisible = wasZoneVisible;
			this.applyZoneVisible();
		}
	}

	// ------------------------------------------------------------------------- //
	// Authored-clip playback (P3)
	// ------------------------------------------------------------------------- //
	// Authored playback drives every entity's pose through the PoseStore LIVE
	// tier each frame (the same tier a drag uses), then reprojects the nodes.
	// This reuses the single `poseStore.effective` accessor that pack/in-bounds/
	// snapshot already read, so tweened positions are consistent everywhere —
	// no separate "playback" code path that can drift from editing.

	/** Enters authored playback: locks entity dragging, resets trails. */
	beginAuthoredPlayback(): void {
		this.authoredPlayback = true;
		this.playerManager.setPlayersDraggable(false);
		this.clearTrails();
	}

	/** Exits authored playback: clears transient live poses, restores dragging. */
	endAuthoredPlayback(): void {
		this.authoredPlayback = false;
		poseStore.abortGesture();
		this.playerManager.setPlayersDraggable(true);
		this.clearTrails();
		this.updateRotationHandle();
	}

	isAuthoredPlayback(): boolean {
		return this.authoredPlayback;
	}

	/**
	 * Resets all authoring-view state (focus/dim, trails, live-tier, authored
	 * playback flag) without restoring dragging. Called defensively on replay
	 * entry and board reset so the invariant "no authoring residue survives
	 * into replay or editing" does not depend on component lifecycle order.
	 */
	resetAuthoringView(): void {
		this.authoredPlayback = false;
		poseStore.abortGesture();
		poseStore.clearOverrides();
		this.clearTrails();
		this.focusIds = null;
		this.focusTapEnabled = false;
		this.focusTapCallback = null;
		this.playerManager.setFocus(null);
		selectedEntityId.set(null);
		directionControlActive.set(false);
		this.updateRotationHandle();
	}

	/**
	 * Renders one frame of tweened entity poses during authored playback.
	 * Writes the poses into the PoseStore live tier, reprojects nodes, recomputes
	 * the pack/zone, and appends a motion-trail sample per entity.
	 */
	applyAuthoredPoses(poses: EntityPose[]): void {
		for (const pose of poses) {
			poseStore.setLive(pose.id, { S: pose.S, u: pose.u, heading: pose.heading });
		}
		this.playerManager.applyEffectivePoses();
		this.packManager.determinePack();
		if (this.trailsEnabled) this.pushTrails(poses);
		this.updateRotationHandle();
		this.engagementZoneLayer.batchDraw();
		this.trailLayer.batchDraw();
		this.playersLayer.batchDraw();
	}

	/**
	 * Tweens from current board poses to target poses over the specified duration.
	 * Uses requestAnimationFrame for smooth animation with easing.
	 * Cancellable: a new tween cancels any in-flight tween. On completion,
	 * clears the live tier and reconciles to the document so no uncommitted
	 * poses survive to corrupt subsequent navigation or recordings.
	 */
	private tweenRafId: number | null = null;
	tweenToStep(targetPoses: EntityPose[], durationMs: number = 300, onComplete?: () => void): void {
		// Cancel any in-flight tween so only one runs at a time.
		if (this.tweenRafId !== null) {
			cancelAnimationFrame(this.tweenRafId);
			this.tweenRafId = null;
		}

		const currentPoses: EntityPose[] = poseStore.effectiveAll().map(({ entity, pose }) => ({
			id: entity.id,
			S: pose.S,
			u: pose.u,
			heading: pose.heading
		}));

		const startTime = performance.now();

		const animate = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / durationMs, 1);
			const easedProgress = easeInOutCubic(progress);

			const interpolatedPoses = tweenSteps(currentPoses, targetPoses, easedProgress);
			this.applyAuthoredPoses(interpolatedPoses);

			if (progress < 1) {
				this.tweenRafId = requestAnimationFrame(animate);
			} else {
				// Tween complete: clear live tier and reconcile to document.
				this.tweenRafId = null;
				poseStore.abortGesture();
				this.playerManager.renderFromDocument();
				onComplete?.();
			}
		};

		this.tweenRafId = requestAnimationFrame(animate);
	}

	/** Enables/disables the fading motion-trail tail during playback. */
	setTrailsEnabled(enabled: boolean): void {
		this.trailsEnabled = enabled;
		if (!enabled) this.clearTrails();
	}

	/** Focus/dim: dims every entity not in `ids`; null clears it. */
	setFocus(ids: string[] | null): void {
		this.focusIds = ids;
		this.playerManager.setFocus(ids);
	}

	/** Sets the active step's pack/zone overlay visibility and recomputes. */
	setPackZoneVisible(visible: boolean): void {
		this.zoneVisible = visible;
		this.packManager.setZoneVisible(visible);
		this.packManager.determinePack();
	}

	/** Arms tap-to-select for focus/dim with the given toggle callback. */
	setFocusTap(enabled: boolean, callback: ((id: string) => void) | null): void {
		this.focusTapEnabled = enabled;
		this.focusTapCallback = callback;
		if (!enabled) this.setFocus(null);
	}

	private centerPx(): { x: number; y: number } {
		return { x: this.width / 2, y: this.height / 2 };
	}

	private trailColorFor(id: string): string {
		const entity = boardDoc.current.entities.find((e) => e.id === id);
		if (entity?.team === 'A') return colors.teamAPrimary;
		if (entity?.team === 'B') return colors.teamBPrimary;
		return colors.officialSecondary;
	}

	/** Appends the current projected position of each entity to its trail. */
	private pushTrails(poses: EntityPose[]): void {
		const center = this.centerPx();
		const zoom = this.stage.scaleX();
		for (const pose of poses) {
			const meter = fromTrack(pose.S, pose.u);
			const x = center.x + meter.x * TRACK_SCALE;
			const y = center.y + meter.y * TRACK_SCALE;
			let line = this.trails.get(pose.id);
			if (!line) {
				line = new Konva.Line({
					points: [x, y],
					stroke: this.trailColorFor(pose.id),
					strokeWidth: Math.max(1.5, (PLAYER_RADIUS * 0.35) / zoom),
					opacity: 0.5,
					lineCap: 'round',
					lineJoin: 'round',
					listening: false
				});
				this.trailLayer.add(line);
				this.trails.set(pose.id, line);
			}
			const pts = line.points();
			pts.push(x, y);
			while (pts.length > TRAIL_MAX_POINTS * 2) pts.splice(0, 2);
			line.points(pts);
			line.strokeWidth(Math.max(1.5, (PLAYER_RADIUS * 0.35) / zoom));
		}
	}

	/** Removes all trail polylines (e.g. on playback start/stop or board rebuild). */
	private clearTrails(): void {
		this.trails.clear();
		this.trailLayer.destroyChildren();
		this.trailLayer.batchDraw();
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

	/**
	 * Builds the rotation handle for manual heading (P4 task 7).
	 * A standalone draggable knob positioned at `center + R·(cos h, sin h)`
	 * over the selected entity. Not a child of the playerGroup so rotation
	 * never moves the entity.
	 */
	private buildRotationHandle(): void {
		const handleRadius = 12;
		const handleStroke = 3;

		// Thin dashed guide line between the facing marker (on the skater rim)
		// and the knob. Drawn under the knob; always shown alongside the control.
		this.directionLine = new Konva.Line({
			points: [0, 0, 0, 0],
			stroke: colors.outOfBounds,
			strokeWidth: 1,
			dash: [4, 3],
			lineCap: 'round',
			visible: false,
			listening: false,
			perfectDrawEnabled: false
		});
		this.controlLayer.add(this.directionLine);

		this.rotationHandle = new Konva.Group({
			visible: false,
			draggable: true,
			listening: true,
			name: 'rotationHandle'
		});
		this.rotationHandle.add(
			new Konva.Circle({
				radius: handleRadius,
				stroke: colors.outOfBounds,
				strokeWidth: handleStroke,
				fill: 'white',
				listening: true,
				perfectDrawEnabled: false
			})
		);

		// Mode icons centred on the knob, one per direction-control mode:
		//  - "A"      → automatic / relative (offset from the track tangent)
		//  - pin      → pinned (face a fixed map point)
		//  - padlock  → fixed (absolute heading frozen on the canvas)
		const knobAutoMark = new Konva.Text({
			text: 'A',
			fontSize: 12,
			fontStyle: 'bold',
			fill: colors.outOfBounds,
			x: -4,
			y: -7,
			listening: false,
			perfectDrawEnabled: false
		});
		const knobPinMark = new Konva.Group({ visible: false, listening: false });
		knobPinMark.add(
			new Konva.Path({
				// Teardrop body pointing down.
				data: 'M 0 -4.5 C 3 -4.5 3 0.5 0 4 C -3 0.5 -3 -4.5 0 -4.5 Z',
				fill: colors.outOfBounds,
				listening: false,
				perfectDrawEnabled: false
			})
		);
		knobPinMark.add(
			new Konva.Circle({
				x: 0,
				y: -2,
				radius: 1.2,
				fill: 'white',
				listening: false,
				perfectDrawEnabled: false
			})
		);
		const knobLockMark = new Konva.Group({ visible: false, listening: false });
		knobLockMark.add(
			new Konva.Arc({
				x: 0,
				y: -2,
				innerRadius: 2,
				outerRadius: 3.4,
				angle: 180,
				rotation: 180,
				fill: colors.outOfBounds,
				perfectDrawEnabled: false
			})
		);
		knobLockMark.add(
			new Konva.Rect({
				x: -3.5,
				y: -1,
				width: 7,
				height: 6,
				fill: colors.outOfBounds,
				cornerRadius: 1,
				perfectDrawEnabled: false
			})
		);
		this.rotationHandle.add(knobAutoMark);
		this.rotationHandle.add(knobPinMark);
		this.rotationHandle.add(knobLockMark);
		this.knobAutoMark = knobAutoMark;
		this.knobPinMark = knobPinMark;
		this.knobLockMark = knobLockMark;

		// A bare click/tap on the knob must NOT bubble to the stage (which would
		// read it as an empty-canvas click and deselect).
		this.rotationHandle.on('click tap', (e) => {
			e.cancelBubble = true;
		});

		// Double-click the control cycles through the three modes
		// (relative → pinned → fixed → relative). See cycleDirectionMode.
		this.rotationHandle.on('dblclick dbltap', (e) => {
			e.cancelBubble = true;
			this.cycleDirectionMode();
		});

		// Drag handler: the knob follows the pointer freely and the skater's
		// facing points from the skater toward the knob. Dragging does NOT change
		// the mode (locked stays locked — it relocates the look-at point;
		// automatic stays automatic — it sets a relative delta). The mode icon
		// therefore stays as-is. Status is toggled only by double-click.
		this.rotationHandle.on('dragmove', () => {
			const selectedId = get(selectedEntityId);
			if (!selectedId || !this.rotationHandle) return;

			const pose = poseStore.effective(selectedId);
			if (!pose) return;

			const center = this.getStageCenter();
			const meterPos = fromTrack(pose.S, pose.u);
			const cx = center.x + meterPos.x * TRACK_SCALE;
			const cy = center.y + meterPos.y * TRACK_SCALE;

			// Use the knob's own (freely dragged) position rather than the raw
			// pointer, so the heading reflects where the knob actually is.
			const kx = this.rotationHandle.x();
			const ky = this.rotationHandle.y();
			const dx = kx - cx;
			const dy = ky - cy;
			const heading = Math.atan2(dy, dx); // y-down screen, clockwise-positive

			poseStore.setLive(selectedId, { heading });
			// Point the chevron at the knob immediately (reconcile doesn't fire
			// mid-gesture).
			this.playerManager.setHeadingFor(selectedId, heading);
			// Keep the guide line anchored to the rim point facing the knob.
			this.updateDirectionLine(cx, cy, heading, kx, ky);
		});

		// Drag-end: commit the new facing WITHOUT changing the mode (status is
		// toggled only by double-clicking the control). In locked mode the drag
		// relocates the look-at point; otherwise it sets a relative delta.
		this.rotationHandle.on('dragend', () => {
			const selectedId = get(selectedEntityId);
			if (!selectedId || !this.rotationHandle) return;
			const entity = boardDoc.current.entities.find((e) => e.id === selectedId);
			const pose = poseStore.effective(selectedId);
			if (!pose) return;
			const center = this.getStageCenter();
			const kx = this.rotationHandle.x();
			const ky = this.rotationHandle.y();
			const angle = Math.atan2(
				ky - (center.y + fromTrack(pose.S, pose.u).y * TRACK_SCALE),
				kx - (center.x + fromTrack(pose.S, pose.u).x * TRACK_SCALE)
			);
			const mode = entity?.headingMode;
			if (mode === 'pinned') {
				// Dragging in pinned mode relocates the look-at map point.
				const lookAt = { x: (kx - center.x) / TRACK_SCALE, y: (ky - center.y) / TRACK_SCALE };
				poseStore.commitGesture('Move look-at', { headingMode: 'pinned', lookAt });
			} else if (mode === 'fixed') {
				// Dragging in fixed mode rotates the frozen absolute heading
				// (already written to the live tier as `heading`).
				poseStore.commitGesture('Rotate', { headingMode: 'fixed' });
			} else {
				// Automatic/relative: store the rotation as an offset from tangent.
				const t = tangentAt(pose.S);
				const delta = normalizeAngle(angle - Math.atan2(t.y, t.x));
				poseStore.commitGesture('Rotate', { headingMode: 'relative', headingDelta: delta });
			}
			this.updateRotationHandle();
		});

		this.controlLayer.add(this.rotationHandle);
	}

	/**
	 * Cycles the selected entity's direction-control mode on each double-click:
	 * relative (auto) → pinned (face a map point) → fixed (frozen absolute
	 * heading) → relative. Each transition preserves the current facing where
	 * possible so the chevron does not jump.
	 */
	private cycleDirectionMode(): void {
		const selectedId = get(selectedEntityId);
		if (!selectedId || !this.rotationHandle) return;
		const entity = boardDoc.current.entities.find((e) => e.id === selectedId);
		const pose = poseStore.effective(selectedId);
		if (!entity || !pose || !this.rotationHandle) return;

		const center = this.getStageCenter();
		const heading = this.playerManager.resolvedHeadingFor(selectedId) ?? pose.heading;
		// Seed the live tier so commitGesture has something to write.
		poseStore.setLive(selectedId, { heading });

		const current: HeadingMode = entity.headingMode ?? 'relative';
		const next: HeadingMode =
			current === 'relative' ? 'pinned' : current === 'pinned' ? 'fixed' : 'relative';

		if (next === 'pinned') {
			// Pin: capture the knob's current world position as the look-at point.
			const kx = this.rotationHandle.x();
			const ky = this.rotationHandle.y();
			const lookAt = { x: (kx - center.x) / TRACK_SCALE, y: (ky - center.y) / TRACK_SCALE };
			poseStore.commitGesture('Pin direction', { headingMode: 'pinned', lookAt });
		} else if (next === 'fixed') {
			// Fixed: freeze the current facing as an absolute world angle.
			poseStore.commitGesture('Lock direction', { headingMode: 'fixed' });
		} else {
			// Relative: keep the current facing as an offset from the tangent.
			const t = tangentAt(pose.S);
			const delta = normalizeAngle(heading - Math.atan2(t.y, t.x));
			poseStore.commitGesture('Auto direction', { headingMode: 'relative', headingDelta: delta });
		}
		this.updateRotationHandle();
	}

	/** Shows the icon on the knob matching the active mode. */
	private setKnobMode(mode: HeadingMode): void {
		this.knobAutoMark?.visible(mode === 'relative');
		this.knobPinMark?.visible(mode === 'pinned');
		this.knobLockMark?.visible(mode === 'fixed');
	}

	/**
	 * Repositions (and shows) the dashed guide line from the skater's facing
	 * rim point toward the knob position. `heading` is the angle from the
	 * skater to the knob.
	 */
	private updateDirectionLine(
		cx: number,
		cy: number,
		heading: number,
		knobX: number,
		knobY: number
	): void {
		if (!this.directionLine) return;
		const rimX = cx + PLAYER_RADIUS * Math.cos(heading);
		const rimY = cy + PLAYER_RADIUS * Math.sin(heading);
		this.directionLine.points([rimX, rimY, knobX, knobY]);
		this.directionLine.visible(true);
	}

	/**
	 * Updates the rotation handle position to follow the selected entity. The
	 * knob and dashed guide line are shown only while the direction control is
	 * active (double-click). Called on selection/activation changes and
	 * playback ticks.
	 */
	updateRotationHandle(): void {
		const selectedId = get(selectedEntityId);
		const active = get(directionControlActive);
		if (!selectedId || this.replayMode || !active) {
			this.rotationHandle?.visible(false);
			this.directionLine?.visible(false);
			return;
		}

		const entity = boardDoc.current.entities.find((e) => e.id === selectedId);
		const pose = poseStore.effective(selectedId);
		if (!entity || !pose) {
			this.rotationHandle?.visible(false);
			this.directionLine?.visible(false);
			return;
		}

		const center = this.getStageCenter();
		const meterPos = fromTrack(pose.S, pose.u);
		const cx = center.x + meterPos.x * TRACK_SCALE;
		const cy = center.y + meterPos.y * TRACK_SCALE;

		const mode: HeadingMode = entity.headingMode ?? 'relative';
		const pinned = mode === 'pinned' && !!entity.lookAt;
		let hx: number;
		let hy: number;
		let heading: number;
		if (pinned) {
			// Knob sits on the fixed look-at map point; skater faces toward it.
			hx = center.x + entity.lookAt!.x * TRACK_SCALE;
			hy = center.y + entity.lookAt!.y * TRACK_SCALE;
			heading = Math.atan2(entity.lookAt!.y - meterPos.y, entity.lookAt!.x - meterPos.x);
		} else {
			// Relative/fixed/auto: knob orbits the skater along the resolved
			// facing (tangent+delta, or the frozen absolute angle).
			heading = this.playerManager.resolvedHeadingFor(selectedId) ?? pose.heading;
			const handleOffset = PLAYER_RADIUS * 4;
			hx = cx + handleOffset * Math.cos(heading);
			hy = cy + handleOffset * Math.sin(heading);
		}

		this.rotationHandle?.position({ x: hx, y: hy });
		this.rotationHandle?.visible(true);
		this.setKnobMode(mode);
		this.updateDirectionLine(cx, cy, heading, hx, hy);
		this.controlLayer.batchDraw();
	}

	/**
	 * Re-applies every entity's resolved heading. Used when the auto-face
	 * setting flips so existing chevrons immediately switch to/from the track
	 * tangent without waiting for a document change.
	 */
	refreshHeadings(): void {
		this.playerManager.renderFromDocument();
		this.updateRotationHandle();
	}

	/**
	 * Toggles the facing marker (brace) visibility on every entity.
	 */
	setDirectionMarkerVisible(visible: boolean): void {
		boardSettings.update((s) => ({ ...s, directionMarkerVisible: visible }));
		this.playerManager.setAllHeadingVisible(visible);
	}

	/**
	 * Gets the stage center point (offset by track centering).
	 */
	private getStageCenter(): { x: number; y: number } {
		return { x: this.width / 2, y: this.height / 2 };
	}

	/**
	 * Returns HUD data (screen position + label) for the currently selected
	 * entity, or null when nothing is selected. The screen position accounts
	 * for the current stage pan/zoom so a DOM overlay can track the entity.
	 * Called every frame by the HUD overlay component via rAF.
	 */
	getEntityHudData(): {
		screenX: number;
		screenY: number;
		label: string;
	} | null {
		const selectedId = get(selectedEntityId);
		if (!selectedId) return null;
		const entity = boardDoc.current.entities.find((e) => e.id === selectedId);
		const pose = poseStore.effective(selectedId);
		if (!entity || !pose) return null;

		const center = this.getStageCenter();
		const meterPos = fromTrack(pose.S, pose.u);
		const scale = this.stage.scaleX();
		const localX = center.x + meterPos.x * TRACK_SCALE;
		const localY = center.y + meterPos.y * TRACK_SCALE;

		return {
			screenX: this.stage.x() + localX * scale,
			screenY: this.stage.y() + localY * scale,
			label: hudLabel(entity)
		};
	}
}

const ROLE_LABELS: Record<string, string> = {
	jammer: 'Jammer',
	blocker: 'Blocker',
	pivot: 'Pivot',
	jamRefA: 'Jam Ref A',
	jamRefB: 'Jam Ref B',
	backPackRef: 'Back Pack Ref',
	frontPackRef: 'Front Pack Ref',
	outsidePackRef: 'Outside Pack Ref',
	alternate: 'Alternate'
};

function hudLabel(entity: Entity): string {
	if (entity.kind === 'skater' && entity.team) {
		return `${entity.team} ${ROLE_LABELS[entity.role] ?? entity.role}`;
	}
	return ROLE_LABELS[entity.role] ?? entity.role;
}
