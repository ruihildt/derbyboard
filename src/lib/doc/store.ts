import { writable, get } from 'svelte/store';
import type { BoardDoc } from './types';
import { createEmptyDoc } from './types';
import { History } from './history';
import { migrateBoardDoc } from './migrate';

/**
 * localStorage key holding the full persisted `BoardDoc` (entities + clips).
 * The legacy `derbyboard-save` key (`boardState`, v3 KonvaBoardState) is kept
 * only as a one-time upgrade source and for view-settings (zoom/pan); the
 * document itself now persists here so authored clips/steps survive reload.
 */
const DOC_STORAGE_KEY = 'derbyboard-doc';

const SAVE_DEBOUNCE_MS = 300;

function loadPersistedDoc(): BoardDoc | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(DOC_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as BoardDoc;
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entities)) {
			return null;
		}
		return migrateBoardDoc(parsed);
	} catch {
		return null;
	}
}

export class BoardDocStore {
	private store = writable<BoardDoc>(createEmptyDoc());
	private history = new History();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	subscribe = this.store.subscribe;

	get current(): BoardDoc {
		return get(this.store);
	}

	constructor() {
		// Hydrate from localStorage before anyone subscribes, so the first
		// render reflects the persisted document (entities + authored clips).
		const persisted = loadPersistedDoc();
		if (persisted) {
			this.store.set(persisted);
		}
		// Debounced persistence: coalesce bursts of edits (e.g. a fast undo
		// run or repeated applyEdit) into a single localStorage write.
		this.store.subscribe((doc) => this.scheduleSave(doc));
	}

	private scheduleSave(doc: BoardDoc): void {
		if (typeof localStorage === 'undefined') return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			try {
				localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(doc));
			} catch {
				// Quota or serialization failure must never break editing.
			}
		}, SAVE_DEBOUNCE_MS);
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

	/**
	 * Replaces the current document value WITHOUT touching undo/redo history.
	 * Used for view-only navigation that must not pollute the edit history —
	 * e.g. stepping between authored steps (the user does not expect Undo to
	 * walk back through every step they merely looked at). Subsequent edits
	 * patch relative to whatever this sets.
	 */
	setView(doc: BoardDoc): void {
		this.store.set(doc);
	}

	clearHistory(): void {
		this.history.clear();
	}
}

export const boardDoc = new BoardDocStore();
