import { describe, it, expect } from 'vitest';
import {
	toTrack,
	fromTrack,
	tangentAt,
	laneBounds,
	laneToOffset,
	offsetToLane,
	shortestDelta,
	unwrap,
	isInBoundsTrack,
	LAP_LENGTH
} from './trackFrame';
import { isInBounds, type MeterPoint } from '$lib/trackMath';
import { TRACK_SCALE, PLAYER_RADIUS } from '$lib/constants';

describe('trackFrame', () => {
	describe('fromTrack/toTrack round-trip', () => {
		it('round-trips (s,u) → meters → (s,u) across dense grid', () => {
			const sSamples = 400;
			const uSamples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];

			for (let i = 0; i < sSamples; i++) {
				const s = (i / sSamples) * LAP_LENGTH;
				for (const u of uSamples) {
					const meter = fromTrack(s, u);
					const result = toTrack(meter);

					expect(result.s).toBeCloseTo(s, 5);
					expect(result.u).toBeCloseTo(u, 5);
				}
			}
		});

		it('round-trips at segment joins', () => {
			const joinSs = [0, Math.PI * 5.41, Math.PI * 5.41 + 2 * 5.33, 2 * Math.PI * 5.41 + 2 * 5.33];

			for (const s of joinSs) {
				for (const u of [0, 0.5, 1.0]) {
					const meter = fromTrack(s, u);
					const result = toTrack(meter);

					expect(result.s).toBeCloseTo(s, 5);
					expect(result.u).toBeCloseTo(u, 5);
				}
			}
		});

		it('round-trips at seam s=0', () => {
			for (const u of [0, 0.25, 0.5, 0.75, 1.0]) {
				const meter = fromTrack(0, u);
				const result = toTrack(meter);

				expect(result.s).toBeCloseTo(0, 5);
				expect(result.u).toBeCloseTo(u, 5);
			}
		});

		it('round-trips meters → (s,u) → meters for track surface points', () => {
			const testPoints: MeterPoint[] = [];
			for (let s = 0; s < LAP_LENGTH; s += LAP_LENGTH / 20) {
				for (const u of [0, 0.25, 0.5, 0.75, 1.0]) {
					testPoints.push(fromTrack(s, u));
				}
			}

			for (const p of testPoints) {
				const { s, u } = toTrack(p);
				const p2 = fromTrack(s, u);

				expect(p2.x).toBeCloseTo(p.x, 4);
				expect(p2.y).toBeCloseTo(p.y, 4);
			}
		});

		it('is lossless for out-of-bounds u (infield and apron), unlike a clamped encoding', () => {
			// u is NOT clamped to [0,1] — a drop on the infield (u < 0) or past the
			// apron (u > 1) must round-trip exactly, otherwise storing the pose
			// silently teleports the entity back inside the boundary. Guaranteed
			// domain: outward without limit, inward down to ~ -0.8 (see the
			// geometric-limit note on toTrack); this range comfortably covers any
			// realistic drag.
			const sSamples = 60;
			const outOfBoundsU = [-0.75, -0.5, -0.05, 1.05, 1.5, 3, 5];

			for (let i = 0; i < sSamples; i++) {
				const s = (i / sSamples) * LAP_LENGTH;
				for (const u of outOfBoundsU) {
					const meter = fromTrack(s, u);
					const result = toTrack(meter);

					expect(result.u).toBeCloseTo(u, 4);
					const meter2 = fromTrack(result.s, result.u);
					expect(meter2.x).toBeCloseTo(meter.x, 4);
					expect(meter2.y).toBeCloseTo(meter.y, 4);
				}
			}
		});
	});

	describe('shortestDelta', () => {
		it('returns positive delta for forward movement', () => {
			expect(shortestDelta(0, 10)).toBeCloseTo(10, 5);
			expect(shortestDelta(10, 20)).toBeCloseTo(10, 5);
		});

		it('returns negative delta for backward movement', () => {
			expect(shortestDelta(10, 0)).toBeCloseTo(-10, 5);
			expect(shortestDelta(20, 10)).toBeCloseTo(-10, 5);
		});

		it('handles wraparound correctly', () => {
			const delta1 = shortestDelta(LAP_LENGTH - 5, 5);
			expect(delta1).toBeCloseTo(10, 5);

			const delta2 = shortestDelta(5, LAP_LENGTH - 5);
			expect(delta2).toBeCloseTo(-10, 5);
		});

		it('returns values in range (-LAP_LENGTH/2, LAP_LENGTH/2]', () => {
			const testCases = [
				[0, LAP_LENGTH / 2],
				[0, LAP_LENGTH / 2 + 1],
				[LAP_LENGTH - 1, 1],
				[1, LAP_LENGTH - 1]
			];

			for (const [from, to] of testCases) {
				const delta = shortestDelta(from, to);
				expect(Math.abs(delta)).toBeLessThanOrEqual(LAP_LENGTH / 2);
			}
		});

		it('handles exact half-lap correctly', () => {
			const delta = shortestDelta(0, LAP_LENGTH / 2);
			expect(Math.abs(delta)).toBeCloseTo(LAP_LENGTH / 2, 5);
		});
	});

	describe('unwrap', () => {
		it('maintains monotonicity for forward movement', () => {
			let sPrev = 0;
			for (let i = 0; i < 100; i++) {
				const sNext = (i * 0.5) % LAP_LENGTH;
				const unwrapped = unwrap(sPrev, sNext);
				expect(unwrapped).toBeGreaterThanOrEqual(sPrev);
				sPrev = unwrapped;
			}
		});

		it('handles wraparound at seam', () => {
			const sPrev = LAP_LENGTH - 5;
			const sNext = 5;
			const unwrapped = unwrap(sPrev, sNext);
			expect(unwrapped).toBeCloseTo(LAP_LENGTH + 5, 5);
		});

		it('handles backward movement', () => {
			const sPrev = 10;
			const sNext = 5;
			const unwrapped = unwrap(sPrev, sNext);
			expect(unwrapped).toBeCloseTo(5, 5);
		});

		it('handles backward wraparound', () => {
			const sPrev = 5;
			const sNext = LAP_LENGTH - 5;
			const unwrapped = unwrap(sPrev, sNext);
			expect(unwrapped).toBeCloseTo(-5, 5);
		});
	});

	describe('laneBounds', () => {
		it('returns consistent inner and outer bounds', () => {
			for (let s = 0; s < LAP_LENGTH; s += 1) {
				const bounds = laneBounds(s);
				expect(bounds.inner).toBeLessThan(0);
				expect(bounds.outer).toBeGreaterThan(0);
				expect(bounds.outer).toBeGreaterThan(bounds.inner);
			}
		});

		it('is continuous at segment joins', () => {
			const joinSs = [Math.PI * 5.41, Math.PI * 5.41 + 2 * 5.33, 2 * Math.PI * 5.41 + 2 * 5.33];

			for (const s of joinSs) {
				const before = laneBounds(s - 0.001);
				const after = laneBounds(s + 0.001);

				expect(Math.abs(before.inner - after.inner)).toBeLessThan(0.01);
				expect(Math.abs(before.outer - after.outer)).toBeLessThan(0.01);
			}
		});

		it('is continuous at seam s=0', () => {
			const before = laneBounds(LAP_LENGTH - 0.001);
			const after = laneBounds(0.001);

			expect(Math.abs(before.inner - after.inner)).toBeLessThan(0.01);
			expect(Math.abs(before.outer - after.outer)).toBeLessThan(0.01);
		});
	});

	describe('laneToOffset and offsetToLane', () => {
		it('are inverses of each other', () => {
			for (let s = 0; s < LAP_LENGTH; s += 5) {
				for (let u = 0; u <= 1; u += 0.1) {
					const offset = laneToOffset(s, u);
					const u2 = offsetToLane(s, offset);
					expect(u2).toBeCloseTo(u, 5);
				}
			}
		});

		it('maps u=0 to inner bound and u=1 to outer bound', () => {
			for (let s = 0; s < LAP_LENGTH; s += 10) {
				const bounds = laneBounds(s);
				const innerOffset = laneToOffset(s, 0);
				const outerOffset = laneToOffset(s, 1);

				expect(innerOffset).toBeCloseTo(bounds.inner, 5);
				expect(outerOffset).toBeCloseTo(bounds.outer, 5);
			}
		});
	});

	describe('tangentAt', () => {
		it('returns unit vectors', () => {
			for (let s = 0; s < LAP_LENGTH; s += 5) {
				const tangent = tangentAt(s);
				const magnitude = Math.hypot(tangent.x, tangent.y);
				expect(magnitude).toBeCloseTo(1, 5);
			}
		});

		it('is continuous at segment joins', () => {
			const joinSs = [Math.PI * 5.41, Math.PI * 5.41 + 2 * 5.33, 2 * Math.PI * 5.41 + 2 * 5.33];

			for (const s of joinSs) {
				const before = tangentAt(s - 0.001);
				const after = tangentAt(s + 0.001);

				expect(Math.abs(before.x - after.x)).toBeLessThan(0.01);
				expect(Math.abs(before.y - after.y)).toBeLessThan(0.01);
			}
		});

		it('is perpendicular to lane normal on straights', () => {
			const topStraightS = Math.PI * 5.41 + 5.33;
			const tangent = tangentAt(topStraightS);
			expect(tangent.y).toBeCloseTo(0, 5);
			expect(Math.abs(tangent.x)).toBeCloseTo(1, 5);

			const bottomStraightS = 2 * Math.PI * 5.41 + 2 * 5.33 + 5.33;
			const tangent2 = tangentAt(bottomStraightS);
			expect(tangent2.y).toBeCloseTo(0, 5);
			expect(Math.abs(tangent2.x)).toBeCloseTo(1, 5);
		});
	});

	describe('isInBounds with track coordinates', () => {
		it('u in [0.15, 0.85] are in bounds across the track', () => {
			const skaterRadiusM = PLAYER_RADIUS / TRACK_SCALE;
			const sSamples = 200;

			for (let i = 0; i < sSamples; i++) {
				const s = (i / sSamples) * LAP_LENGTH;

				for (const u of [0.15, 0.3, 0.5, 0.7, 0.85]) {
					const point = fromTrack(s, u);
					expect(isInBounds(point, skaterRadiusM)).toBe(true);
				}
			}
		});

		it('u outside [0, 1] are out of bounds', () => {
			const skaterRadiusM = PLAYER_RADIUS / TRACK_SCALE;
			const sSamples = 100;

			for (let i = 0; i < sSamples; i++) {
				const s = (i / sSamples) * LAP_LENGTH;

				const inner = fromTrack(s, -0.05);
				expect(isInBounds(inner, skaterRadiusM)).toBe(false);

				const outer = fromTrack(s, 1.05);
				expect(isInBounds(outer, skaterRadiusM)).toBe(false);
			}
		});
	});

	describe('isInBoundsTrack', () => {
		it('agrees with meter-space isInBounds across the track', () => {
			const skaterRadiusM = PLAYER_RADIUS / TRACK_SCALE;
			const sSamples = 200;
			const uCandidates = [-0.1, 0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0, 1.1];

			for (let i = 0; i < sSamples; i++) {
				const s = (i / sSamples) * LAP_LENGTH;
				for (const u of uCandidates) {
					const point = fromTrack(s, u);
					expect(isInBoundsTrack(s, u, skaterRadiusM)).toBe(isInBounds(point, skaterRadiusM));
				}
			}
		});

		it('treats u outside [0,1] as out of bounds with zero radius', () => {
			expect(isInBoundsTrack(10, -0.01)).toBe(false);
			expect(isInBoundsTrack(10, 1.01)).toBe(false);
			expect(isInBoundsTrack(10, 0.5)).toBe(true);
		});
	});

	describe('LAP_LENGTH constant', () => {
		it('matches expected measurement line length', () => {
			const expected = 2 * Math.PI * 5.41 + 2 * 2 * 5.33;
			expect(LAP_LENGTH).toBeCloseTo(expected, 5);
		});
	});
});
