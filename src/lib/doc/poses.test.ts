import { describe, it, expect, beforeEach } from 'vitest';
import { PoseStore } from './poses';
import { boardDoc } from './store';
import { createEmptyDoc } from './types';
import type { Entity } from './types';

function entity(id: string, S: number, u: number, heading = 0): Entity {
	return { id, kind: 'skater', team: 'A', role: 'blocker', S, u, heading };
}

describe('PoseStore', () => {
	let store: PoseStore;

	beforeEach(() => {
		const doc = createEmptyDoc();
		doc.entities = [entity('p1', 10, 0.5), entity('p2', 20, 0.6)];
		boardDoc.set(doc);
		store = new PoseStore();
	});

	describe('effective', () => {
		it('returns the committed pose when there is no live override', () => {
			expect(store.effective('p1')).toEqual({ S: 10, u: 0.5, heading: 0 });
		});

		it('returns undefined for an unknown id', () => {
			expect(store.effective('missing')).toBeUndefined();
		});

		it('returns the live override once set, ignoring the committed value', () => {
			store.setLive('p1', { S: 99, u: 0.9 });
			expect(store.effective('p1')).toEqual({ S: 99, u: 0.9, heading: 0 });
		});
	});

	describe('effectiveAll', () => {
		it('reflects committed poses for entities with no live override', () => {
			const all = store.effectiveAll();
			expect(all).toHaveLength(2);
			expect(all.find((e) => e.entity.id === 'p1')?.pose).toEqual({ S: 10, u: 0.5, heading: 0 });
		});

		it('mixes live and committed poses within the same call', () => {
			store.setLive('p1', { S: 15, u: 0.55 });
			const all = store.effectiveAll();
			expect(all.find((e) => e.entity.id === 'p1')?.pose).toEqual({
				S: 15,
				u: 0.55,
				heading: 0
			});
			expect(all.find((e) => e.entity.id === 'p2')?.pose).toEqual({ S: 20, u: 0.6, heading: 0 });
		});
	});

	describe('setLive', () => {
		it('merges a partial update onto the current effective pose', () => {
			store.setLive('p1', { S: 11 });
			expect(store.effective('p1')).toEqual({ S: 11, u: 0.5, heading: 0 });
		});

		it('is a no-op for an unknown id', () => {
			store.setLive('missing', { S: 1, u: 1 });
			expect(store.effective('missing')).toBeUndefined();
		});

		it('does not write to the committed document', () => {
			store.setLive('p1', { S: 999, u: 0.1 });
			const committed = boardDoc.current.entities.find((e) => e.id === 'p1')!;
			expect(committed.S).toBe(10);
			expect(committed.u).toBe(0.5);
		});
	});

	describe('isLive / touchedIds', () => {
		it('is false with an empty live tier', () => {
			expect(store.isLive).toBe(false);
			expect(store.touchedIds()).toEqual([]);
		});

		it('is true once any entity has a live override', () => {
			store.setLive('p1', { S: 1, u: 1 });
			expect(store.isLive).toBe(true);
			expect(store.touchedIds()).toEqual(['p1']);
		});
	});

	describe('abortGesture', () => {
		it('discards live overrides without touching the committed document', () => {
			store.setLive('p1', { S: 999, u: 0.1 });
			store.abortGesture();

			expect(store.isLive).toBe(false);
			expect(store.effective('p1')).toEqual({ S: 10, u: 0.5, heading: 0 });
		});
	});

	describe('commitGesture', () => {
		it('writes every touched entity to the document in one applyEdit', () => {
			store.setLive('p1', { S: 30, u: 0.7 });
			store.setLive('p2', { S: 40, u: 0.8 });

			const changed = store.commitGesture('Move players');

			expect(changed).toBe(true);
			const doc = boardDoc.current;
			expect(doc.entities.find((e) => e.id === 'p1')).toMatchObject({ S: 30, u: 0.7 });
			expect(doc.entities.find((e) => e.id === 'p2')).toMatchObject({ S: 40, u: 0.8 });
		});

		it('clears the live tier after committing', () => {
			store.setLive('p1', { S: 30, u: 0.7 });
			store.commitGesture('Move players');

			expect(store.isLive).toBe(false);
		});

		it('produces exactly one undo step for a multi-entity gesture', () => {
			store.setLive('p1', { S: 30, u: 0.7 });
			store.setLive('p2', { S: 40, u: 0.8 });
			store.commitGesture('Move players');

			expect(boardDoc.canUndo).toBe(true);
			boardDoc.undo();

			// Both entities revert together from a single undo step.
			const doc = boardDoc.current;
			expect(doc.entities.find((e) => e.id === 'p1')).toMatchObject({ S: 10, u: 0.5 });
			expect(doc.entities.find((e) => e.id === 'p2')).toMatchObject({ S: 20, u: 0.6 });
			expect(boardDoc.canUndo).toBe(false);
		});

		it('is a no-op when there is nothing live', () => {
			const changed = store.commitGesture('Move players');
			expect(changed).toBe(false);
			expect(boardDoc.canUndo).toBe(false);
		});

		it('preserves heading when only S/u were set live', () => {
			const doc = createEmptyDoc();
			doc.entities = [entity('p1', 10, 0.5, 42)];
			boardDoc.set(doc);
			store = new PoseStore();

			store.setLive('p1', { S: 12, u: 0.6 });
			store.commitGesture('Move');

			expect(boardDoc.current.entities.find((e) => e.id === 'p1')).toMatchObject({
				S: 12,
				u: 0.6,
				heading: 42
			});
		});
	});

	describe('finiteness guards', () => {
		// Regression: a non-finite pose must never enter the store, because on
		// commit it would corrupt the document and survive into persisted state
		// (JSON.stringify turns NaN into null, which reload stacks at the
		// origin). See the reset/duplicate-manager incident.

		it('setLive rejects a non-finite S, keeping the previous committed pose', () => {
			store.setLive('p1', { S: NaN, u: 0.9 });
			expect(store.effective('p1')).toEqual({ S: 10, u: 0.5, heading: 0 });
		});

		it('setLive rejects a non-finite u', () => {
			store.setLive('p1', { S: 30, u: Infinity });
			expect(store.effective('p1')).toEqual({ S: 10, u: 0.5, heading: 0 });
		});

		it('setLive rejects a non-finite heading', () => {
			store.setLive('p1', { heading: NaN });
			expect(store.effective('p1')).toEqual({ S: 10, u: 0.5, heading: 0 });
		});

		it('commitGesture skips any non-finite pose that slipped into the live tier', () => {
			// Inject a NaN pose directly past the guard (simulating a future bug)
			// alongside a valid one; the valid one commits, the NaN is dropped.
			store.setLive('p1', { S: 30, u: 0.7 });
			store['live'].set('p2', { S: NaN, u: NaN, heading: NaN });

			store.commitGesture('Move');

			expect(boardDoc.current.entities.find((e) => e.id === 'p1')).toMatchObject({
				S: 30,
				u: 0.7
			});
			// p2 is untouched by the bad commit.
			expect(boardDoc.current.entities.find((e) => e.id === 'p2')).toMatchObject({
				S: 20,
				u: 0.6
			});
		});
	});
});
