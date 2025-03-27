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

	private recorder: KonvaRecorder;

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

		this.playerManager.initialLoad();
		this.packManager.determinePack();
		this.playersLayer.batchDraw();

		// Add window resize handler
		window.addEventListener('resize', this.handleResize);

		// Add stage-wide event listener for interaction end
		this.stage.on('mouseup touchend', () => {
			this.packManager.determinePack();
			this.playersLayer.batchDraw();
		});

		this.recorder = new KonvaRecorder(
			this.stage
			// {
			// x: this.width * 0.25, // Start at 25% from left
			// y: this.height * 0.25, // Start at 25% from top
			// width: this.width * 0.5, // Take 50% of width
			// height: this.height * 0.5 // Take 50% of height
			// }
		);
	}

	destroy() {
		this.recorder.destroy();
		window.removeEventListener('resize', this.handleResize);
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

	private handleResize = () => {
		// Get current center point
		const centerX = this.stage.width() / 2;
		const centerY = this.stage.height() / 2;

		// Get current scale and position
		const oldScale = this.stage.scaleX();
		const oldPosition = this.stage.position();

		// Calculate relative position of center in world coordinates
		const worldX = (centerX - oldPosition.x) / oldScale;
		const worldY = (centerY - oldPosition.y) / oldScale;

		// Update stage size
		this.stage.width(window.innerWidth);
		this.stage.height(window.innerHeight);

		// Calculate new center
		const newCenterX = this.stage.width() / 2;
		const newCenterY = this.stage.height() / 2;

		// Set new position to maintain world point at center
		this.stage.position({
			x: newCenterX - worldX * oldScale,
			y: newCenterY - worldY * oldScale
		});

		// Listen for transform completion before updating state
		this.stage.on('transformend', () => {
			this.stage.batchDraw();
			this.updatePersistedState();
		});
	};

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
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		// Calculate relative position from center
		const relativeX = this.stage.x() / centerX;
		const relativeY = this.stage.y() / centerY;

		const teamPlayers = this.playerManager.getTeamPlayers().map((player) => {
			const pos = player.getPosition();
			return {
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

	resetBoard() {
		// Clear existing players and layers
		this.playersLayer.destroyChildren();
		this.engagementZoneLayer.destroyChildren();

		// Reset stage position and scale
		this.stage.position({ x: 0, y: 0 });
		this.stage.scale({ x: BASE_ZOOM, y: BASE_ZOOM });

		// Clear internal arrays in PlayerManager
		this.playerManager = new KonvaPlayerManager(this.playersLayer, this.trackGeometry);

		// Reset persisted state
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

		// Add fresh lineup
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
		this.updatePersistedState();
	}

	startRecording() {
		this.recorder.startRecording();
	}

	stopRecording(): Promise<Blob> {
		return this.recorder.stopRecording();
	}

	exportAsImage(pixelRatio = 2): string {
		return this.stage.toDataURL({ pixelRatio });
	}
}
