import { describe, it, expect } from 'vitest';
import type Konva from 'konva';

import { drawStartsOnTarget } from './DrawingToolController';

/**
 * Minimal fake Konva node exposing only the surface `drawStartsOnTarget`
 * exercises: a `names` set, a `parent` chain, and a `findAncestors(selector,
 * includeSelf)` that walks that chain matching the leading-dot name. This
 * mirrors Konva's real selector behaviour (`.name` matches a node name) while
 * keeping the test canvas-free. See CollisionSystem.test.ts for the same
 * stub-only approach.
 */
interface FakeNode {
	names: Set<string>;
	parent: FakeNode | null;
	findAncestors(selector: string, includeSelf?: boolean): FakeNode[];
}

function makeNode(names: string[] = [], parent: FakeNode | null = null): FakeNode {
	const node: FakeNode = {
		names: new Set(names),
		parent,
		findAncestors(selector: string, includeSelf = false): FakeNode[] {
			const want = selector.startsWith('.') ? selector.slice(1) : selector;
			const out: FakeNode[] = [];
			let current: FakeNode | null = includeSelf ? this : this.parent;
			while (current) {
				if (current.names.has(want)) out.push(current);
				current = current.parent;
			}
			return out;
		}
	};
	return node;
}

describe('drawStartsOnTarget', () => {
	// Regression: drawing tools (pen/arrow/zone/gap/label/drawPath) could not
	// START over a player because the pointerdown guard omitted `playerGroup`
	// from its passthrough set. With a drawing tool armed, players are
	// non-draggable (entitiesEnabled=false), so a pointerdown on a skater must
	// fall through to drawing instead of being silently swallowed.
	it('starts a draw when the pointer lands on a player (playerGroup)', () => {
		const stage = makeNode(['stage']);
		const layer = makeNode(['playersLayer'], stage);
		const playerGroup = makeNode(['playerGroup'], layer);
		// The actual hit target is a child inside the player group (circle,
		// chevron, label text, …), not the group itself.
		const hit = makeNode(['baseCircle'], playerGroup);

		expect(drawStartsOnTarget(hit as unknown as Konva.Node, stage as unknown as Konva.Stage)).toBe(
			true
		);
	});

	it('starts a draw when the pointer lands directly on the playerGroup', () => {
		const stage = makeNode(['stage']);
		const layer = makeNode(['playersLayer'], stage);
		const playerGroup = makeNode(['playerGroup'], layer);

		expect(
			drawStartsOnTarget(playerGroup as unknown as Konva.Node, stage as unknown as Konva.Stage)
		).toBe(true);
	});

	it('starts a draw on the stage itself (empty canvas)', () => {
		const stage = makeNode(['stage']);
		expect(
			drawStartsOnTarget(stage as unknown as Konva.Node, stage as unknown as Konva.Stage)
		).toBe(true);
	});

	it('starts a draw on a direct child of the stage (overlay layer)', () => {
		const stage = makeNode(['stage']);
		const layerChild = makeNode(['annotationLayer'], stage);
		expect(
			drawStartsOnTarget(layerChild as unknown as Konva.Node, stage as unknown as Konva.Stage)
		).toBe(true);
	});

	it('starts a draw over an annotation (passthrough content)', () => {
		const stage = makeNode(['stage']);
		const layer = makeNode(['annotationLayer'], stage);
		const annGroup = makeNode(['annotation'], layer);
		const shape = makeNode(['arrowShape'], annGroup);
		expect(
			drawStartsOnTarget(shape as unknown as Konva.Node, stage as unknown as Konva.Stage)
		).toBe(true);
	});

	it('starts a draw over a movement path line (passthrough content)', () => {
		const stage = makeNode(['stage']);
		const layer = makeNode(['pathLayer'], stage);
		const line = makeNode(['lineShape'], layer);
		expect(drawStartsOnTarget(line as unknown as Konva.Node, stage as unknown as Konva.Stage)).toBe(
			true
		);
	});

	it('rejects a pointerdown on genuine UI controls not on the canvas', () => {
		// A node that is neither the stage, a stage child, nor any passthrough
		// content — e.g. an overlay HTML-control surrogate. Drawing must not
		// start here.
		const stage = makeNode(['stage']);
		const offCanvas = makeNode(['someToolbar']);
		expect(
			drawStartsOnTarget(offCanvas as unknown as Konva.Node, stage as unknown as Konva.Stage)
		).toBe(false);
	});
});
