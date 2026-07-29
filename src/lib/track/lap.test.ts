import { describe, it, expect } from 'vitest';
import { lapsCompleted, distanceMeters, LAP_LENGTH } from './trackFrame';

describe('lapsCompleted', () => {
	it('computes zero laps when starting and ending at the same lap', () => {
		const startS = LAP_LENGTH * 2 + 10;
		const endS = LAP_LENGTH * 2 + 50;
		expect(lapsCompleted(endS, startS)).toBe(0);
	});

	it('computes one lap completed', () => {
		const startS = 10;
		const endS = LAP_LENGTH + 5;
		expect(lapsCompleted(endS, startS)).toBe(1);
	});

	it('computes multiple laps completed', () => {
		const startS = 10;
		const endS = LAP_LENGTH * 3 + 5;
		expect(lapsCompleted(endS, startS)).toBe(3);
	});

	it('handles negative lap count (moving backward)', () => {
		const startS = LAP_LENGTH + 10;
		const endS = 5;
		expect(lapsCompleted(endS, startS)).toBe(-1);
	});

	it('idempotent under scrub (same S → same laps)', () => {
		const startS = 10;
		const endS = LAP_LENGTH + 5;
		const laps1 = lapsCompleted(endS, startS);
		const laps2 = lapsCompleted(endS, startS);
		expect(laps1).toBe(laps2);
	});

	it('idempotent across the seam in both directions', () => {
		// Forward across seam
		const startS = LAP_LENGTH - 5;
		const endS = LAP_LENGTH + 5;
		expect(lapsCompleted(endS, startS)).toBe(1);

		// Backward across seam
		const startS2 = LAP_LENGTH + 5;
		const endS2 = LAP_LENGTH - 5;
		expect(lapsCompleted(endS2, startS2)).toBe(-1);
	});

	it('handles out-of-bounds u (u outside [0,1] does not affect lap count)', () => {
		const startS = LAP_LENGTH * 2 + 10;
		const endS = LAP_LENGTH * 3 + 50;
		// u doesn't affect lap calculation
		expect(lapsCompleted(endS, startS)).toBe(1);
	});

	it('monotonic under repeated forward movement', () => {
		let currentS = LAP_LENGTH + 10;
		const startS = currentS;
		const step = 20;

		for (let i = 1; i <= 5; i++) {
			currentS += step;
			expect(lapsCompleted(currentS, startS)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('distanceMeters', () => {
	it('computes zero distance when starting and ending at same position', () => {
		const startS = LAP_LENGTH * 2 + 10;
		const endS = LAP_LENGTH * 2 + 10;
		expect(distanceMeters(endS, startS)).toBe(0);
	});

	it('computes positive distance for forward movement', () => {
		const startS = 10;
		const endS = 50;
		expect(distanceMeters(endS, startS)).toBe(40);
	});

	it('computes negative distance for backward movement', () => {
		const startS = 50;
		const endS = 10;
		expect(distanceMeters(endS, startS)).toBe(-40);
	});

	it('computes distance across a lap boundary', () => {
		const startS = LAP_LENGTH - 10;
		const endS = LAP_LENGTH + 5;
		expect(distanceMeters(endS, startS)).toBe(15);
	});

	it('computes distance for multiple laps', () => {
		const startS = 10;
		const endS = LAP_LENGTH * 2 + 5;
		expect(distanceMeters(endS, startS)).toBe(LAP_LENGTH * 2 - 5);
	});

	it('idempotent under scrub (same S → same distance)', () => {
		const startS = 10;
		const endS = LAP_LENGTH + 5;
		const dist1 = distanceMeters(endS, startS);
		const dist2 = distanceMeters(endS, startS);
		expect(dist1).toBe(dist2);
	});

	it('is additive: distance(S1, S0) + distance(S2, S1) = distance(S2, S0)', () => {
		const startS = 10;
		const midS = LAP_LENGTH + 5;
		const endS = LAP_LENGTH * 2 + 10;

		const dist01 = distanceMeters(midS, startS);
		const dist12 = distanceMeters(endS, midS);
		const dist02 = distanceMeters(endS, startS);

		expect(Math.abs(dist01 + dist12 - dist02)).toBeLessThan(0.001);
	});

	it('handles out-of-bounds u (u outside [0,1] does not affect distance)', () => {
		const startS = LAP_LENGTH + 10;
		const endS = LAP_LENGTH * 2 + 50;
		// u doesn't affect distance calculation
		expect(distanceMeters(endS, startS)).toBe(LAP_LENGTH + 40);
	});
});
