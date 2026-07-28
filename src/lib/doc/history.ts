import { produceWithPatches, applyPatches, enablePatches } from 'immer';
import type { BoardDoc } from './types';

enablePatches();

export interface HistoryEntry {
	label: string;
	patches: Parameters<typeof applyPatches<BoardDoc>>[1];
	inversePatches: Parameters<typeof applyPatches<BoardDoc>>[1];
}

const MAX_HISTORY = 50;

export class History {
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];

	applyEdit(
		doc: BoardDoc,
		recipe: (draft: BoardDoc) => void,
		label: string
	): { doc: BoardDoc; changed: boolean } {
		const [nextDoc, patches, inversePatches] = produceWithPatches(doc, recipe);

		if (patches.length === 0) {
			return { doc, changed: false };
		}

		this.undoStack.push({ label, patches, inversePatches });
		if (this.undoStack.length > MAX_HISTORY) {
			this.undoStack.shift();
		}
		this.redoStack = [];

		return { doc: nextDoc as BoardDoc, changed: true };
	}

	undo(doc: BoardDoc): { doc: BoardDoc; changed: boolean } {
		const entry = this.undoStack.pop();
		if (!entry) {
			return { doc, changed: false };
		}

		const nextDoc = applyPatches(doc, entry.inversePatches) as BoardDoc;
		this.redoStack.push(entry);
		if (this.redoStack.length > MAX_HISTORY) {
			this.redoStack.shift();
		}

		return { doc: nextDoc, changed: true };
	}

	redo(doc: BoardDoc): { doc: BoardDoc; changed: boolean } {
		const entry = this.redoStack.pop();
		if (!entry) {
			return { doc, changed: false };
		}

		const nextDoc = applyPatches(doc, entry.patches) as BoardDoc;
		this.undoStack.push(entry);
		if (this.undoStack.length > MAX_HISTORY) {
			this.undoStack.shift();
		}

		return { doc: nextDoc, changed: true };
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
