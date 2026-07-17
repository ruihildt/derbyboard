import Konva from 'konva';
import type { OutputSpec } from '$lib/utils/recording';
import type { FrameRequest, RecorderEngine } from './types';

interface NodePair {
	src: Konva.Node;
	dst: Konva.Node;
}

/**
 * Optimization counterpart to {@link ToCanvasEngine}. Mirrors the display stage into a
 * clone stage sized to the output resolution and re-renders only that each frame.
 *
 * Correctness relies on two things the original recorder got wrong:
 *  - syncing the FULL attribute set (positions, fills, engagement-zone path data, …)
 *    via getAttrs/setAttrs across a paired node tree, and
 *  - drawing clone layers immediately (layer.draw(), not the deferred batchDraw()).
 *
 * Experimental: verify output in a browser before relying on it.
 */
export class CloneTransformEngine implements RecorderEngine {
	private cloneStage: Konva.Stage | null = null;
	private pairs: NodePair[] = [];

	prepare(stage: Konva.Stage, output: OutputSpec): void {
		this.destroy();

		const cloneStage = new Konva.Stage({
			container: document.createElement('div'),
			width: output.w,
			height: output.h
		});

		// Clone each display layer 1:1; the stage transform carries all scaling.
		stage.getLayers().forEach((layer) => {
			const cloneLayer = layer.clone();
			cloneStage.add(cloneLayer);
			// Force a 1:1 backing store so clone canvases match the output resolution.
			cloneLayer.getCanvas().setPixelRatio(1);
		});
		this.cloneStage = cloneStage;

		// Pair up display/clone nodes for per-frame attribute sync.
		this.pairs = [];
		stage.getLayers().forEach((layer, i) => {
			this.collectPairs(layer, cloneStage.getLayers()[i]);
		});
	}

	private collectPairs(src: Konva.Node, dst: Konva.Node): void {
		if (!(src instanceof Konva.Container) || !(dst instanceof Konva.Container)) return;
		const srcChildren = src.getChildren();
		const dstChildren = dst.getChildren();
		for (let i = 0; i < srcChildren.length && i < dstChildren.length; i++) {
			this.pairs.push({ src: srcChildren[i], dst: dstChildren[i] });
			this.collectPairs(srcChildren[i], dstChildren[i]);
		}
	}

	renderFrame({ stage, ctx, output, region, watermark }: FrameRequest): void {
		const cloneStage = this.cloneStage;
		if (!cloneStage) return;

		// Map the selected viewport area onto the output canvas (full-frame mirrors 1:1).
		if (region) {
			const k = output.w / region.w;
			const s = stage.scaleX();
			cloneStage.scale({ x: s * k, y: s * k });
			cloneStage.position({
				x: (stage.x() - region.x) * k,
				y: (stage.y() - region.y) * k
			});
		} else {
			cloneStage.scale(stage.scale());
			cloneStage.position(stage.position());
		}

		// Sync live attributes (movement, pack colors, engagement-zone path, …).
		for (const { src, dst } of this.pairs) {
			dst.setAttrs(src.getAttrs());
		}

		// Render immediately (draw, not batchDraw), then composite into the capture canvas.
		cloneStage.getLayers().forEach((layer) => layer.draw());
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, output.w, output.h);
		cloneStage.getLayers().forEach((layer) => {
			ctx.drawImage(layer.getNativeCanvasElement(), 0, 0);
		});

		if (watermark) {
			watermark.draw(ctx, output.w, output.h);
		}
	}

	destroy(): void {
		this.pairs = [];
		this.cloneStage?.destroy();
		this.cloneStage = null;
	}
}
