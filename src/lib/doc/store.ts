import { writable, get } from 'svelte/store';
import type { BoardDoc } from './types';
import { createEmptyDoc } from './types';
import { History } from './history';

export class BoardDocStore {
	private store = writable<BoardDoc>(createEmptyDoc());
	private history = new History();

	subscribe = this.store.subscribe;

	get current(): BoardDoc {
		return get(this.store);
	}

	applyEdit(recipe: (draft: BoardDoc) => void, label: string): boolean {
		const doc = this.current;
		const { doc: nextDoc, changed } = this.history.applyEdit(doc, recipe, label);
		if (changed) {
			this.store.set(nextDoc);
		}
		return changed;
	}

	undo(): boolean {
		const doc = this.current;
		const { doc: nextDoc, changed } = this.history.undo(doc);
		if (changed) {
			this.store.set(nextDoc);
		}
		return changed;
	}

	redo(): boolean {
		const doc = this.current;
		const { doc: nextDoc, changed } = this.history.redo(doc);
		if (changed) {
			this.store.set(nextDoc);
		}
		return changed;
	}

	get canUndo(): boolean {
		return this.history.canUndo;
	}

	get canRedo(): boolean {
		return this.history.canRedo;
	}

	set(doc: BoardDoc): void {
		this.history.clear();
		this.store.set(doc);
	}

	clearHistory(): void {
		this.history.clear();
	}
}

export const boardDoc = new BoardDocStore();
