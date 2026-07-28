import { describe, it, expect } from 'vitest';
import { CollisionSystem } from './CollisionSystem';
import { PLAYER_RADIUS, PLAYER_STROKE_WIDTH } from '$lib/constants';

/**
 * Minimal stand-in for a Konva.Group exposing only the surface
 * `resolveConstraint` exercises: `position()` getter/setter and `fire()`.
 * Using this instead of a real Konva.Layer keeps the test canvas-free (jsdom
 * has no 2D context), while still exercising the real constraint math.
 */
function makeGroup(x: number, y: number) {
	let pos = { x, y };
	return {
		position(...args: [] | [{ x: number; y: number }]) {
			if (args.length === 0) return { ...pos };
			pos = { ...args[0] };
		},
		read() {
			return { ...pos };
		},
		fire() {
			/* no-op */
		}
	};
}

function makePlayer(x: number, y: number) {
	const group = makeGroup(x, y);
	return { node: { getNode: () => group }, group };
}

describe('CollisionSystem', () => {
	const minDistance = PLAYER_RADIUS * 2 + PLAYER_STROKE_WIDTH;

	it('separates overlapping but distinct players finitely', () => {
		const cs = new CollisionSystem(null as never);
		const a = makePlayer(0, 0);
		const b = makePlayer(minDistance / 2, 0); // closer than minDistance

		(cs as unknown as { resolveConstraint: (p: unknown, q: unknown) => void }).resolveConstraint(
			a.node,
			b.node
		);

		const pa = a.group.read();
		const pb = b.group.read();
		expect(Number.isFinite(pa.x)).toBe(true);
		expect(Number.isFinite(pa.y)).toBe(true);
		expect(Number.isFinite(pb.x)).toBe(true);
		expect(Number.isFinite(pb.y)).toBe(true);

		// They should now be at least minDistance apart along x.
		const dx = Math.abs(pb.x - pa.x);
		expect(dx).toBeGreaterThanOrEqual(minDistance - 1e-6);
	});

	// Regression: two players at the EXACT same point previously yielded
	// dirX/dirY = 0/0 = NaN, poisoning both nodes' positions. The duplicate-
	// manager reset bug made this the live failure mode. The solver must keep
	// its output finite for coincident inputs regardless.
	it('never produces NaN for coincident (identical-position) players', () => {
		const cs = new CollisionSystem(null as never);
		const a = makePlayer(50, 50);
		const b = makePlayer(50, 50);

		(cs as unknown as { resolveConstraint: (p: unknown, q: unknown) => void }).resolveConstraint(
			a.node,
			b.node
		);

		const pa = a.group.read();
		const pb = b.group.read();
		expect(Number.isFinite(pa.x)).toBe(true);
		expect(Number.isFinite(pa.y)).toBe(true);
		expect(Number.isFinite(pb.x)).toBe(true);
		expect(Number.isFinite(pb.y)).toBe(true);

		// And they should be separated to at least minDistance.
		const dx = pb.x - pa.x;
		const dy = pb.y - pa.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		expect(dist).toBeGreaterThanOrEqual(minDistance - 1e-6);
	});

	it('leaves already-poisoned (NaN) nodes untouched instead of spreading the NaN', () => {
		const cs = new CollisionSystem(null as never);
		const a = makePlayer(NaN, NaN);
		const b = makePlayer(0, 0);

		(cs as unknown as { resolveConstraint: (p: unknown, q: unknown) => void }).resolveConstraint(
			a.node,
			b.node
		);

		// The clean node must not inherit NaN.
		const pb = b.group.read();
		expect(Number.isFinite(pb.x)).toBe(true);
		expect(Number.isFinite(pb.y)).toBe(true);
		expect(pb).toEqual({ x: 0, y: 0 });
	});
});
