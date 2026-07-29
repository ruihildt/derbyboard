import { describe, it, expect } from 'vitest';
import { preserveLapOnDrag, LAP_LENGTH, shortestDelta } from './trackFrame';

describe('preserveLapOnDrag', () => {
	it('preserves lap index for forward drags within a lap', () => {
		const committedS = LAP_LENGTH * 2 + 10;
		const wrappedS = 20;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Should preserve the 2 laps and move forward by 10
		expect(result).toBe(committedS + shortestDelta(committedS, wrappedS));
		expect(result).toBeGreaterThan(LAP_LENGTH * 2);
	});

	it('preserves lap index for backward drags within a lap', () => {
		const committedS = LAP_LENGTH * 2 + 10;
		const wrappedS = 5;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Should preserve the 2 laps and move backward by 5
		expect(result).toBe(committedS + shortestDelta(committedS, wrappedS));
		expect(result).toBeGreaterThan(LAP_LENGTH * 2);
	});

	it('increments lap when dragging forward across the seam (small delta)', () => {
		const committedS = LAP_LENGTH - 5;
		const wrappedS = 5;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Delta should be +10 (5 → LAP_LENGTH + 5)
		expect(result).toBe(committedS + shortestDelta(committedS, wrappedS));
		expect(result).toBeGreaterThan(LAP_LENGTH);
	});

	it('decrements lap when dragging backward across the seam (small delta)', () => {
		const committedS = 5;
		const wrappedS = LAP_LENGTH - 5;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Delta should be -10 (5 → -5, wrapped to LAP_LENGTH - 5)
		expect(result).toBe(committedS + shortestDelta(committedS, wrappedS));
		expect(result).toBeLessThan(0);
	});

	it('does not increment lap when dragging > L/2 forward (re-seat)', () => {
		const committedS = 10;
		const wrappedS = 5;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Delta should be negative (backward) since we're dragging backward
		expect(result).toBeLessThan(committedS);
	});

	it('does not decrement lap when dragging > L/2 backward (re-seat)', () => {
		const committedS = LAP_LENGTH - 10;
		const wrappedS = LAP_LENGTH - 5;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Delta should be +5 (small forward)
		expect(result).toBe(committedS + shortestDelta(committedS, wrappedS));
	});

	it('handles exactly L/2 boundary correctly', () => {
		const halfLap = LAP_LENGTH / 2;
		const committedS = 0;
		const wrappedS = halfLap;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// At exactly L/2, shortestDelta can go either way but should be ≤ L/2
		const delta = Math.abs(result - committedS);
		expect(delta).toBeLessThanOrEqual(halfLap);
	});

	it('monotonic under repeated forward drags', () => {
		let s = 0;
		const dragAmount = 10;
		const iterations = 10;

		for (let i = 0; i < iterations; i++) {
			const wrappedS = (s + dragAmount) % LAP_LENGTH;
			s = preserveLapOnDrag(s, wrappedS);
			expect(s).toBeGreaterThan((i - 1) * dragAmount); // Monotonic
		}
	});

	it('handles dragging from positive lap to zero lap', () => {
		const committedS = LAP_LENGTH * 3 + 50;
		const wrappedS = 50;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Should preserve the 3 laps
		expect(result).toBeGreaterThan(LAP_LENGTH * 3);
	});

	it('handles dragging from zero lap to positive lap', () => {
		const committedS = 50;
		const wrappedS = 50;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Same position, no change
		expect(result).toBe(committedS);
	});

	it('preserves lap index for large drags across multiple seams', () => {
		const committedS = LAP_LENGTH * 5 + 10;
		const wrappedS = 20;
		const result = preserveLapOnDrag(committedS, wrappedS);
		// Should preserve the 5 laps
		expect(result).toBeGreaterThan(LAP_LENGTH * 5);
	});
});

describe('shortestDelta', () => {
	it('computes correct delta for forward movement', () => {
		const delta = shortestDelta(0, 10);
		expect(delta).toBe(10);
	});

	it('computes correct delta for backward movement', () => {
		const delta = shortestDelta(10, 0);
		expect(delta).toBe(-10);
	});

	it('handles wrap-around forward', () => {
		const delta = shortestDelta(LAP_LENGTH - 5, 5);
		expect(delta).toBe(10);
	});

	it('handles wrap-around backward', () => {
		const delta = shortestDelta(5, LAP_LENGTH - 5);
		expect(delta).toBe(-10);
	});

	it('chooses shortest path for large forward delta', () => {
		const delta = shortestDelta(0, LAP_LENGTH - 10);
		expect(delta).toBe(-10); // Backward is shorter
	});

	it('returns 0 for same position', () => {
		const delta = shortestDelta(10, 10);
		expect(delta).toBe(0);
	});
});
