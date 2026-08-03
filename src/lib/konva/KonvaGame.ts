import { get } from 'svelte/store';
import Konva from 'konva';
import type { Circle } from 'konva/lib/shapes/Circle';

import { boardState } from '$lib/stores/konvaBoardState';
import {
	selectedEntityId,
	selectedAnnotationId,
	directionControlActive
} from '$lib/stores/selection';
import { boardSettings } from '$lib/stores/boardSettings';
import { authoringSession } from '$lib/stores/session';
import { toolMode, isDrawingTool } from '$lib/stores/toolMode';
import { interaction } from '$lib/stores/interaction';
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
import { trackLayer } from '$lib/track/trackLayer';
import { motionHeading } from '$lib/track/heading';
import { tweenSteps, easeInOutCubic, MAX_PATH_LENGTH_M, MAX_PATH_POINTS } from '$lib/track/tween';
import {
	buildArcLength,
	catmullRom,
	catmullRomClosed,
	simplify,
	clampNodeToBudget
} from '$lib/track/pathMath';
import type {
	Entity,
	EntityPose,
	HeadingMode,
	Step,
	Annotation,
	AnnotationTransform,
	EntityPath,
	PlanarPoint
} from '$lib/doc/types';
import type { PathFrame } from '$lib/recording/timeline/types';
import {
	effectiveAnchors,
	baseBox,
	boxCorners,
	halfSizes,
	rotateHandlePos,
	resolvedTransform,
	moveTransform,
	resizeTransform,
	rotateTransform,
	MIN_HALF
} from './annotationTransform';
import {
	setEntityPath,
	addAnnotation,
	deleteAnnotation,
	deletePath,
	setAnnotationTransform
} from '$lib/doc/clipOps';
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
	/** Reactive bridge from the annotation selection store to the ring render. */
	private annotationSelectionUnsubscribe: (() => void) | null = null;
	private directionControlUnsubscribe: (() => void) | null = null;
	/** Thin dashed guide line between the facing marker and the direction knob. */
	private directionLine: Konva.Line | null = null;
	/** Mode icons rendered on the knob (auto/relative vs locked). */
	private knobAutoMark: Konva.Text | null = null;
	private knobPinMark: Konva.Group | null = null;
	private knobLockMark: Konva.Group | null = null;

	/** Drawing handler for annotation/path gestures */
	private interactionUnsubscribe: (() => void) | null = null;

	/** Reactive bridge: re-render annotations (and show/hide the selection box)
	 * when the active tool changes. */
	private toolModeUnsubscribe: (() => void) | null = null;

	/** Active annotation move/resize/rotate gesture, or null when idle. */
	private annotationGesture: {
		type: 'move' | 'resize' | 'rotate';
		annId: string;
		ann: Annotation;
		baseHw: number;
		baseHh: number;
		start: AnnotationTransform;
		startPointer: PlanarPoint;
		su: number;
		sv: number;
	} | null = null;
	/** Suppresses the click that follows a gesture so it doesn't deselect.
	 * Timestamp (not a flag) so a touch drag — which fires no click — can't
	 * leave a lingering flag that swallows the next genuine tap. */
	private lastGestureEnd = 0;

	/**
	 * Cached last sample heading map for captured-clip motion-derived heading (P4.5).
	 * Keyed by entity id; positions are planar world metres (center-relative).
	 */
	private capturedPrevPos: Map<string, PlanarPoint> = new Map();
	private capturedLastHeading: Map<string, number> = new Map();

	/**
	 * Last-rendered path overlay state. Updated whenever `renderPaths` or
	 * `renderPathFrame` paints, so `getSnapshot()` captures what is actually
	 * on screen (not a stale document lookup that ignores playback step).
	 */
	private currentPathFrame: PathFrame | undefined;

	/**
	 * Reusable replay path lines, keyed by `prev:|next:|cur:` + path id.
	 * Owned by {@link renderPathFrame}; any code that wipes `pathLayer`
	 * directly (renderPaths) must clear this map too.
	 */
	private pathFrameLines = new Map<string, Konva.Line>();

	/**
	 * Resets the captured-clip heading state (called on replay start/seek-large-jump).
	 */
	private resetCapturedHeadingState(): void {
		this.capturedPrevPos.clear();
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

		// Eraser cursor: a white circle that follows the pointer while the erase
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

		// Redraw annotations when the selected mark changes so the dashed
		// selection ring appears/clears immediately (the layer is rebuilt).
		this.annotationSelectionUnsubscribe = selectedAnnotationId.subscribe(() => {
			this.renderAnnotations(this.getActiveStep());
		});

		// The selection box only belongs to the Select tool; re-render on tool
		// change so it appears/disappears with the active tool. Also toggles the
		// eraser cursor for the erase tool.
		this.toolModeUnsubscribe = toolMode.subscribe(() => {
			if (this.annotationGesture) return; // don't clobber a live gesture
			this.renderAnnotations(this.getActiveStep());
			this.updateEraseCursor();
		});

		// The knob + dashed line appear/disappear when direction-control mode
		// toggles (double-click to enter, single-click/canvas to exit).
		this.directionControlUnsubscribe = directionControlActive.subscribe(() => {
			this.updateRotationHandle();
		});

		// Control stage/player dragging from the resolved interaction flags
		// (tool only): `hand` pans, `select` edits, drawing tools do neither.
		this.interactionUnsubscribe = interaction.subscribe(({ panEnabled, entitiesEnabled }) => {
			const ok = !this.replayMode && !this.authoredPlayback;
			this.stage.draggable(panEnabled && ok);
			this.playersLayer.draggable(entitiesEnabled && ok);
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
			// handleDragMove resolves the dragged entity's heading once for this
			// event; the rotation handle reuses it below instead of resolving
			// the same heading (entity find + track tangent) a second time.
			const heading = this.playerManager.handleDragMove(e);
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
					if (player?.id) {
						if (player.id === get(selectedEntityId)) {
							this.updateRotationHandle(heading);
						}
						// Path lines are anchored to the skater (current step's start,
						// previous step's endpoint) — keep them glued during the drag.
						const center = this.getStageCenter();
						this.updatePathsForEntityPose(player.id, {
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
			if (!this.replayMode) {
				this.packManager.schedulePackUpdate();
			}
		});

		// Drawing handler for annotation/path gestures (planar world metres)
		let drawingPoints: PlanarPoint[] = [];
		let firstAnchor: PlanarPoint | null = null;
		let previewLine: Konva.Line | null = null;
		let rafId: number | null = null;
		let pathLengthAccum = 0; // running arc-length for path cap enforcement

		this.stage.on('pointerdown', (e) => {
			const tool = get(toolMode);
			if (!isDrawingTool(tool)) return;

			// Only handle on stage or overlay layers, not on UI controls.
			// Annotation shapes and active-step path lines are hittable content
			// (for selection in Select / targeting in Erase), but a new draw
			// should still start when the pointer lands on one — treat either
			// like the empty canvas.
			const drawTarget = e.target as Konva.Node;
			const passthrough =
				drawTarget.findAncestors('.annotation', true).length > 0 ||
				drawTarget.findAncestors('.lineShape', true).length > 0;
			if (!passthrough && drawTarget !== this.stage && drawTarget.parent !== this.stage) return;

			e.cancelBubble = true;

			const pos = this.stage.getPointerPosition();
			if (!pos) return;

			const planePos = this.pointerToPlane(pos);

			if (tool === 'drawPath') {
				const selectedId = get(selectedEntityId);
				if (!selectedId) {
					// Need a selected entity to draw a path
					return;
				}
				pathLengthAccum = 0;
				// Prepend the entity's current pose so the path always starts at
				// the skater, with a straight segment to the first click.
				const step = this.getActiveStep();
				const entityPose = step?.entities.find((en) => en.id === selectedId);
				if (entityPose) {
					drawingPoints = [
						{ x: entityPose.x, y: entityPose.y },
						{ x: planePos.x, y: planePos.y }
					];
					// Account for the initial straight segment in the length budget.
					pathLengthAccum = Math.hypot(planePos.x - entityPose.x, planePos.y - entityPose.y);
				} else {
					drawingPoints = [{ x: planePos.x, y: planePos.y }];
				}
			} else if (tool === 'pen' || tool === 'zone' || tool === 'arrow') {
				drawingPoints = [{ x: planePos.x, y: planePos.y }];
			} else if (tool === 'gap') {
				firstAnchor = { x: planePos.x, y: planePos.y };
			} else if (tool === 'label') {
				const text = prompt('Label text:');
				if (text && text.trim()) {
					// Create label annotation
					this.createAnnotation({
						id: crypto.randomUUID(),
						kind: 'label',
						at: { x: planePos.x, y: planePos.y },
						text: text.trim(),
						style: { color: '#e11d48', width: 2 }
					});
					// Auto-return to select after discrete tools
					toolMode.set('select');
				}
				return;
			}

			// Create preview for freehand tools. The preview is always an OPEN
			// stroke — the zone tool only closes/fills on release, so while
			// drawing it reads as a freehand outline, not a forming zone.
			if (tool === 'pen' || tool === 'drawPath' || tool === 'zone' || tool === 'arrow') {
				previewLine = new Konva.Line({
					points: this.projectSmoothed(drawingPoints, false).flatMap((p) => [p.x, p.y]),
					stroke: tool === 'drawPath' ? this.trailColorFor(get(selectedEntityId) ?? '') : '#e11d48',
					strokeWidth: 2,
					lineCap: 'round',
					lineJoin: 'round',
					tension: 0,
					opacity: 0.5,
					listening: false
				});
				const layer = tool === 'drawPath' ? this.pathLayer : this.annotationLayer;
				layer.add(previewLine);
				layer.batchDraw();
			}
		});

		this.stage.on('pointermove', () => {
			if (this.annotationGesture) {
				// rAF-coalesced: pointermove fires faster than the display
				// refresh (especially coalesced touch events), but only the
				// latest pointer position before paint matters.
				this.scheduleAnnotationGestureUpdate();
				return;
			}
			const tool = get(toolMode);
			if (!isDrawingTool(tool) || (!firstAnchor && drawingPoints.length === 0)) return;

			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				const pos = this.stage.getPointerPosition();
				if (!pos) return;

				const planePos = this.pointerToPlane(pos);

				if (tool === 'pen' || tool === 'drawPath' || tool === 'zone' || tool === 'arrow') {
					// Enforce path-length cap for movement paths. Don't early-return
					// (that would skip `rafId = null` and freeze all further drawing).
					let acceptPoint = true;
					if (tool === 'drawPath' && drawingPoints.length > 0) {
						const last = drawingPoints[drawingPoints.length - 1];
						const segLen = Math.hypot(planePos.x - last.x, planePos.y - last.y);
						if (pathLengthAccum + segLen > MAX_PATH_LENGTH_M) {
							acceptPoint = false;
						} else {
							pathLengthAccum += segLen;
						}
					}

					if (acceptPoint) {
						drawingPoints.push({ x: planePos.x, y: planePos.y });
					}

					// Update preview (open stroke for all freehand tools, incl. zone)
					if (previewLine) {
						previewLine.points(
							this.projectSmoothed(drawingPoints, false).flatMap((p) => [p.x, p.y])
						);
						// Visual cue: turn amber near the cap, red at the cap.
						if (tool === 'drawPath') {
							const ratio = pathLengthAccum / MAX_PATH_LENGTH_M;
							if (ratio >= 0.9) previewLine.stroke('#ef4444');
							else if (ratio >= 0.7) previewLine.stroke('#f59e0b');
						}
						this.pathLayer.batchDraw();
					}
				} else if (tool === 'gap' && firstAnchor) {
					// Update preview line from first anchor to current. Remove only the
					// previous preview — destroyChildren() would wipe committed annotations.
					const layer = this.annotationLayer;
					layer.find('.arrowPreview').forEach((n) => n.destroy());

					const firstPx = this.projectPoint(firstAnchor!.x, firstAnchor!.y);
					const currentPx = { x: pos.x, y: pos.y };

					layer.add(
						new Konva.Line({
							name: 'arrowPreview',
							points: [firstPx.x, firstPx.y, currentPx.x, currentPx.y],
							stroke: '#e11d48',
							strokeWidth: 2,
							opacity: 0.5,
							dash: [8, 8],
							listening: false
						})
					);
					layer.batchDraw();
				}

				rafId = null;
			});
		});

		this.stage.on('pointerup pointercancel', () => {
			if (this.annotationGesture) {
				this.commitAnnotationGesture();
				return;
			}
			const tool = get(toolMode);
			if (!isDrawingTool(tool)) return;

			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}

			// Clear preview (surgical — renderAnnotations rebuilds the layer next)
			if (previewLine) {
				previewLine.destroy();
				previewLine = null;
			} else if (tool === 'arrow' || tool === 'gap') {
				this.annotationLayer.find('.arrowPreview').forEach((n) => n.destroy());
			}

			const step = this.getActiveStep();

			// Commit the gesture. `drawPath` is step-scoped (Free Play never arms
			// it, and it needs a step to attach the path to); the annotation tools
			// commit to the active step in Drill or to the board in Free Play.
			if (tool === 'drawPath' && step) {
				const selectedId = get(selectedEntityId);
				if (selectedId && drawingPoints.length >= 2) {
					// Simplify and cap to MAX_PATH_POINTS (most significant points kept).
					const simplified = simplify(drawingPoints, 0.15, MAX_PATH_POINTS);
					if (simplified.length >= 2) {
						this.setEntityPath(step.id, selectedId, simplified);
					}
				}
			} else if (tool === 'pen' && drawingPoints.length >= 2) {
				const simplified = simplify(drawingPoints, 0.15);
				if (simplified.length >= 2) {
					this.createAnnotation({
						id: crypto.randomUUID(),
						kind: 'pen',
						points: simplified,
						style: { color: '#e11d48', width: 2 }
					});
				}
			} else if (tool === 'arrow' && drawingPoints.length >= 2) {
				const simplified = simplify(drawingPoints, 0.15);
				if (simplified.length >= 2) {
					this.createAnnotation({
						id: crypto.randomUUID(),
						kind: 'arrow',
						points: simplified,
						style: { color: '#e11d48', width: 2 }
					});
				}
			} else if (tool === 'zone' && drawingPoints.length >= 3) {
				const simplified = simplify(drawingPoints, 0.15);
				if (simplified.length >= 3) {
					this.createAnnotation({
						id: crypto.randomUUID(),
						kind: 'zone',
						points: simplified,
						style: { color: '#e11d48', width: 2 }
					});
				}
			} else if (tool === 'gap' && firstAnchor) {
				const pos = this.stage.getPointerPosition();
				if (pos) {
					const planePos = this.pointerToPlane(pos);

					this.createAnnotation({
						id: crypto.randomUUID(),
						kind: 'gap',
						from: firstAnchor,
						to: { x: planePos.x, y: planePos.y },
						style: { color: '#e11d48', width: 2 }
					});
				}
			}

			// Reset
			drawingPoints = [];
			firstAnchor = null;
			pathLengthAccum = 0;

			// Auto-return to select after gesture tools so the path's editing
			// nodes appear immediately — in Select the previous/current/next
			// paths for the selected entity all show their draggable handles.
			if (tool === 'gap' || tool === 'label' || tool === 'drawPath') {
				toolMode.set('select');
			}

			// Re-render overlays
			const selectedId = get(selectedEntityId);
			this.renderStepOverlays(step, selectedId);
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

		// Mirrors playerIdFromEvent: walk the target (and ancestors) for an
		// annotation group and read its `annId` attr (set in renderAnnotations).
		const annotationIdFromEvent = (e: Konva.KonvaEventObject<unknown>): string | null => {
			const target = e.target as Konva.Node;
			const group = target.findAncestors('.annotation', true)[0];
			return group ? ((group.getAttr('annId') as string | undefined) ?? null) : null;
		};

		// Same idea for movement paths: walk for a `lineShape` and read its
		// `stepId`/`pathId` attrs (set in renderPathGeometry).
		const pathIdFromEvent = (
			e: Konva.KonvaEventObject<unknown>
		): { stepId: string; pathId: string } | null => {
			const target = e.target as Konva.Node;
			const line = target.findAncestors('.lineShape', true)[0];
			if (!line) return null;
			const stepId = line.getAttr('stepId') as string | undefined;
			const pathId = line.getAttr('pathId') as string | undefined;
			return stepId && pathId ? { stepId, pathId } : null;
		};

		this.stage.on('click tap', (e) => {
			if (this.replayMode) return;
			// Swallow the click that follows a gesture (mouse fires one even
			// after a drag) so it doesn't deselect the just-manipulated mark.
			if (this.lastGestureEnd && Date.now() - this.lastGestureEnd < 400) {
				this.lastGestureEnd = 0;
				return;
			}
			// In hand mode the canvas is a pan surface — taps must not select.
			if (get(toolMode) === 'hand') return;

			// Erase tool: tap an annotation or an active-step movement path to
			// delete it. Players are never affected; only the active step's own
			// paths are erasable (ghost/adjacent-step paths are read-only).
			if (get(toolMode) === 'erase') {
				const annId = annotationIdFromEvent(e);
				if (annId) {
					deleteAnnotation(annId);
					selectedAnnotationId.set(null);
					this.renderAnnotations(this.getActiveStep());
					return;
				}
				const pathHit = pathIdFromEvent(e);
				if (pathHit) {
					const active = this.getActiveStep();
					if (active && pathHit.stepId === active.id) {
						deletePath(active.id, pathHit.pathId);
						const { prevStep, nextStep } = this.getAdjacentSteps();
						this.renderPaths(active, get(selectedEntityId), prevStep, nextStep);
					}
				}
				return;
			}

			const id = playerIdFromEvent(e);
			if (id) {
				if (this.focusTapEnabled && this.focusTapCallback) {
					// Focus/dim mode (P3): use callback.
					this.focusTapCallback(id);
					return;
				}
				// Single-select: select the entity, direction control inactive.
				// Mutual exclusion: selecting a skater clears any mark.
				selectedEntityId.set(id);
				directionControlActive.set(false);
				selectedAnnotationId.set(null);

				// In the path tool, selecting a player that already has a path in
				// the current step drops into Select so its editing nodes appear.
				// A player with no path stays the tool armed so the user can draw one.
				if (get(toolMode) === 'drawPath') {
					const step = this.getActiveStep();
					const hasPath = step?.paths?.some((p) => p.entityId === id) ?? false;
					if (hasPath) toolMode.set('select');
				}
			} else {
				const annId = annotationIdFromEvent(e);
				if (annId && get(toolMode) === 'select') {
					// Select the annotation; mutual exclusion clears the entity.
					selectedEntityId.set(null);
					selectedAnnotationId.set(annId);
					directionControlActive.set(false);
					e.cancelBubble = true;
				} else {
					// Any other non-skater click (empty canvas, track lines, …) or a
					// non-select tool: deselect everything and exit direction mode.
					selectedEntityId.set(null);
					selectedAnnotationId.set(null);
					directionControlActive.set(false);
				}
			}
		});

		this.stage.on('dblclick dbltap', (e) => {
			if (this.replayMode) return;
			if (this.focusTapEnabled) return; // don't interfere with focus mode
			if (get(toolMode) === 'hand') return; // hand is a pan surface only
			const id = playerIdFromEvent(e);
			if (id) {
				selectedEntityId.set(id);
				directionControlActive.set(true);
				selectedAnnotationId.set(null);
			} else {
				selectedEntityId.set(null);
				directionControlActive.set(false);
				selectedAnnotationId.set(null);
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
		// Cancel in-flight rAF loops so nothing mutates destroyed layers (or
		// the global pose store) after teardown.
		if (this.tweenRafId !== null) {
			cancelAnimationFrame(this.tweenRafId);
			this.tweenRafId = null;
		}
		if (this.annotationGestureRafId !== null) {
			cancelAnimationFrame(this.annotationGestureRafId);
			this.annotationGestureRafId = null;
		}
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		window.removeEventListener('resize', this.handleResize);
		window.visualViewport?.removeEventListener('resize', this.onVisualViewportResize);
		this.gestureHandler.destroy();
		this.selectionUnsubscribe?.();
		this.annotationSelectionUnsubscribe?.();
		this.toolModeUnsubscribe?.();
		this.directionControlUnsubscribe?.();
		this.playerManager?.destroy();
		this.rotationHandle?.destroy();
		this.directionLine?.destroy();
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

		// Step overlays (paths, annotations, onion skin) are drawn with absolute
		// pixel coordinates baked in at render time via projectPoint(), which
		// is anchored to the stage center (width/2, height/2). The track + players
		// were just rebuilt around the new center, so re-project these overlays too
		// — otherwise paths stay floating at their old pixel positions instead of
		// following the player. (Replay is handled by renderSampleTransform above.)
		// In Free Play the step is undefined but board-level annotations still need
		// re-projecting, so this runs in both experiences.
		this.renderStepOverlays(this.getActiveStep(), get(selectedEntityId));
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
		const { panEnabled, entitiesEnabled } = get(interaction);
		this.stage.draggable(!enabled && panEnabled);
		this.playersLayer.draggable(!enabled && entitiesEnabled);
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
	/**
	 * Current path-frame reference (identity, not a copy). `currentPathFrame`
	 * is only ever reassigned — never mutated — so a reference comparison
	 * detects any path-overlay change (renderPaths/renderPathFrame) without
	 * building a snapshot. Used by the timeline recorder's idle dirty-check.
	 */
	getPathFrameRef(): PathFrame | undefined {
		return this.currentPathFrame;
	}

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
			pathFrame = this.currentPathFrame;
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

		this.applySampleOverrides(sample);
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

				this.applySampleOverrides(sample);
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
		this.playersLayer.draggable(false);
		this.clearTrails();
	}

	/** Exits authored playback: clears transient live poses, restores dragging. */
	endAuthoredPlayback(): void {
		this.authoredPlayback = false;
		poseStore.abortGesture();
		this.playerManager.setPlayersDraggable(true);
		this.playersLayer.draggable(get(interaction).entitiesEnabled);
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
			poseStore.setLive(pose.id, { x: pose.x, y: pose.y, heading: pose.heading });
		}
		// draw=false on the composite steps: each layer is drawn exactly once,
		// at the end of the frame, instead of 2–3 times per frame.
		this.playerManager.applyEffectivePoses(false);
		this.packManager.determinePack(false);
		if (this.trailsEnabled) {
			this.pushTrails(poses);
			this.trailLayer.batchDraw();
		}
		// The sampler already resolved every heading for this frame — reuse the
		// selected entity's instead of resolving it again in the handle update.
		this.updateRotationHandle(poses.find((p) => p.id === get(selectedEntityId))?.heading ?? null);
		this.engagementZoneLayer.batchDraw();
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
			x: pose.x,
			y: pose.y,
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
			const x = center.x + pose.x * TRACK_SCALE;
			const y = center.y + pose.y * TRACK_SCALE;
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
			const cx = center.x + pose.x * TRACK_SCALE;
			const cy = center.y + pose.y * TRACK_SCALE;

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
				ky - (center.y + pose.y * TRACK_SCALE),
				kx - (center.x + pose.x * TRACK_SCALE)
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
				const t = trackLayer.tangentAt({ x: pose.x, y: pose.y });
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
			const t = trackLayer.tangentAt({ x: pose.x, y: pose.y });
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
	 *
	 * `headingHint` (relative/fixed/auto modes only) is an already-resolved
	 * heading for the selected entity, letting per-event callers share one
	 * heading resolution instead of re-deriving it here.
	 */
	updateRotationHandle(headingHint: number | null = null): void {
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
		const cx = center.x + pose.x * TRACK_SCALE;
		const cy = center.y + pose.y * TRACK_SCALE;

		const mode: HeadingMode = entity.headingMode ?? 'relative';
		const pinned = mode === 'pinned' && !!entity.lookAt;
		let hx: number;
		let hy: number;
		let heading: number;
		if (pinned) {
			// Knob sits on the fixed look-at map point; skater faces toward it.
			hx = center.x + entity.lookAt!.x * TRACK_SCALE;
			hy = center.y + entity.lookAt!.y * TRACK_SCALE;
			heading = Math.atan2(entity.lookAt!.y - pose.y, entity.lookAt!.x - pose.x);
		} else {
			// Relative/fixed/auto: knob orbits the skater along the resolved
			// facing (tangent+delta, or the frozen absolute angle).
			heading = headingHint ?? this.playerManager.resolvedHeadingFor(selectedId) ?? pose.heading;
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
	 * Converts a stage-space pointer position to planar world metres. The
	 * canonical stored coordinate system is planar, so drawing/storing a point
	 * needs no track conversion — `(S, u)` is derived on demand elsewhere.
	 *
	 * `stage.getPointerPosition()` returns the pointer relative to the stage's
	 * top-left in raw viewport pixels — it does NOT undo the stage's own
	 * zoom/pan transform (stage.scale / stage.position, set by fitToTrack,
	 * wheel/pinch zoom, and panning). Undo that transform first so the planar
	 * coordinate matches what is actually under the cursor at any zoom/pan.
	 * Without this, a zoomed/panned board places drawn points off the cursor
	 * (radially toward the transform's origin), which reads as a consistent
	 * angular offset. Mirrors the inverse transform already used in `zoomAt`.
	 */
	private pointerToPlane(pos: { x: number; y: number }): PlanarPoint {
		const center = this.getStageCenter();
		const scale = this.stage.scaleX();
		const contentX = (pos.x - this.stage.x()) / scale;
		const contentY = (pos.y - this.stage.y()) / scale;
		return {
			x: (contentX - center.x) / TRACK_SCALE,
			y: (contentY - center.y) / TRACK_SCALE
		};
	}

	/**
	 * Projects a planar world-metre point to stage pixel coordinates.
	 * Used by path/annotation/onion-skin renderers.
	 */
	private projectPoint(x: number, y: number): { x: number; y: number } {
		const center = this.getStageCenter();
		return { x: center.x + x * TRACK_SCALE, y: center.y + y * TRACK_SCALE };
	}

	/**
	 * Smooths planar points via Catmull-Rom and projects them to stage
	 * pixels. Returns null if the arc length is zero (degenerate path).
	 */
	private smoothProject(points: PlanarPoint[]): { x: number; y: number }[] | null {
		if (buildArcLength(points).total === 0) return null;
		return catmullRom(points, 8).map((pt) => this.projectPoint(pt.x, pt.y));
	}

	/**
	 * Smooths planar points with Catmull-Rom and projects them to stage pixels
	 * for annotation rendering (pen = open curve, zone = closed loop). Unlike
	 * smoothProject this never returns null — it falls back to straight
	 * projection for degenerate (< 2 point) input — so a stroke always renders.
	 */
	private projectSmoothed(points: PlanarPoint[], closed = false): { x: number; y: number }[] {
		if (points.length < 2) return points.map((p) => this.projectPoint(p.x, p.y));
		const smoothed = closed ? catmullRomClosed(points, 8) : catmullRom(points, 8);
		return smoothed.map((p) => this.projectPoint(p.x, p.y));
	}

	/**
	 * Computes motion-heading overrides for a replay sample's entities and
	 * publishes them to the pose store. Shared by both replay code paths.
	 */
	private applySampleOverrides(sample: TimelineSample): void {
		const overrides: Array<[string, { x: number; y: number; heading: number }]> = [];
		const process = (id: string, relative: { x: number; y: number }): void => {
			const pos: PlanarPoint = {
				x: relative.x / TRACK_SCALE,
				y: relative.y / TRACK_SCALE
			};
			const prev = this.capturedPrevPos.get(id) ?? pos;
			const fallback = this.capturedLastHeading.get(id) ?? 0;
			const heading = motionHeading(prev, pos, fallback);
			this.capturedPrevPos.set(id, pos);
			this.capturedLastHeading.set(id, heading);
			overrides.push([id, { x: pos.x, y: pos.y, heading }]);
		};
		for (const tp of sample.teamPlayers) if (tp.id) process(tp.id, tp.relative);
		for (const so of sample.skatingOfficials) if (so.id) process(so.id, so.relative);
		poseStore.setOverrides(overrides);

		// Apply heading to the Konva facing groups (reconcileTeamPlayers sets
		// positions only; applyEffectivePoses rotates the chevrons from the
		// override tier). draw=false on the composite steps so each layer is
		// drawn exactly once per replay frame.
		this.playerManager.applyEffectivePoses(false);
		this.packManager.determinePack(false);
		this.engagementZoneLayer.batchDraw();
		this.playersLayer.batchDraw();

		// Konva bakes the stage transform into each layer's canvas at draw
		// time, so the static stage-local layers (track, ghosts, annotations,
		// paths) must be redrawn whenever the view changes — but ONLY then.
		// A fixed-view replay no longer repaints the expensive track layers
		// every frame.
		this.redrawStaticLayersIfViewChanged();

		if (sample.pathFrame) this.renderPathFrame(sample.pathFrame);
	}

	/**
	 * Last stage transform that the static stage-local layers (track surface,
	 * track lines, ghosts, annotations) were drawn at. Konva bakes the stage
	 * transform into each layer's canvas at draw time, so these layers only
	 * need a repaint when the view actually changes — not every replay frame.
	 */
	private lastStaticTransform: { scale: number; x: number; y: number } | null = null;

	/** Redraws the static stage-local layers iff the stage transform changed. */
	private redrawStaticLayersIfViewChanged(): void {
		const scale = this.stage.scaleX();
		const x = this.stage.x();
		const y = this.stage.y();
		const t = this.lastStaticTransform;
		if (t && t.scale === scale && t.x === x && t.y === y) return;
		this.lastStaticTransform = { scale, x, y };
		this.trackSurfaceLayer.batchDraw();
		this.trackLinesLayer.batchDraw();
		this.ghostLayer.batchDraw();
		this.annotationLayer.batchDraw();
	}

	/**
	 * Renders the path overlay from a recorded PathFrame (used by replay and
	 * export so captured recordings include per-step paths). Renders ALL paths
	 * in the frame — the frame already represents the visual state captured at
	 * record time, so no overlay/selection filtering is applied.
	 *
	 * Lines are cached by path id and updated in place (points/stroke), so a
	 * replay frame with unchanged paths costs zero node allocations; only
	 * added/removed paths create/destroy nodes.
	 */
	renderPathFrame(frame: PathFrame | undefined): void {
		this.currentPathFrame = frame;
		if (!frame) {
			if (this.pathFrameLines.size > 0) {
				for (const line of this.pathFrameLines.values()) line.destroy();
				this.pathFrameLines.clear();
				this.pathLayer.batchDraw();
			}
			return;
		}

		const strokeWidth = Math.max(2, (PLAYER_RADIUS * 0.4) / this.stage.scaleX());
		const ghostStrokeWidth = Math.max(1.5, (PLAYER_RADIUS * 0.3) / this.stage.scaleX());
		const seen = new Set<string>();

		const upsertLine = (
			key: string,
			points: PlanarPoint[],
			opts: Konva.LineConfig,
			ghost: boolean
		): void => {
			const projected = this.smoothProject(points);
			if (!projected) return;
			seen.add(key);
			const flat = projected.flatMap((p) => [p.x, p.y]);
			const existing = this.pathFrameLines.get(key);
			if (existing) {
				existing.points(flat);
				existing.setAttrs(opts);
				if (ghost) existing.moveToBottom();
				return;
			}
			const line = new Konva.Line({
				points: flat,
				listening: false,
				...opts
			});
			this.pathFrameLines.set(key, line);
			this.pathLayer.add(line);
			if (ghost) line.moveToBottom();
		};

		const ghostOpts: Konva.LineConfig = {
			stroke: '#dc2626',
			strokeWidth: ghostStrokeWidth,
			dash: [6, 4],
			lineCap: 'round',
			lineJoin: 'round',
			opacity: 0.5
		};
		frame.prevPaths?.forEach((p) => upsertLine(`prev:${p.id}`, p.points, ghostOpts, true));
		frame.nextPaths?.forEach((p) => upsertLine(`next:${p.id}`, p.points, ghostOpts, true));

		for (const path of frame.paths) {
			upsertLine(
				`cur:${path.id}`,
				path.points,
				{
					stroke: this.trailColorFor(path.entityId),
					strokeWidth,
					tension: 0,
					opacity: 0.85
				},
				false
			);
		}

		// Remove lines whose path is no longer in the frame.
		for (const [key, line] of this.pathFrameLines) {
			if (!seen.has(key)) {
				line.destroy();
				this.pathFrameLines.delete(key);
			}
		}

		this.pathLayer.batchDraw();
	}

	/**
	 * Renders the selected entity's path from an adjacent step as a dashed
	 * ghost line, drawn behind the active step. In Select the path's editing
	 * nodes are added too; the line keeps its distinct muted colour.
	 */
	private renderGhostPath(
		step: Step | undefined,
		entityId: string,
		editable: boolean,
		adjacency: 'prev' | 'next'
	): void {
		const path = step?.paths?.find((p) => p.entityId === entityId);
		if (!path || !step) return;
		this.renderPathGeometry(step, path, '#dc2626', adjacency, editable);
	}

	/**
	 * Renders a single path: its line plus, when editable, control handles.
	 * `mode` is 'current' (active step), 'prev' or 'next' (adjacent ghosts);
	 * ghosts use the muted dashed line. Lines and handles are tagged with
	 * (stepId, pathId) so the drag handlers target the exact path on screen.
	 */
	private renderPathGeometry(
		step: Step,
		path: EntityPath,
		color: string,
		mode: 'current' | 'prev' | 'next',
		editable: boolean
	): void {
		const ghost = mode !== 'current';
		const renderPoints = path.points.map((p) => ({ ...p }));
		// Inject the entity's pose in this step as point 0 so the line always
		// starts at the skater — except for the previous-step ghost, whose first
		// node is a freely draggable control point (injecting would reset it to
		// the entity pose on every re-render).
		if (mode !== 'prev') {
			const startPose = step.entities.find((e) => e.id === path.entityId);
			if (startPose && renderPoints.length > 0) {
				renderPoints[0] = { x: startPose.x, y: startPose.y };
			}
		}

		const projectedPoints = this.smoothProject(renderPoints);
		if (!projectedPoints) return;

		const strokeWidth = ghost
			? Math.max(1.5, (PLAYER_RADIUS * 0.3) / this.stage.scaleX())
			: Math.max(2, (PLAYER_RADIUS * 0.4) / this.stage.scaleX());

		const line = new Konva.Line({
			name: 'lineShape',
			points: projectedPoints.flatMap((p) => [p.x, p.y]),
			stroke: color,
			strokeWidth,
			dash: ghost ? [6, 4] : undefined,
			lineCap: 'round',
			lineJoin: 'round',
			tension: 0,
			opacity: ghost ? 0.5 : 0.85,
			// Active-step lines are tappable so the erase tool can target them;
			// ghost (adjacent-step) lines are not (they aren't erasable).
			listening: !ghost
		});
		line.setAttr('stepId', step.id);
		line.setAttr('pathId', path.id);
		this.pathLayer.add(line);

		if (editable) {
			this.renderPathHandles(step, path, renderPoints, color, mode);
		}
	}

	/**
	 * Adds control handles for one path. Each draggable handle clamps its drag
	 * to the path's remaining length budget so a node can't push it past
	 * MAX_PATH_LENGTH_M. (Path deletion is handled by the erase tool.)
	 *
	 * `mode` shapes which nodes appear:
	 *  - current/next skip index 0 (anchored to a live position — the player,
	 *    or, for next, the current path's endpoint).
	 *  - prev instead skips its LAST index: that endpoint chains to the current
	 *    player, so a handle there would sit on (and hijack) the skater. Its
	 *    first node (index 0) has no live anchor, so it gets a regular draggable
	 *    handle (clamped only by its single segment to the next node).
	 */
	private renderPathHandles(
		step: Step,
		path: EntityPath,
		renderPoints: PlanarPoint[],
		color: string,
		mode: 'current' | 'prev' | 'next'
	): void {
		// Precompute metre-space positions and total length so each handle's
		// budget is cheap to derive. Only the dragged node's incident segment(s)
		// change during a drag.
		const metrePts = renderPoints.map((p) => ({ x: p.x, y: p.y }));
		let totalLen = 0;
		for (let k = 0; k < metrePts.length - 1; k++) {
			totalLen += Math.hypot(metrePts[k + 1].x - metrePts[k].x, metrePts[k + 1].y - metrePts[k].y);
		}

		// Previous step: draw a draggable handle at index 0 too (its start has
		// no live player anchoring it in the current view), but skip the last
		// index — that endpoint chains to the current player and is edited by
		// dragging the skater. Current/next skip index 0 (anchored to the
		// player / the current path's endpoint).
		const lo = mode === 'prev' ? 0 : 1;
		const hi = mode === 'prev' ? path.points.length - 1 : path.points.length;

		for (let i = lo; i < hi; i++) {
			const pt = renderPoints[i];
			const px = this.projectPoint(pt.x, pt.y);
			const handleRadius = Math.max(8, 10 / this.stage.scaleX());

			// aM is null for the path's first node (no previous neighbour).
			const aM = i > 0 ? metrePts[i - 1] : null;
			const bM = i < metrePts.length - 1 ? metrePts[i + 1] : null;
			const incidentStatic =
				(aM ? Math.hypot(metrePts[i].x - aM.x, metrePts[i].y - aM.y) : 0) +
				(bM ? Math.hypot(bM.x - metrePts[i].x, bM.y - metrePts[i].y) : 0);
			const budget = MAX_PATH_LENGTH_M - (totalLen - incidentStatic);

			const handle = new Konva.Circle({
				x: px.x,
				y: px.y,
				radius: handleRadius,
				fill: 'white',
				stroke: color,
				strokeWidth: 2,
				draggable: true,
				name: 'pathHandle',
				listening: true
			});
			handle.setAttr('pointIndex', i);
			handle.setAttr('pathId', path.id);
			handle.setAttr('stepId', step.id);

			// Hard-clamp the drag so the path can't exceed MAX_PATH_LENGTH_M.
			// `pos` arrives in the stage's absolute (content) coordinate space —
			// the same space as `stage.getPointerPosition()`, NOT the stage-local
			// space used by `projectPoint`. Konva's `_setDragPosition` passes the
			// pointer position (content space) to `dragBoundFunc` and then feeds
			// the return value to `setAbsolutePosition` (which also expects content
			// space). Without undoing the stage zoom/pan first (as `pointerToPlane`
			// does), the constraint circle is centred at the wrong point whenever
			// the stage is zoomed or panned — e.g. after a browser resize triggers
			// `fitToTrack` or `loadViewSettings`, making handle dragging appear
			// "completely inconsistent".
			handle.dragBoundFunc((pos) => {
				const center = this.getStageCenter();
				const scale = this.stage.scaleX();
				// Absolute → stage-local → world metres (mirrors `pointerToPlane`).
				const localX = (pos.x - this.stage.x()) / scale;
				const localY = (pos.y - this.stage.y()) / scale;
				const pM = {
					x: (localX - center.x) / TRACK_SCALE,
					y: (localY - center.y) / TRACK_SCALE
				};
				const c = clampNodeToBudget(aM, bM, pM, budget);
				// World metres → stage-local → absolute (inverse of above).
				return {
					x: this.stage.x() + (center.x + c.x * TRACK_SCALE) * scale,
					y: this.stage.y() + (center.y + c.y * TRACK_SCALE) * scale
				};
			});

			handle.on('dragmove', () => this.updatePathPreview(step, path));
			handle.on('dragend', () => this.commitPathChanges(step, path, get(selectedEntityId)));

			// Handles live on the top control layer so they stay grabbable even
			// where a path passes under a skater (e.g. a previous step's path,
			// whose endpoint chains to the current player's position).
			this.controlLayer.add(handle);
		}
	}

	/** Handles belonging to one path, filtered by step + path id. Handles live
	 * on the top controlLayer (above the players), so the lookup targets it. */
	private pathHandlesFor(stepId: string, pathId: string): Circle[] {
		return Array.from(this.controlLayer.find<Circle>('.pathHandle')).filter(
			(h) => h.getAttr('stepId') === stepId && h.getAttr('pathId') === pathId
		);
	}

	/** Removes just the path handles from the top control layer (leaving the
	 * direction/rotation controls untouched). */
	private clearPathHandles(): void {
		this.controlLayer.find('.pathHandle').forEach((h) => h.destroy());
	}

	/** The line shape for one path, filtered by step + path id. */
	private pathLineFor(stepId: string, pathId: string): Konva.Line | undefined {
		return Array.from(this.pathLayer.find<Konva.Line>('.lineShape')).find(
			(l) => l.getAttr('stepId') === stepId && l.getAttr('pathId') === pathId
		);
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
		// During replay, the path layer is managed by renderPathFrame (called
		// from renderSampleTransform). Bail out so the StepStrip Svelte
		// $effect (which fires when selectedEntityId is cleared on replay
		// start) can't destroyChildren and wipe the paths just drawn.
		if (this.replayMode) return;

		this.pathLayer.destroyChildren();
		this.pathFrameLines.clear();
		this.clearPathHandles();

		const editable = get(toolMode) === 'select';

		// Adjacent-step (ghost) paths for the selected entity, drawn first so
		// they sit behind the active step. In Select they get editing nodes too.
		if (selectedEntityId) {
			this.renderGhostPath(prevStep, selectedEntityId, editable, 'prev');
			this.renderGhostPath(nextStep, selectedEntityId, editable, 'next');
		}

		if (!step?.paths) {
			this.currentPathFrame = undefined;
			this.pathLayer.batchDraw();
			this.controlLayer.batchDraw();
			return;
		}

		const overlayMode = get(boardSettings).pathOverlay ?? 'off';

		for (const path of step.paths) {
			const shouldRender =
				path.entityId === selectedEntityId ||
				overlayMode === 'all' ||
				(overlayMode === 'selected' && path.entityId === selectedEntityId);

			if (!shouldRender) continue;

			// Handles only for the selected entity's own path on the active step.
			this.renderPathGeometry(
				step,
				path,
				this.trailColorFor(path.entityId),
				'current',
				editable && path.entityId === selectedEntityId
			);
		}

		// Cache the full step path data for getSnapshot() so a recording
		// captures the exact step currently being visualised (not whatever
		// the document's active step happens to be).
		const toEntries = (s: Step | undefined) =>
			s?.paths?.map((p) => ({ id: p.id, entityId: p.entityId, points: p.points }));
		this.currentPathFrame = {
			paths: step.paths.map((p) => ({ id: p.id, entityId: p.entityId, points: p.points })),
			selectedEntityId,
			prevPaths: toEntries(prevStep),
			nextPaths: toEntries(nextStep)
		};

		this.pathLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/**
	 * Renders annotations for a step. With step undefined (Free Play) only
	 * board-wide marks are shown; a step-scoped mark (scope.stepId) appears only
	 * on its own step (decision #6: visible iff `!scope || scope.stepId ===
	 * activeStep?.id`). Each visible mark is wrapped in a hittable Group (name
	 * `annotation`, attr `annId`) so Select can target it; a dashed selection
	 * ring for the currently selected mark is drawn on the top control layer.
	 */
	renderAnnotations(step: Step | undefined): void {
		this.annotationLayer.destroyChildren();

		const activeStepId = step?.id;
		const visible = (boardDoc.current.annotations ?? []).filter(
			(ann) => !ann.scope || ann.scope.stepId === activeStepId
		);

		const selectedId = get(selectedAnnotationId);
		let selectedAnn: Annotation | undefined;

		for (const ann of visible) {
			const group = new Konva.Group({ name: 'annotation', listening: true });
			group.setAttr('annId', ann.id);
			this.appendAnnotationShapes(group, ann, effectiveAnchors(ann));
			this.annotationLayer.add(group);
			if (ann.id === selectedId) selectedAnn = ann;
		}

		// Selection box + handles on the top control layer — Select tool only.
		this.renderAnnotationSelection(selectedAnn);

		this.annotationLayer.batchDraw();
		this.controlLayer.batchDraw();
	}

	/** Draws one annotation's shapes into `group` from effective (transformed)
	 * anchor points. Shared by renderAnnotations and the live gesture redraw. */
	private appendAnnotationShapes(group: Konva.Group, ann: Annotation, eff: PlanarPoint[]): void {
		const stroke = ann.style.color;
		const width = ann.style.width ?? 2;
		switch (ann.kind) {
			case 'pen': {
				const points = this.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				break;
			}
			case 'arrow': {
				const points = this.projectSmoothed(eff, false).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				// Draw arrowhead at the end, pointing in the direction of the last segment
				if (eff.length >= 2) {
					const last = this.projectPoint(eff[eff.length - 1].x, eff[eff.length - 1].y);
					const prev = this.projectPoint(eff[eff.length - 2].x, eff[eff.length - 2].y);
					const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
					const headLength = 15;
					const base1 = {
						x: last.x - headLength * Math.cos(angle - 0.5),
						y: last.y - headLength * Math.sin(angle - 0.5)
					};
					const base2 = {
						x: last.x - headLength * Math.cos(angle + 0.5),
						y: last.y - headLength * Math.sin(angle + 0.5)
					};
					group.add(
						new Konva.Line({
							points: [last.x, last.y, base1.x, base1.y, base2.x, base2.y, last.x, last.y],
							fill: stroke,
							stroke,
							strokeWidth: width,
							closed: true,
							tension: 0,
							hitStrokeWidth: 12,
							listening: true
						})
					);
				}
				break;
			}
			case 'zone': {
				const points = this.projectSmoothed(eff, true).flatMap((p) => [p.x, p.y]);
				group.add(
					new Konva.Line({
						points,
						stroke,
						strokeWidth: width,
						lineCap: 'round',
						lineJoin: 'round',
						tension: 0,
						closed: true,
						fill: stroke,
						opacity: 0.15,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				break;
			}
			case 'label': {
				const atPx = this.projectPoint(eff[0].x, eff[0].y);
				const fontSize = Math.max(12, 14 / this.stage.scaleX());
				const estimatedWidth = Math.max(100, ann.text.length * fontSize * 0.6);
				group.add(
					new Konva.Rect({
						x: atPx.x - 4,
						y: atPx.y - fontSize + 4,
						width: estimatedWidth + 8,
						height: fontSize + 8,
						fill: 'rgba(255,255,255,0.8)',
						listening: true
					})
				);
				group.add(
					new Konva.Text({
						x: atPx.x,
						y: atPx.y,
						text: ann.text,
						fontSize,
						fontFamily: 'Arial',
						fill: stroke,
						listening: false
					})
				);
				break;
			}
			case 'gap': {
				const fromPx = this.projectPoint(eff[0].x, eff[0].y);
				const toPx = this.projectPoint(eff[1].x, eff[1].y);
				const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
				const tickOffset = 8;
				group.add(
					new Konva.Line({
						points: [fromPx.x, fromPx.y, toPx.x, toPx.y],
						stroke,
						strokeWidth: width,
						dash: [8, 8],
						tension: 0,
						hitStrokeWidth: 12,
						listening: true
					})
				);
				for (const t of [fromPx, toPx]) {
					const t1 = {
						x: t.x + tickOffset * Math.cos(angle + Math.PI / 2),
						y: t.y + tickOffset * Math.sin(angle + Math.PI / 2)
					};
					const t2 = {
						x: t.x + tickOffset * Math.cos(angle - Math.PI / 2),
						y: t.y + tickOffset * Math.sin(angle - Math.PI / 2)
					};
					group.add(
						new Konva.Line({
							points: [t1.x, t1.y, t2.x, t2.y],
							stroke,
							strokeWidth: width,
							tension: 0,
							hitStrokeWidth: 12,
							listening: true
						})
					);
				}
				break;
			}
		}
	}

	/** The annotation group on the annotation layer for a given id, if present. */
	private annotationGroupFor(annId: string): Konva.Group | undefined {
		return Array.from(this.annotationLayer.find<Konva.Group>('.annotation')).find(
			(g) => g.getAttr('annId') === annId
		);
	}

	/** Live redraw of a single annotation from a working transform (gesture). */
	private redrawAnnotationOnly(annId: string, ann: Annotation, t: AnnotationTransform): void {
		const group = this.annotationGroupFor(annId);
		if (!group) return;
		group.destroyChildren();
		this.appendAnnotationShapes(group, ann, effectiveAnchors(ann, t));
		this.annotationLayer.batchDraw();
	}

	/**
	 * Draws the selection affordance for an annotation on the control layer:
	 * an oriented thin-line box (also the move grab) with four corner resize
	 * handles and one rotation handle above the top edge. Select-tool only;
	 * labels get a simple non-interactive ring (they are move-only via the
	 * annotation body, not yet transformable).
	 */
	private renderAnnotationSelection(ann: Annotation | undefined): void {
		this.controlLayer.find('.annotationSelection').forEach((n) => n.destroy());
		if (!ann || get(toolMode) !== 'select') return;

		const scale = this.stage.scaleX() || 1;
		const sel = new Konva.Group({ name: 'annotationSelection', listening: true });
		this.controlLayer.add(sel);

		if (ann.kind === 'label') {
			const atPx = this.projectPoint(effectiveAnchors(ann)[0].x, effectiveAnchors(ann)[0].y);
			const fontSize = Math.max(12, 14 / scale);
			const w = Math.max(100, ann.text.length * fontSize * 0.6) + 8;
			const h = fontSize + 8;
			sel.add(
				new Konva.Rect({
					x: atPx.x - 4,
					y: atPx.y - fontSize + 4,
					width: w,
					height: h,
					stroke: '#0ea5e9',
					strokeWidth: 2 / scale,
					dash: [4, 4],
					listening: false
				})
			);
			this.controlLayer.batchDraw();
			return;
		}

		const xform = resolvedTransform(ann);
		const corners = boxCorners(ann, xform).map((p) => this.projectPoint(p.x, p.y));
		const { hw, hh } = halfSizes(ann, xform);
		const centerPx = this.projectPoint(xform.cx, xform.cy);
		const boxW = Math.max(hw, MIN_HALF) * 2 * TRACK_SCALE;
		const boxH = Math.max(hh, MIN_HALF) * 2 * TRACK_SCALE;

		// Continuous thin-line box, also the move grab. The fill is fully
		// transparent (not coloured) yet still hittable — Konva's hit canvas
		// fills the region with the shape's hit key whenever a fill is set,
		// independent of its alpha.
		const box = new Konva.Rect({
			x: centerPx.x,
			y: centerPx.y,
			width: boxW,
			height: boxH,
			offsetX: boxW / 2,
			offsetY: boxH / 2,
			rotation: (xform.angle * 180) / Math.PI,
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			fill: 'rgba(0,0,0,0)',
			listening: true
		});
		sel.add(box);
		box.on('pointerdown', (e) => this.startAnnotationGesture('move', ann, e));

		// Four corner resize handles (circles). boxCorners order: ++, -+, --, +-.
		const signs: Array<[number, number]> = [
			[1, 1],
			[-1, 1],
			[-1, -1],
			[1, -1]
		];
		corners.forEach((c, i) => {
			const handle = new Konva.Circle({
				x: c.x,
				y: c.y,
				radius: Math.max(6, 8 / scale),
				fill: 'white',
				stroke: '#0ea5e9',
				strokeWidth: 2 / scale,
				listening: true
			});
			sel.add(handle);
			const [su, sv] = signs[i];
			handle.on('pointerdown', (e) => this.startAnnotationGesture('resize', ann, e, su, sv));
		});

		// Rotation handle: centred above the top edge.
		const rotOffsetPlane = 22 / (TRACK_SCALE * scale);
		const rot = this.projectPoint(
			rotateHandlePos(ann, rotOffsetPlane, xform).x,
			rotateHandlePos(ann, rotOffsetPlane, xform).y
		);
		const rotHandle = new Konva.Circle({
			x: rot.x,
			y: rot.y,
			radius: Math.max(6, 8 / scale),
			fill: 'white',
			stroke: '#0ea5e9',
			strokeWidth: 2 / scale,
			listening: true
		});
		sel.add(rotHandle);
		rotHandle.on('pointerdown', (e) => this.startAnnotationGesture('rotate', ann, e));

		this.controlLayer.batchDraw();
	}

	/** Begins a move/resize/rotate gesture for an annotation. */
	private startAnnotationGesture(
		type: 'move' | 'resize' | 'rotate',
		ann: Annotation,
		e: Konva.KonvaEventObject<unknown>,
		su = 0,
		sv = 0
	): void {
		if (get(toolMode) !== 'select') return;
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		const b = baseBox(ann);
		this.annotationGesture = {
			type,
			annId: ann.id,
			ann,
			baseHw: b.hw,
			baseHh: b.hh,
			start: resolvedTransform(ann),
			startPointer: this.pointerToPlane(pos),
			su,
			sv
		};
		e.cancelBubble = true;
	}

	/** Pending rAF for the coalesced annotation-gesture redraw. */
	private annotationGestureRafId: number | null = null;

	private scheduleAnnotationGestureUpdate(): void {
		if (this.annotationGestureRafId !== null) return;
		this.annotationGestureRafId = requestAnimationFrame(() => {
			this.annotationGestureRafId = null;
			this.updateAnnotationGesture();
		});
	}

	/** Applies the live transform during a drag and redraws the mark + box. */
	private updateAnnotationGesture(): void {
		const g = this.annotationGesture;
		if (!g) return;
		const pos = this.stage.getPointerPosition();
		if (!pos) return;
		const t = this.gestureTransform(g, this.pointerToPlane(pos));

		if (g.type === 'move') {
			// Cheap path: a move is a uniform translation, so just offset the
			// existing nodes (they're built at origin) instead of destroying
			// and rebuilding every shape — and the selection box with its five
			// handles — on every frame of the drag.
			const dx = (t.cx - g.start.cx) * TRACK_SCALE;
			const dy = (t.cy - g.start.cy) * TRACK_SCALE;
			this.annotationGroupFor(g.annId)?.position({ x: dx, y: dy });
			this.controlLayer.findOne('.annotationSelection')?.position({ x: dx, y: dy });
			this.annotationLayer.batchDraw();
			this.controlLayer.batchDraw();
			return;
		}

		// Resize/rotate change the geometry: rebuild the mark and box.
		this.redrawAnnotationOnly(g.annId, g.ann, t);
		this.renderAnnotationSelection({ ...g.ann, transform: t });
	}

	/** Commits the gesture's final transform (one undo entry) and re-renders. */
	private commitAnnotationGesture(): void {
		if (this.annotationGestureRafId !== null) {
			cancelAnimationFrame(this.annotationGestureRafId);
			this.annotationGestureRafId = null;
		}
		const g = this.annotationGesture;
		this.annotationGesture = null;
		this.lastGestureEnd = Date.now();
		if (!g) return;
		const pos = this.stage.getPointerPosition();
		const t = pos ? this.gestureTransform(g, this.pointerToPlane(pos)) : g.start;
		if (this.transformsDiffer(t, g.start)) {
			setAnnotationTransform(g.annId, t);
		}
		this.renderAnnotations(this.getActiveStep());
	}

	/** Computes the transform for the active gesture from the live pointer. */
	private gestureTransform(
		g: NonNullable<KonvaGame['annotationGesture']>,
		pointer: PlanarPoint
	): AnnotationTransform {
		if (g.type === 'move') {
			return moveTransform(g.start, {
				x: pointer.x - g.startPointer.x,
				y: pointer.y - g.startPointer.y
			});
		}
		if (g.type === 'resize') {
			return resizeTransform(g.start, g.baseHw, g.baseHh, g.su, g.sv, pointer);
		}
		return rotateTransform(g.start, { x: g.start.cx, y: g.start.cy }, g.startPointer, pointer);
	}

	private transformsDiffer(a: AnnotationTransform, b: AnnotationTransform): boolean {
		return a.cx !== b.cx || a.cy !== b.cy || a.angle !== b.angle || a.sx !== b.sx || a.sy !== b.sy;
	}

	// Thin, elongated crosshair cursor for drawing tools (pen, arrow, zone, label, gap, drawPath).
	// 32x32 SVG with 28px arms, 1px stroke, centered hotspot at (16,16).
	private readonly CROSSHAIR_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><line x1="2" y1="16" x2="30" y2="16" stroke="%230f172a" stroke-width="1"/><line x1="16" y1="2" x2="16" y2="30" stroke="%230f172a" stroke-width="1"/></svg>') 16 16, crosshair`;

	// Eraser cursor: small circle matching the canvas background color.
	// 16x16 SVG with 7px diameter circle, 1px stroke, centered hotspot at (8,8).
	private readonly ERASE_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.25" fill="%23f0f0f0" stroke="%230f172a" stroke-width="0.75"/></svg>') 12 12, auto`;

	/** Updates the OS cursor based on the active tool.
	 * - Erase tool: shows eraser circle cursor
	 * - Drawing tools: shows crosshair cursor
	 * - Other tools: default cursor */
	private updateEraseCursor(): void {
		const tool = get(toolMode);
		const el = this.stage.container();
		if (!el) return;

		if (tool === 'erase' && !this.replayMode) {
			el.style.cursor = this.ERASE_CURSOR;
		} else if (isDrawingTool(tool) && !this.replayMode) {
			el.style.cursor = this.CROSSHAIR_CURSOR;
		} else {
			el.style.cursor = '';
		}
	}

	/**
	 * Renders onion-skin ghosts of neighbouring steps.
	 * Ghosts are translucent circles at each entity's pose.
	 */
	renderOnionSkin(prevStep: Step | undefined, nextStep: Step | undefined, depth: number): void {
		this.ghostLayer.destroyChildren();

		const renderGhosts = (step: Step | undefined, offset: number) => {
			if (!step) return;

			const group = new Konva.Group({ listening: false });
			const opacity = depth >= 2 && Math.abs(offset) === 2 ? 0.12 : 0.25;

			for (const pose of step.entities) {
				const center = this.getStageCenter();
				const cx = center.x + pose.x * TRACK_SCALE;
				const cy = center.y + pose.y * TRACK_SCALE;

				const color = this.trailColorFor(pose.id);

				group.add(
					new Konva.Circle({
						x: cx,
						y: cy,
						radius: PLAYER_RADIUS,
						fill: color,
						opacity,
						stroke: 'black',
						strokeWidth: 1,
						listening: false
					})
				);
			}

			this.ghostLayer.add(group);
		};

		// ±1 always available
		renderGhosts(prevStep, -1);
		renderGhosts(nextStep, 1);

		// ±2 when depth >= 2
		if (depth >= 2) {
			renderGhosts(undefined, -2); // Placeholder for deeper prev
			renderGhosts(undefined, 2); // Placeholder for deeper next
		}

		this.ghostLayer.batchDraw();
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

		if (settings.onionSkin && !this.authoredPlayback) {
			if (prevStep || nextStep) {
				this.renderOnionSkin(prevStep, nextStep, settings.onionSkinDepth ?? 1);
			}
		} else {
			this.ghostLayer.destroyChildren();
			this.ghostLayer.batchDraw();
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
	 * Helper to create an annotation. Annotations are always board-wide on
	 * creation (no scope); pin one to a step afterwards via setAnnotationScope.
	 */
	private createAnnotation(ann: Annotation): void {
		addAnnotation(ann as Annotation & { id?: string });
	}

	/**
	 * Helper to set an entity path on the active step.
	 */
	private setEntityPath(stepId: string, entityId: string, points: PlanarPoint[]): void {
		setEntityPath(stepId, entityId, points);
	}

	/**
	 * Updates the path preview during handle drag. Reads handle positions from
	 * the layer, preserving index 0 (entity pose, no handle) from stored points.
	 */
	private updatePathPreview(step: Step, path: EntityPath): void {
		const handles = this.pathHandlesFor(step.id, path.id);
		if (handles.length === 0) return;

		// Start from stored points so index 0 (entity pose) is preserved.
		const newPoints: PlanarPoint[] = path.points.map((p) => ({ ...p }));

		// Inject the entity's pose in THIS step as the first point.
		const entityPose = step.entities.find((e) => e.id === path.entityId);
		if (entityPose && newPoints.length > 0) {
			newPoints[0] = { x: entityPose.x, y: entityPose.y };
		}

		// Overlay handle positions for indices 1..N.
		const center = this.getStageCenter();
		handles.forEach((handle) => {
			const pointIndex = handle.getAttr('pointIndex');
			newPoints[pointIndex] = {
				x: (handle.x() - center.x) / TRACK_SCALE,
				y: (handle.y() - center.y) / TRACK_SCALE
			};
		});

		// Re-render this path's line (batchDrawn — renders before the next
		// paint, so it still tracks the handle every move).
		this.redrawPathLine(step.id, path.id, newPoints);

		// The active step's endpoint chains to the next step's start (index 0),
		// so the two share a node. Keep the next step's line in sync live too —
		// otherwise the shared node only jumps into place on drop.
		const active = this.getActiveStep();
		if (active && step.id === active.id && newPoints.length >= 2) {
			const { nextStep } = this.getAdjacentSteps();
			const nextPath = nextStep?.paths?.find((p) => p.entityId === path.entityId);
			if (nextStep && nextPath) {
				const nextPoints = nextPath.points.map((p) => ({ ...p }));
				nextPoints[0] = { ...newPoints[newPoints.length - 1] };
				this.redrawPathLine(nextStep.id, nextPath.id, nextPoints);
			}
		}
	}

	/** Re-projects `points` and redraws the line for one path. */
	private redrawPathLine(stepId: string, pathId: string, points: PlanarPoint[]): void {
		const line = this.pathLineFor(stepId, pathId);
		if (!line || points.length < 2) return;
		const projected = this.smoothProject(points);
		if (projected) {
			line.points(projected.flatMap((p) => [p.x, p.y]));
			// batchDraw, not draw(): dragmove can fire several times per frame
			// (coalesced touch events), and each synchronous draw() was a
			// blocking full-layer repaint. batchDraw still renders before the
			// next paint, so the line tracks the pointer without lag.
			this.pathLayer.batchDraw();
		}
	}

	/**
	 * Live-updates the path lines anchored to a skater while the skater is
	 * dragged. The current step's path starts at the skater (index 0), and the
	 * previous step's path ends at it (the endpoint chains to this pose). Both
	 * are redrawn with `poseMetres` so they track the drag instead of waiting
	 * for the drop commit.
	 */
	private updatePathsForEntityPose(entityId: string, poseMetres: PlanarPoint): void {
		const active = this.getActiveStep();
		if (!active) return;

		// Current step: index 0 (start) is the skater's live pose.
		const curPath = active.paths?.find((p) => p.entityId === entityId);
		if (curPath && curPath.points.length >= 2) {
			const pts = curPath.points.map((p) => ({ ...p }));
			pts[0] = { ...poseMetres };
			this.redrawPathLine(active.id, curPath.id, pts);
		}

		// Previous-step ghost lines are only rendered for the SELECTED entity
		// (see renderPaths), so the adjacent-step lookup — and its two doc
		// reads — is skipped for every other dragged skater.
		if (entityId !== get(selectedEntityId)) return;

		// Previous step: its endpoint chains to this skater. Index 0 is the prev
		// path's own stored start (not injected — see renderPathGeometry), so we
		// only override the endpoint to follow the drag.
		const { prevStep } = this.getAdjacentSteps();
		const prevPath = prevStep?.paths?.find((p) => p.entityId === entityId);
		if (prevStep && prevPath && prevPath.points.length >= 2) {
			const pts = prevPath.points.map((p) => ({ ...p }));
			pts[pts.length - 1] = { ...poseMetres };
			this.redrawPathLine(prevStep.id, prevPath.id, pts);
		}
	}

	/**
	 * Commits path changes after drag ends. Preserves index 0 from stored
	 * points (entity pose, no handle) and writes handle positions for 1..N.
	 */
	private commitPathChanges(step: Step, path: EntityPath, selectedEntityId: string | null): void {
		const handles = this.pathHandlesFor(step.id, path.id);
		if (handles.length === 0) return;

		const newPoints: PlanarPoint[] = path.points.map((p) => ({ ...p }));

		// Inject the entity's pose in THIS step as the first point.
		const entityPose = step.entities.find((e) => e.id === path.entityId);
		if (entityPose && newPoints.length > 0) {
			newPoints[0] = { x: entityPose.x, y: entityPose.y };
		}

		const center = this.getStageCenter();
		handles.forEach((handle) => {
			const pointIndex = handle.getAttr('pointIndex');
			newPoints[pointIndex] = {
				x: (handle.x() - center.x) / TRACK_SCALE,
				y: (handle.y() - center.y) / TRACK_SCALE
			};
		});

		// Commit to the edited step (which may be an adjacent/ghost step).
		this.setEntityPath(step.id, path.entityId, newPoints);

		// Re-render anchored on the active step so prev/current/next realign.
		const active = this.getActiveStep();
		const { prevStep, nextStep } = this.getAdjacentSteps();
		this.renderPaths(active, selectedEntityId, prevStep, nextStep);
	}

	/**
	 * Projects a planar world-metre point to viewport (screen) pixels through
	 * the current stage pan/zoom. Used by the DOM HUD overlays, which track
	 * positions per frame but compute everything else reactively.
	 */
	planeToScreen(p: PlanarPoint): { x: number; y: number } {
		const center = this.getStageCenter();
		const scale = this.stage.scaleX();
		return {
			x: this.stage.x() + (center.x + p.x * TRACK_SCALE) * scale,
			y: this.stage.y() + (center.y + p.y * TRACK_SCALE) * scale
		};
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

export function hudLabel(entity: Entity): string {
	if (entity.kind === 'skater' && entity.team) {
		return `${entity.team} ${ROLE_LABELS[entity.role] ?? entity.role}`;
	}
	return ROLE_LABELS[entity.role] ?? entity.role;
}
