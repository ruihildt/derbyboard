import { describe, it, expect } from 'vitest';
import { isInBounds } from '$lib/trackMath';
import { toTrack, fromTrack, laneBounds, LAP_LENGTH } from '$lib/track/trackFrame';
import { TRACK_SCALE, PLAYER_RADIUS } from '$lib/constants';
import { getPivotLineDistance } from '@open-roller-derby-tools/derby-track/dist/packFunctions.js';

describe('Gate 0 — geometry round-trip', () => {
	it('package getPivotLineDistance agrees with toTrack for s coordinate', () => {
		const sSamples = 400;
		const uSamples = [0.0, 0.25, 0.5, 0.75, 1.0];
		let worstSDelta = 0;

		for (let i = 0; i < sSamples; i++) {
			const s = (i / sSamples) * LAP_LENGTH;
			for (const u of uSamples) {
				const meter = fromTrack(s, u);
				const packageS = getPivotLineDistance(meter);
				const myS = toTrack(meter).s;

				let sDelta = Math.abs(packageS - myS);
				if (sDelta > LAP_LENGTH / 2) sDelta = LAP_LENGTH - sDelta;
				worstSDelta = Math.max(worstSDelta, sDelta);
			}
		}

		console.log(`Gate 0 s-agreement: max delta vs package = ${worstSDelta.toFixed(8)} m`);
		expect(worstSDelta).toBeLessThan(0.001);
	});

	it('round-trips through package getPivotLineDistance: (s,u) → meters → package s → fromTrack → meters', () => {
		const maxErrorM = 0.01;
		let worstError = 0;

		const sSamples = 400;
		const uSamples = [0.0, 0.25, 0.5, 0.75, 1.0];

		for (let i = 0; i < sSamples; i++) {
			const s = (i / sSamples) * LAP_LENGTH;
			for (const u of uSamples) {
				const meter1 = fromTrack(s, u);
				const packageS = getPivotLineDistance(meter1);
				const meter2 = fromTrack(packageS, u);

				const error = Math.hypot(meter2.x - meter1.x, meter2.y - meter1.y);
				worstError = Math.max(worstError, error);
			}
		}

		console.log(`Gate 0 package round-trip: max error = ${worstError.toFixed(6)} m`);
		expect(worstError).toBeLessThan(maxErrorM);
	});

	it('lane bounds: u in (0,1) are in bounds, u outside [0,1] are out of bounds', () => {
		const skaterRadiusM = PLAYER_RADIUS / TRACK_SCALE;
		const sSamples = 200;

		for (let i = 0; i < sSamples; i++) {
			const s = (i / sSamples) * LAP_LENGTH;

			const midInner = fromTrack(s, 0.15);
			const midOuter = fromTrack(s, 0.85);

			expect(isInBounds(midInner, skaterRadiusM)).toBe(true);
			expect(isInBounds(midOuter, skaterRadiusM)).toBe(true);

			const beyondInner = fromTrack(s, -0.05);
			expect(isInBounds(beyondInner, skaterRadiusM)).toBe(false);

			const beyondOuter = fromTrack(s, 1.05);
			expect(isInBounds(beyondOuter, skaterRadiusM)).toBe(false);
		}
	});

	it('boundary continuity: lane bounds change smoothly across segment joins', () => {
		const joinSs = [0, Math.PI * 5.41, Math.PI * 5.41 + 2 * 5.33, 2 * Math.PI * 5.41 + 2 * 5.33];
		const eps = 0.001;

		for (const joinS of joinSs) {
			const before = laneBounds(joinS - eps);
			const after = laneBounds(joinS + eps);

			expect(Math.abs(before.inner - after.inner)).toBeLessThan(0.01);
			expect(Math.abs(before.outer - after.outer)).toBeLessThan(0.01);
		}
	});
});
