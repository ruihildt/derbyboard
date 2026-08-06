import { get } from 'svelte/store';
import Konva from 'konva';

import { boardState } from '$lib/stores/konvaBoardState';
import {
	selectedEntityId,
	selectedAnnotationId,
	directionControlActive
} from '$lib/stores/selection';
import { boardSettings } from '$lib/stores/boardSettings';
import { authoringSession } from '$lib/stores/session';
import { toolMode } from '$lib/stores/toolMode';
import { interaction } from '$lib/stores/interaction';
import {
	BASE_ZOOM,
	CENTER_POINT_OFFSET,
	OUTER_VERTICAL_OFFSET_1,
	OUTER_VERTICAL_OFFSET_2,
	VERTICAL_OFFSET_1,
	VERTICAL_OFFSET_2,
	TRACK_SCALE
} from '$lib/constants';

import { KonvaTrackGeometry, type Point } from './KonvaTrackGeometry';
import { KonvaPlayerManager } from './KonvaPlayerManager';
import { KonvaPackManager } from './KonvaPackManager';
import { KonvaRecorder } from './KonvaRecorder';
import { KonvaGestureHandler } from './KonvaGestureHandler';
import { Watermark, type WatermarkSize } from './Watermark';
import { BoardExporter } from './export/BoardExporter';
import { ReplayController } from './replay/ReplayController';
import { ViewportController } from './view/ViewportController';
import { AuthoredPlaybackController } from './playback/AuthoredPlaybackController';
import { BoardProjection } from './paths/projection';
import { PathRenderer } from './paths/PathRenderer';
import { PathEditor } from './paths/PathEditor';
import { TrailRenderer } from './trails/TrailRenderer';
import { OnionSkinRenderer } from './onion/OnionSkinRenderer';
import { type CaptureZone } from '$lib/utils/capture';
import type { Snapshot, TimelineSample } from '$lib/recording/timeline/types';
import { boardDoc } from '$lib/doc/store';
import { poseStore } from '$lib/doc/poses';
import { migrateBoardState } from '$lib/doc/migrate';
import type { EntityPose, Step, PlanarPoint } from '$lib/doc/types';
import type { PathFrame } from '$lib/recording/timeline/types';
import { AnnotationRenderer } from './annotations/AnnotationRenderer';
import { AnnotationGestures } from './annotations/AnnotationGestures';
import { RotationHandleController } from './heading/RotationHandleController';
import { DrawingToolController } from './tools/DrawingToolController';
import { LabelEditorController } from './tools/LabelEditorController';
import { SelectionController } from './tools/SelectionController';
import type { TeamPlayerRole, TeamPlayerTeam } from './KonvaTeamPlayer';
import type { SkatingOfficialRole } from './KonvaSkatingOfficial';

export class KonvaGame {
	/** Canvas dimensions are owned by the ViewportController; these accessors
	 * keep the many internal readers (projection, replay fit, snapshot) terse. */
	private get width(): number {
		return this.viewport.size.width;
	}
	private get height(): number {
		return this.viewport.size.height;
	}

	private stage: Konva.Stage;
	private trackSurfaceLayer: Konva.Layer;
	private trackLinesLayer: Konva.Layer;
	private playersLayer: Konva.Layer;
	private engagementZoneLayer: Konva.Layer;
	/** Fading team-coloured tails behind entities during authored playback. */
	private trailLayer: Konva.Layer;
	/** Movement paths + path-overlay arrows */
	private pathLayer: Konva.Layer;
	/** Onion-skin ghosts of neighbouring steps */
	private ghostLayer: Konva.Layer;
	/** Freehand pen / arrow / zone / label / gap annotations */
	private annotationLayer: Konva.Layer;
	/** Top-most layer for the direction control (knob + guide line) so it sits
	 * above players and every other layer while visible. */
	private controlLayer: Konva.Layer;

	private trackGeometry: KonvaTrackGeometry;
	private playerManager!: KonvaPlayerManager;
	private packManager!: KonvaPackManager;

	/** Shared stage↔planar coordinate conversion (paths/annotations/ghosts/trails). */
	private projection!: BoardProjection;
	private trailRenderer!: TrailRenderer;
	private onionSkinRenderer!: OnionSkinRenderer;
	private annotationRenderer!: AnnotationRenderer;
	private annotationGestures!: AnnotationGestures;
	private pathRenderer!: PathRenderer;
	private pathEditor!: PathEditor;
	private rotationHandleController!: RotationHandleController;
	private drawingTools!: DrawingToolController;
	private labelEditor!: LabelEditorController;
	private selectionController!: SelectionController;

	private exporter!: BoardExporter;
	private replay!: ReplayController;
	private viewport!: ViewportController;
	private authored!: AuthoredPlaybackController;

	/** Focus/dim set (P3); null when every entity is fully opaque. */
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

	/** Reactive bridge from the selection store to the rotation handle render. */
	private selectionUnsubscribe: (() => void) | null = null;
	/** Reactive bridge from the annotation selection store to the ring render. */
	private annotationSelectionUnsubscribe: (() => void) | null = null;
	private directionControlUnsubscribe: (() => void) | null = null;

	/** Drawing handler for annotation/path gestures */
	private interactionUnsubscribe: (() => void) | null = null;

	/** Reactive bridge: re-render annotations (and show/hide the selection box)
	 * when the active tool changes. */
	private toolModeUnsubscribe: (() => void) | null = null;

	/** Reactive bridge: re-render step overlays (paths, annotations, onion
	 * skin) when the document changes via undo/redo. Explicit edits already
	 * call renderStepOverlays, but undo/redo only swap the doc — without this
	 * subscription the visual layers would stay stale after an undo. */
	private docUnsubscribe: (() => void) | null = null;

	/** Reactive bridge: rebuild the selection chrome when the viewport zoom
	 * changes (zoom buttons, reset, fit-to-track) so its stroke/handle sizes
	 * stay constant on screen. Live wheel/pinch zoom is covered separately via
	 * the gesture handler's zoom callback. */
	private zoomUnsubscribe: (() => void) | null = null;
	private lastZoom = 1;

	private gestureHandler!: KonvaGestureHandler;

	constructor(containerId: string, width: number, height: number) {
		// Initialize document store from persisted boardState (migration)
		this.initializeDocumentStore();

		// This shouldn't be needed, since it's the default
		// But I feel a slight delay without it
		Konva.dragDistance = 0;

		// Create main stage
		this.stage = new Konva.Stage({
			container: containerId,
			width,
			height,
			draggable: true,
			pixelRatio: window.devicePixelRatio
		});

		// Viewport: canvas dimensions, zoom/pan, persisted view, resize handling.
		this.viewport = new ViewportController(this.stage, width, height, {
			isReplayMode: () => this.replay.isActive(),
			getPlayerManager: () => this.playerManager,
			onRebuild: () => this.rebuildTrackAndPlayers(),
			onOverlaysChanged: () => this.renderStepOverlays(this.getActiveStep(), get(selectedEntityId)),
			onReplayResize: () => this.replay.handleResize()
		});

		// Add dragend listener for position persistence
		this.stage.on('dragend', () => {
			this.viewport.updatePersistedState();
		});

		// Apply persisted view settings
		this.viewport.loadViewSettings();

		// Create track geometry (depends on points)
		this.trackGeometry = new KonvaTrackGeometry(this.initializePoints());

		// Create a separate layer for track lines
		this.trackSurfaceLayer = new Konva.Layer();
		this.trackLinesLayer = new Konva.Layer();
		this.engagementZoneLayer = new Konva.Layer();
		this.pathLayer = new Konva.Layer();
		this.trailLayer = new Konva.Layer();
		this.ghostLayer = new Konva.Layer();
		this.playersLayer = new Konva.Layer();
		this.annotationLayer = new Konva.Layer();
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

		// 4. Path layer (paths sit on the track, under trails/ghosts/players)
		this.stage.add(this.pathLayer);

		// 5. Trails
		this.stage.add(this.trailLayer);

		// 6. Ghost layer (translucent ghosts under live players)
		this.stage.add(this.ghostLayer);

		// 7. Players (top)
		this.stage.add(this.playersLayer);

		// 8. Annotation layer (annotations read on top of skaters)
		this.stage.add(this.annotationLayer);

		// 9. Direction control (knob + guide line) — above everything.
		this.stage.add(this.controlLayer);

		// Shared collaborators: projection (stage↔planar), trails, onion skin.
		this.projection = new BoardProjection(this.stage, () => ({
			width: this.width,
			height: this.height
		}));
		this.trailRenderer = new TrailRenderer(this.trailLayer, this.projection, () =>
			this.stage.scaleX()
		);
		this.onionSkinRenderer = new OnionSkinRenderer(this.ghostLayer, this.projection);
		this.annotationRenderer = new AnnotationRenderer(
			this.annotationLayer,
			this.controlLayer,
			this.stage,
			this.projection
		);
		this.annotationGestures = new AnnotationGestures(
			this.stage,
			this.projection,
			this.annotationRenderer,
			() => this.renderAnnotations(this.getActiveStep())
		);
		this.annotationRenderer.onGestureStart = (type, ann, e, su, sv) =>
			this.annotationGestures.start(type, ann, e, su, sv);
		this.annotationGestures.onEditLabel = (ann, click) => this.labelEditor.editExisting(ann, click);
		this.pathRenderer = new PathRenderer(
			this.pathLayer,
			this.controlLayer,
			this.stage,
			this.projection,
			() => this.replay.isActive()
		);
		this.pathEditor = new PathEditor(this.pathRenderer, this.projection, {
			getActiveStep: () => this.getActiveStep(),
			getAdjacentSteps: () => this.getAdjacentSteps()
		});
		this.pathRenderer.onDragMove = (step, path) => this.pathEditor.updatePreview(step, path);
		this.pathRenderer.onDragEnd = (step, path) => this.pathEditor.commitChanges(step, path);

		// Drawing tools (pen/arrow/zone/gap/label/drawPath) and tap selection.
		// The controllers register their own stage handlers (pointerdown,
		// click/tap, dblclick); pointermove/pointerup stay combined below so
		// an active annotation gesture always wins over drawing.
		this.drawingTools = new DrawingToolController({
			stage: this.stage,
			projection: this.projection,
			pathLayer: this.pathLayer,
			annotationLayer: this.annotationLayer,
			getActiveStep: () => this.getActiveStep(),
			onAfterCommit: (step) => this.renderStepOverlays(step, get(selectedEntityId))
		});
		this.drawingTools.attach();
		// Inline label editor: the label tool delegates placement to it (direct
		// on-canvas typing instead of a prompt box). Wired after the drawing
		// tools so they can hand label taps to it.
		this.labelEditor = new LabelEditorController({
			stage: this.stage,
			projection: this.projection,
			annotationLayer: this.annotationLayer,
			onCommitted: () => this.renderAnnotations(this.getActiveStep())
		});
		this.labelEditor.attach();
		this.drawingTools.setLabelEditor(this.labelEditor);
		this.selectionController = new SelectionController({
			stage: this.stage,
			isReplayMode: () => this.replay.isActive(),
			consumeClickSuppression: () => this.annotationGestures.consumeClickSuppression(),
			focusTap: {
				isArmed: () => this.focusTapEnabled,
				hasCallback: () => this.focusTapCallback !== null,
				notify: (id) => this.focusTapCallback?.(id)
			},
			getActiveStep: () => this.getActiveStep(),
			getAdjacentSteps: () => this.getAdjacentSteps(),
			renderAnnotations: (step) => this.renderAnnotations(step),
			renderPaths: (step, sel, prev, next) => this.renderPaths(step, sel, prev, next)
		});
		this.selectionController.attach();

		this.playerManager = new KonvaPlayerManager(this.playersLayer);
		this.packManager = new KonvaPackManager(
			this.playerManager,
			this.playersLayer,
			this.engagementZoneLayer
		);

		// Rotation handle (initially hidden): knob + guide line + mode icons.
		this.rotationHandleController = new RotationHandleController(
			this.controlLayer,
			this.projection,
			this.playerManager,
			() => this.replay.isActive()
		);

		// Captured-clip replay: locks the board, renders samples through the
		// canonical source→viewport fit, restores the board on exit.
		this.replay = new ReplayController({
			stage: this.stage,
			playersLayer: this.playersLayer,
			engagementZoneLayer: this.engagementZoneLayer,
			staticLayers: [
				this.trackSurfaceLayer,
				this.trackLinesLayer,
				this.ghostLayer,
				this.annotationLayer
			],
			playerManager: this.playerManager,
			getPackManager: () => this.packManager,
			pathRenderer: this.pathRenderer,
			getViewportSize: () => ({ width: this.width, height: this.height }),
			getZoneVisible: () => this.zoneVisible,
			setZoneVisible: (visible) => {
				this.zoneVisible = visible;
				this.applyZoneVisible();
			},
			resetAuthoringView: () => this.resetAuthoringView(),
			loadState: () => this.loadState()
		});

		// Authored-clip playback: tweens poses through the pose store live tier.
		this.authored = new AuthoredPlaybackController({
			playerManager: this.playerManager,
			playersLayer: this.playersLayer,
			engagementZoneLayer: this.engagementZoneLayer,
			trailLayer: this.trailLayer,
			trailRenderer: this.trailRenderer,
			getPackManager: () => this.packManager,
			updateRotationHandle: (hint) => this.updateRotationHandle(hint),
			clearFocusState: () => {
				this.focusIds = null;
				this.focusTapEnabled = false;
				this.focusTapCallback = null;
			}
		});

		// Reactively show/hide/move the rotation handle when selection changes.
		// Without this, tapping an entity set the store but never rendered the
		// handle (the manual direction control was effectively invisible).
		this.selectionUnsubscribe = selectedEntityId.subscribe((id) => {
			this.playerManager.setSelection(id);
			this.updateRotationHandle();
		});

		// Redraw annotations when the selected mark changes so the dashed
		// selection ring appears/clears immediately (the layer is rebuilt).
		this.annotationSelectionUnsubscribe = selectedAnnotationId.subscribe(() => {
			this.renderAnnotations(this.getActiveStep());
		});

		// The selection box only belongs to the Select tool; re-render on tool
		// change so it appears/disappears with the active tool. Also toggles the
		// eraser cursor for the erase tool.
		this.toolModeUnsubscribe = toolMode.subscribe(() => {
			if (this.annotationGestures.isActive()) return; // don't clobber a live gesture
			this.renderAnnotations(this.getActiveStep());
			this.drawingTools.updateCursor(this.replay.isActive());
		});

		// The knob + dashed line appear/disappear when direction-control mode
		// toggles (double-click to enter, single-click/canvas to exit).
		this.directionControlUnsubscribe = directionControlActive.subscribe(() => {
			this.updateRotationHandle();
		});

		// Re-render step overlays when the document changes via undo/redo.
		// Explicit edits already trigger renderStepOverlays; this subscription
		// catches the undo/redo path (and any external doc load) so annotations
		// and paths don't stay stale after history navigation.
		this.docUnsubscribe = boardDoc.subscribe(() => {
			if (this.replay.isActive() || this.authored.isActive()) return;
			this.renderStepOverlays(this.getActiveStep(), get(selectedEntityId));
		});

		// Rebuild the selection chrome when the persisted zoom changes (zoom
		// buttons, reset, fit-to-track, and the post-gesture persist). Live
		// wheel/pinch is handled in the gesture handler's zoom callback.
		this.zoomUnsubscribe = boardState.subscribe((s) => {
			const z = s.viewSettings?.zoom ?? 1;
			if (z === this.lastZoom) return;
			this.lastZoom = z;
			this.rescaleSelectionChrome();
		});

		// Control stage/player dragging from the resolved interaction flags
		// (tool only): `hand` pans, `select` edits, drawing tools do neither.
		this.interactionUnsubscribe = interaction.subscribe(({ panEnabled, entitiesEnabled }) => {
			const ok = !this.replay.isActive() && !this.authored.isActive();
			this.stage.draggable(panEnabled && ok);
			// Gate both the layer and every player node: Konva's layer-level
			// `draggable(false)` does NOT disable dragging on child groups (each
			// player is created `draggable: true`), so without this the hand tool
			// would still let you drag skaters around while panning.
			const entitiesDraggable = entitiesEnabled && ok;
			this.playersLayer.draggable(entitiesDraggable);
			this.playerManager.setPlayersDraggable(entitiesDraggable);
		});

		// Apply the persisted direction-marker visibility on first paint.
		const markerVisible = get(boardSettings).directionMarkerVisible ?? true;
		this.playerManager.setAllHeadingVisible(markerVisible);

		// Register a single delegated handler for player interactions.
		// Registered once here (not in the managers) so it survives rebuilds and
		// always dispatches to the current playerManager/packManager instances.
		this.playersLayer.on('dragstart touchstart', (e) => {
			this.playerManager.handleDragStart(e);
			// Auto-select a skater the moment it is grabbed (dragstart only — a
			// bare tap still selects via the click handler). Players are only
			// draggable in the Select tool, so this is implicitly tool-gated.
			if (e.type === 'dragstart' && !this.replay.isActive()) {
				const target = e.target as Konva.Node;
				if (target.hasName('playerGroup')) {
					const player = target.getAttr('player') as { id?: string } | undefined;
					if (player?.id && player.id !== get(selectedEntityId)) {
						selectedEntityId.set(player.id);
						directionControlActive.set(false);
						selectedAnnotationId.set(null);
					}
				}
			}
		});

		this.playersLayer.on('dragmove touchmove', (e) => {
			// handleDragMove resolves the dragged entity's heading once for this
			// event; the rotation handle reuses it below instead of resolving
			// the same heading (entity find + track tangent) a second time.
			const heading = this.playerManager.handleDragMove(e);
			if (!this.replay.isActive()) {
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
					if (player?.id) {
						if (player.id === get(selectedEntityId)) {
							this.updateRotationHandle(heading);
						}
						// Path lines are anchored to the skater (current step's start,
						// previous step's endpoint) — keep them glued during the drag.
						const center = this.projection.stageCenter();
						this.pathEditor.updateForEntityPose(player.id, {
							x: (target.x() - center.x) / TRACK_SCALE,
							y: (target.y() - center.y) / TRACK_SCALE
						});
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
			if (!this.replay.isActive()) {
				this.packManager.schedulePackUpdate();
			}
		});

		// Combined stage move/up dispatch: an active annotation move/resize/
		// rotate gesture always wins over freehand drawing. A press on an
		// unselected annotation arms a direct grab that promotes to a move
		// gesture (with auto-select) once the pointer crosses the threshold.
		this.stage.on('pointerdown', (e) => {
			if (this.replay.isActive()) return;
			this.annotationGestures.armDirectMove(e);
		});

		this.stage.on('pointermove', () => {
			if (this.annotationGestures.isActive()) {
				this.annotationGestures.scheduleUpdate();
				return;
			}
			if (this.annotationGestures.maybeBeginDirectMove()) {
				this.annotationGestures.scheduleUpdate();
				return;
			}
			this.drawingTools.handlePointerMove();
		});

		this.stage.on('pointerup pointercancel', () => {
			if (this.annotationGestures.isActive()) {
				this.annotationGestures.commit();
				return;
			}
			this.annotationGestures.clearArmed();
			this.drawingTools.handlePointerUp();
		});

		// Hover affordances in the Select tool: grabbing over a hittable
		// annotation, a directional resize cursor over corner handles, and an
		// open-hand grab over the rotation handle. Skipped during a live
		// gesture so the cursor captured at gesture start stays put.
		this.stage.on('mousemove', (e) => {
			if (this.replay.isActive()) return;
			if (get(toolMode) !== 'select') return;
			if (this.annotationGestures.isActive()) return;
			this.annotationRenderer.updateHoverCursor(e);
		});

		this.playersLayer.on('collision', (e) => {
			this.playerManager.handleCollision(e);
		});

		this.playerManager.initialLoad();
		this.packManager.determinePack();
		this.playersLayer.batchDraw();

		// Resize handling: window + visualViewport (mobile address bar / keyboard).
		this.viewport.attach();

		// Pinch-zoom (touch) + wheel-zoom (desktop), anchored at the gesture point.
		// Refreshing the selection chrome on each step keeps its stroke/handle
		// sizes constant on screen instead of drifting with the zoom level.
		this.gestureHandler = new KonvaGestureHandler(
			this.stage,
			(point, scale) => {
				this.viewport.zoomAt(point, scale);
				// Track the applied scale so the post-gesture persist (which
				// writes boardState) doesn't trigger a redundant rescale.
				this.lastZoom = this.stage.scaleX();
				this.rescaleSelectionChrome();
			},
			() => this.replay.isActive(),
			() => this.viewport.updatePersistedState()
		);

		this.exporter = new BoardExporter(this.stage, () => ({
			width: this.width,
			height: this.height
		}));

		// If the default view crops the track (e.g. small/mobile portrait), fit it.
		this.viewport.fitIfOverflowing();

		// Preload the Excalifont (used by canvas labels) and re-render annotations
		// once it's ready: Konva draws text through the 2D context, which only
		// resolves an unloaded font to a fallback, so without this the first paint
		// of any label would use the wrong metrics/font until the next re-render.
		if ('fonts' in document) {
			document.fonts
				.load('40px Excalifont')
				.then(() => this.renderAnnotations(this.getActiveStep()))
				.catch(() => {});
		}
	}

	destroy() {
		// Cancel in-flight rAF loops so nothing mutates destroyed layers (or
		// the global pose store) after teardown.
		this.authored.destroy();
		this.viewport.destroy();
		this.gestureHandler.destroy();
		this.annotationGestures.destroy();
		this.labelEditor.destroy();
		this.selectionUnsubscribe?.();
		this.annotationSelectionUnsubscribe?.();
		this.toolModeUnsubscribe?.();
		this.directionControlUnsubscribe?.();
		this.docUnsubscribe?.();
		this.zoomUnsubscribe?.();
		this.playerManager?.destroy();
		this.rotationHandleController.destroy();
		this.trackSurfaceLayer.destroy();
		this.trackLinesLayer.destroy();
		this.engagementZoneLayer.destroy();
		this.pathLayer.destroy();
		this.trailLayer.destroy();
		this.ghostLayer.destroy();
		this.playersLayer.destroy();
		this.annotationLayer.destroy();
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

	/**
	 * Public resize hook for layout-driven container changes the window
	 * `resize` listener can't see (e.g. a docked sidebar shrinking the canvas
	 * via CSS). Routes through the ViewportController's debounced handling.
	 */
	resize(): void {
		this.viewport.resize();
	}

	private rebuildTrackAndPlayers() {
		// Clear track layers (no manager owns these; safe to wipe wholesale).
		this.trackSurfaceLayer.destroyChildren();
		this.trackLinesLayer.destroyChildren();
		this.engagementZoneLayer.destroyChildren();
		this.trailRenderer.clear();

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

		// Either load from the document or load the default lineup.
		// Checking boardDoc (not boardState) keeps a single source of truth:
		// after an undo restores the doc, a subsequent resize/rebuild must
		// render the restored entities, not wipe them with loadDefaultLineup.
		if (boardDoc.current.entities.length > 0) {
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
		this.viewport.zoomIn();
	}

	// Decrease zoom level within MIN_ZOOM limit
	zoomOut() {
		this.viewport.zoomOut();
	}

	// Reset zoom and position to default values
	resetZoom() {
		this.viewport.resetZoom();
	}

	/** Track bounding box in unscaled board (stage-local) coordinates. */
	getTrackBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
		return this.viewport.getTrackBounds();
	}

	/** Live stage transform for mapping board coordinates to viewport pixels. */
	getView(): { zoom: number; x: number; y: number } {
		return this.viewport.getView();
	}

	/** Default zone (whole track + margin) as viewport-relative fractions. */
	defaultZone(ratio: number | null): CaptureZone {
		return this.viewport.defaultZone(ratio);
	}

	/** Fits the whole track (with margin) inside the viewport and centers it. */
	fitToTrack(margin?: number) {
		this.viewport.fitToTrack(margin);
	}

	loadState() {
		// Clear existing players (via the manager, so its tracking arrays stay
		// in sync — not layer.destroyChildren) and the engagement-zone overlay.
		this.playerManager.clear();
		this.engagementZoneLayer.destroyChildren();

		// Load view settings
		this.viewport.loadViewSettings();

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
		// Exit any active replay first so it restores the board before we
		// tear it down; otherwise replay's override tier would survive the
		// reset and keep players pinned to sample poses.
		if (this.replay.isActive()) {
			this.setReplayMode(false);
		}

		// Tear down all authoring residue: authored-playback flag, poseStore
		// live + override tiers (moved/animated poses), focus/dim, trails,
		// selection, direction control. Without this the override tier keeps
		// players at their last playback positions after the doc is reset.
		this.resetAuthoringView();

		// Build the default lineup and write it through applyEdit so the reset
		// is a SINGLE undoable history entry (set would clear history). The
		// recipe replaces entities with the default lineup and clears clips,
		// annotations, and the active clip.
		const { doc: defaultDoc, state: defaultState } = this.playerManager.buildDefaultLineupDoc();
		boardDoc.applyEdit((draft) => {
			draft.entities = defaultDoc.entities;
			draft.clips = [];
			draft.activeClipId = null;
			draft.annotations = [];
			draft.meta = {};
		}, 'Reset board');

		// Sync the legacy persisted state to the default lineup so view
		// settings and the lineup-presence flag match the new doc.
		boardState.set(defaultState);

		// Clear selection stores
		selectedAnnotationId.set(null);

		// Reset stage position and scale
		this.stage.position({ x: 0, y: 0 });
		this.stage.scale({ x: BASE_ZOOM, y: BASE_ZOOM });

		// Make sure dimensions are current
		this.viewport.recalculateDimensions();

		// Rebuild everything with fresh dimensions. Since the doc now has
		// entities (the default lineup), rebuildTrackAndPlayers calls
		// initialLoad (renders from the doc) rather than loadDefaultLineup
		// (which would call boardDoc.set and wipe the undo history entry).
		this.rebuildTrackAndPlayers();

		this.stage.batchDraw();
		this.viewport.updatePersistedState();
	}

	createRecorder(): KonvaRecorder {
		return new KonvaRecorder({ stage: this.stage, watermark: this.exporter.getWatermark() });
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
		return this.replay.isActive();
	}

	/** Enters/exits replay mode (see ReplayController). */
	setReplayMode(enabled: boolean, source?: { w: number; h: number }): void {
		this.replay.setActive(enabled, source);
	}

	/**
	 * Current path-frame reference (identity, not a copy). `currentPathFrame`
	 * is only ever reassigned — never mutated — so a reference comparison
	 * detects any path-overlay change (renderPaths/renderPathFrame) without
	 * building a snapshot. Used by the timeline recorder's idle dirty-check.
	 */
	getPathFrameRef(): PathFrame | undefined {
		return this.pathRenderer.getPathFrameRef();
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
			const relative = { x: pose.x * TRACK_SCALE, y: pose.y * TRACK_SCALE };

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

		let pathFrame: PathFrame | undefined;
		if (get(boardSettings).pathsVisible !== false) {
			pathFrame = this.pathRenderer.getPathFrameRef();
		}

		return {
			teamPlayers,
			skatingOfficials,
			view: {
				zoom: this.stage.scaleX(),
				relativeX: this.stage.x() / centerX,
				relativeY: this.stage.y() / centerY
			},
			pathFrame
		};
	}

	/** Reconciles the board to a sample (see ReplayController). */
	applySnapshot(sample: TimelineSample): void {
		this.replay.applySnapshot(sample);
	}

	/** Renders a sample in pure source space for export (see ReplayController). */
	applySnapshotCanonical(sample: TimelineSample, source: { w: number; h: number }): void {
		this.replay.applySnapshotCanonical(sample, source);
	}

	// ------------------------------------------------------------------------- //
	// Authored-clip playback (P3) — delegates to AuthoredPlaybackController.
	// ------------------------------------------------------------------------- //

	/** Enters authored playback: locks entity dragging, resets trails. */
	beginAuthoredPlayback(): void {
		this.authored.begin();
	}

	/** Exits authored playback: clears transient live poses, restores dragging. */
	endAuthoredPlayback(): void {
		this.authored.end();
	}

	isAuthoredPlayback(): boolean {
		return this.authored.isActive();
	}

	/** Resets all authoring-view state (focus/dim, trails, live-tier). */
	resetAuthoringView(): void {
		this.authored.resetView();
	}

	/** Renders one frame of tweened entity poses during authored playback. */
	applyAuthoredPoses(poses: EntityPose[]): void {
		this.authored.applyPoses(poses);
	}

	/** Tweens from current board poses to target poses over the specified duration. */
	tweenToStep(targetPoses: EntityPose[], durationMs: number = 300, onComplete?: () => void): void {
		this.authored.tweenToStep(targetPoses, durationMs, onComplete);
	}

	/** Enables/disables the fading motion-trail tail during playback. */
	setTrailsEnabled(enabled: boolean): void {
		this.authored.setTrailsEnabled(enabled);
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

	exportAsImage(pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
		return this.exporter.exportAsImage(pixelRatio, watermark);
	}

	/** Captures a viewport sub-region as a PNG data URL (with watermark). */
	exportZoneImage(zone: CaptureZone, pixelRatio = 2, watermark: WatermarkSize = 'medium'): string {
		return this.exporter.exportZoneImage(zone, pixelRatio, watermark);
	}

	/** Shared watermark (preloaded at construction); used by image and video export. */
	getWatermark(): Watermark {
		return this.exporter.getWatermark();
	}

	/**
	 * Updates the rotation handle position to follow the selected entity.
	 * `headingHint` lets per-event callers share one heading resolution.
	 */
	updateRotationHandle(headingHint: number | null = null): void {
		this.rotationHandleController.update(headingHint);
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

	/** Renders the path overlay from a recorded PathFrame (replay/export). */
	renderPathFrame(frame: PathFrame | undefined): void {
		this.pathRenderer.renderPathFrame(frame);
	}

	/**
	 * Renders movement paths for a step. If step is undefined, clears the layer.
	 * Paths are shown for the selected entity or when pathOverlay mode is 'all'.
	 *
	 * In Select the previous/current/next steps' paths for the selected entity
	 * are all rendered with their draggable editing nodes — the adjacent-step
	 * (ghost) lines keep a distinct muted colour and are drawn behind the active
	 * step. In other tools only the lines are shown (no handles).
	 */
	renderPaths(
		step: Step | undefined,
		selectedEntityId: string | null,
		prevStep?: Step | undefined,
		nextStep?: Step | undefined
	): void {
		this.pathRenderer.renderPaths(step, selectedEntityId, prevStep, nextStep);
	}

	/**
	 * Renders annotations for a step. With step undefined (Live) only
	 * board-wide marks are shown; a scoped mark (single step or step range)
	 * appears only while the active step falls within its scope. The active
	 * clip's step order is resolved here so callers stay unchanged.
	 */
	renderAnnotations(step: Step | undefined): void {
		this.annotationRenderer.render(step, this.getActiveSteps());
	}

	/**
	 * Rescales the selection chrome in place for the current zoom (cheap: no
	 * node rebuild). Skipped while an annotation gesture (move/resize/rotate)
	 * owns the chrome — it re-renders via renderSelection on commit, and
	 * touching the cached nodes here mid-gesture would fight the gesture.
	 */
	private rescaleSelectionChrome(): void {
		if (this.annotationGestures.isActive()) return;
		this.annotationRenderer.rescaleSelectionChrome();
	}

	/** The active authored clip's ordered steps (empty when not authoring). */
	private getActiveSteps(): Step[] {
		const clipId = boardDoc.current.activeClipId;
		if (!clipId) return [];
		const clip = boardDoc.current.clips.find((c) => c.id === clipId);
		return clip && clip.kind === 'authored' ? clip.steps : [];
	}

	/**
	 * Renders onion-skin ghosts of neighbouring steps.
	 * Ghosts are translucent circles at each entity's pose.
	 */
	renderOnionSkin(prevStep: Step | undefined, nextStep: Step | undefined, depth: number): void {
		this.onionSkinRenderer.render(prevStep, nextStep, depth);
	}

	/**
	 * Visibility setters for layers.
	 */
	setPathsVisible(visible: boolean): void {
		this.pathLayer.visible(visible);
		this.pathLayer.batchDraw();
		boardSettings.update((s) => ({ ...s, pathsVisible: visible }));
	}

	setAnnotationsVisible(visible: boolean): void {
		this.annotationLayer.visible(visible);
		this.annotationLayer.batchDraw();
		boardSettings.update((s) => ({ ...s, annotationsVisible: visible }));
	}

	setOnionSkin(enabled: boolean, depth: number): void {
		this.ghostLayer.visible(enabled);
		this.ghostLayer.batchDraw();
		boardSettings.update((s) => ({ ...s, onionSkin: enabled, onionSkinDepth: depth as 1 | 2 }));
	}

	setPathOverlay(mode: 'off' | 'all' | 'selected'): void {
		boardSettings.update((s) => ({ ...s, pathOverlay: mode }));
		// Re-render paths with new overlay mode
		const step = this.getActiveStep();
		const selectedId = get(selectedEntityId);
		const { prevStep, nextStep } = this.getAdjacentSteps();
		this.renderPaths(step, selectedId, prevStep, nextStep);
	}

	/**
	 * Returns the steps immediately before and after the active step.
	 */
	private getAdjacentSteps(): { prevStep: Step | undefined; nextStep: Step | undefined } {
		const clipId = boardDoc.current.activeClipId;
		if (!clipId) return { prevStep: undefined, nextStep: undefined };
		const clip = boardDoc.current.clips.find((c) => c.id === clipId);
		if (!clip || clip.kind !== 'authored') return { prevStep: undefined, nextStep: undefined };
		const session = get(authoringSession);
		const idx = session.activeStepIndex;
		return {
			prevStep: idx > 0 ? clip.steps[idx - 1] : undefined,
			nextStep: idx < clip.steps.length - 1 ? clip.steps[idx + 1] : undefined
		};
	}

	/**
	 * Public render entry used by the UI.
	 * Renders all step-attached overlays for the given active step.
	 */
	renderStepOverlays(step: Step | undefined, selectedEntityId: string | null): void {
		const settings = get(boardSettings);

		const { prevStep, nextStep } = this.getAdjacentSteps();
		this.renderPaths(step, selectedEntityId, prevStep, nextStep);
		this.renderAnnotations(step);

		if (settings.onionSkin && !this.authored.isActive()) {
			if (prevStep || nextStep) {
				this.renderOnionSkin(prevStep, nextStep, settings.onionSkinDepth ?? 1);
			}
		} else {
			this.onionSkinRenderer.clear();
		}
	}

	/**
	 * Helper to get the active step from the current document state.
	 */
	private getActiveStep(): Step | undefined {
		const clipId = boardDoc.current.activeClipId;
		if (!clipId) return undefined;
		const clip = boardDoc.current.clips.find((c) => c.id === clipId);
		if (!clip || clip.kind !== 'authored') return undefined;
		const session = get(authoringSession);
		const stepIndex = Math.max(0, Math.min(session.activeStepIndex, clip.steps.length - 1));
		return clip.steps[stepIndex];
	}

	/**
	 * Projects a planar world-metre point to viewport (screen) pixels through
	 * the current stage pan/zoom. Used by the DOM HUD overlays, which track
	 * positions per frame but compute everything else reactively.
	 */
	planeToScreen(p: PlanarPoint): { x: number; y: number } {
		return this.projection.planeToScreen(p);
	}

	/**
	 * Screen position of one entity's effective pose, or null when unknown.
	 * Lightweight per-frame accessor for the entity HUD (the label is derived
	 * reactively in the component, not here).
	 */
	getEntityScreenPos(id: string): { x: number; y: number } | null {
		const pose = poseStore.effective(id);
		if (!pose) return null;
		return this.planeToScreen(pose);
	}
}

export { hudLabel } from './entityLabels';
