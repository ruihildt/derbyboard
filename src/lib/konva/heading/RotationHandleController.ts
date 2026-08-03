import { get } from 'svelte/store';
import Konva from 'konva';

import { colors, PLAYER_RADIUS, TRACK_SCALE } from '$lib/constants';
import { boardDoc } from '$lib/doc/store';
import { poseStore } from '$lib/doc/poses';
import { selectedEntityId, directionControlActive } from '$lib/stores/selection';
import { trackLayer } from '$lib/track/trackLayer';
import type { HeadingMode } from '$lib/doc/types';
import type { BoardProjection } from '../paths/projection';

/** Heading operations the controller needs from the player manager. */
export interface HeadingSource {
	setHeadingFor(id: string, rad: number): void;
	resolvedHeadingFor(id: string): number | null;
}

/** Normalises an angle to (-π, π]. */
function normalizeAngle(a: number): number {
	let x = ((a + Math.PI) % (2 * Math.PI)) - Math.PI;
	if (x <= -Math.PI) x += 2 * Math.PI;
	return x;
}

/**
 * Rotation handle for manual heading (P4 task 7): a standalone draggable
 * knob positioned at `center + R·(cos h, sin h)` over the selected entity,
 * plus the dashed guide line from the skater's rim to the knob. Not a child
 * of the playerGroup so rotation never moves the entity.
 *
 * Double-click cycles the direction mode (relative → pinned → fixed);
 * dragging rotates the facing without changing the mode. Shown only while
 * the direction control is active and hidden during playback/replay.
 */
export class RotationHandleController {
	private rotationHandle: Konva.Group | null = null;
	/** Thin dashed guide line between the facing marker and the direction knob. */
	private directionLine: Konva.Line | null = null;
	/** Mode icons rendered on the knob (auto/relative vs locked). */
	private knobAutoMark: Konva.Text | null = null;
	private knobPinMark: Konva.Group | null = null;
	private knobLockMark: Konva.Group | null = null;

	constructor(
		private controlLayer: Konva.Layer,
		private projection: BoardProjection,
		private playerManager: HeadingSource,
		private isReplayMode: () => boolean
	) {
		this.build();
	}

	private build(): void {
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

			const center = this.projection.stageCenter();
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
			const center = this.projection.stageCenter();
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
			this.update();
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

		const center = this.projection.stageCenter();
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
		this.update();
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
	update(headingHint: number | null = null): void {
		const selectedId = get(selectedEntityId);
		const active = get(directionControlActive);
		if (!selectedId || this.isReplayMode() || !active) {
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

		const center = this.projection.stageCenter();
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

	/** Destroys the knob and guide line nodes (owner teardown). */
	destroy(): void {
		this.rotationHandle?.destroy();
		this.directionLine?.destroy();
	}
}
