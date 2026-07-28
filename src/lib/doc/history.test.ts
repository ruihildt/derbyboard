import { describe, it, expect, beforeEach } from 'vitest';
import { History } from './history';
import { createEmptyDoc } from './types';
import type { BoardDoc } from './types';

describe('History', () => {
	let history: History;
	let doc: BoardDoc;

	beforeEach(() => {
		history = new History();
		doc = createEmptyDoc();
	});

	describe('applyEdit', () => {
		it('should apply a recipe and return the new document', () => {
			const result = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test Board';
				},
				'Set name'
			);

			expect(result.changed).toBe(true);
			expect(result.doc.meta.name).toBe('Test Board');
		});

		it('should not change document if recipe makes no changes', () => {
			const result = history.applyEdit(
				doc,
				() => {
					// No changes
				},
				'No-op'
			);

			expect(result.changed).toBe(false);
			expect(result.doc).toBe(doc);
		});

		it('should enable undo after applying an edit', () => {
			history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test';
				},
				'Set name'
			);

			expect(history.canUndo).toBe(true);
		});

		it('should clear redo stack after applying an edit', () => {
			history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'First';
				},
				'First edit'
			);

			const doc1 = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Second';
				},
				'Second edit'
			).doc;

			history.undo(doc1);
			expect(history.canRedo).toBe(true);

			history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Third';
				},
				'Third edit'
			);

			expect(history.canRedo).toBe(false);
		});
	});

	describe('undo', () => {
		it('should undo the last edit', () => {
			const doc1 = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test';
				},
				'Set name'
			).doc;

			const result = history.undo(doc1);

			expect(result.changed).toBe(true);
			expect(result.doc.meta.name).toBeUndefined();
		});

		it('should not change document if nothing to undo', () => {
			const result = history.undo(doc);

			expect(result.changed).toBe(false);
			expect(result.doc).toBe(doc);
		});

		it('should enable redo after undo', () => {
			const doc1 = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test';
				},
				'Set name'
			).doc;

			history.undo(doc1);

			expect(history.canRedo).toBe(true);
		});
	});

	describe('redo', () => {
		it('should redo the last undone edit', () => {
			const doc1 = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test';
				},
				'Set name'
			).doc;

			const doc2 = history.undo(doc1).doc;
			const result = history.redo(doc2);

			expect(result.changed).toBe(true);
			expect(result.doc.meta.name).toBe('Test');
		});

		it('should not change document if nothing to redo', () => {
			const result = history.redo(doc);

			expect(result.changed).toBe(false);
			expect(result.doc).toBe(doc);
		});
	});

	describe('history depth', () => {
		it('should cap undo stack at 50 entries', () => {
			let currentDoc = doc;
			for (let i = 0; i < 60; i++) {
				currentDoc = history.applyEdit(
					currentDoc,
					(draft) => {
						draft.meta.name = `Edit ${i}`;
					},
					`Edit ${i}`
				).doc;
			}

			// Should be able to undo 50 times
			let undoCount = 0;
			let tempDoc = currentDoc;
			while (history.canUndo) {
				tempDoc = history.undo(tempDoc).doc;
				undoCount++;
			}

			expect(undoCount).toBe(50);
		});
	});

	describe('clear', () => {
		it('should clear undo and redo stacks', () => {
			const doc1 = history.applyEdit(
				doc,
				(draft) => {
					draft.meta.name = 'Test';
				},
				'Set name'
			).doc;

			history.undo(doc1);
			expect(history.canUndo).toBe(false);
			expect(history.canRedo).toBe(true);

			history.clear();

			expect(history.canUndo).toBe(false);
			expect(history.canRedo).toBe(false);
		});
	});
});
