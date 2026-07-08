import type Konva from 'konva';
import type { Watermark } from '../Watermark';
import type { OutputSpec } from '$lib/utils/recording';

/**
 * A rectangular selection in viewport CSS pixels. `w/h` must match the output
 * aspect ratio (the overlay enforces this) so the region maps 1:1 onto the output.
 */
export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface FrameRequest {
	stage: Konva.Stage;
	/** Context of the persistent capture canvas; engines draw one frame into it. */
	ctx: CanvasRenderingContext2D;
	output: OutputSpec;
	/** null for full-frame recording. */
	region: Region | null;
	watermark?: Watermark;
	/** Scaling factor used only in full-frame mode. */
	scalingFactor: number;
}

/**
 * A rendering strategy for the recorder. Engines render the live stage into the
 * capture canvas each frame. Phase 3 ships `ToCanvasEngine`; a clone-based engine
 * is a future optimization implementing the same interface.
 */
export interface RecorderEngine {
	/** Prepare internal buffers for a take (e.g. build a clone stage). Called at record start. */
	prepare(stage: Konva.Stage, output: OutputSpec, region: Region | null): void;
	/** Draw one frame into the capture canvas. */
	renderFrame(req: FrameRequest): void;
	destroy(): void;
}
