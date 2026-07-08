import { get } from 'svelte/store';
import { boardState, type KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { KonvaGame } from '$lib/konva/KonvaGame';

/**
 * Exports the current board state to a downloadable JSON file
 */
export function exportBoardToFile() {
	// Get the current state from the store
	const state = get(boardState);

	// Create a downloadable JSON file
	const dataStr = JSON.stringify(state, null, 2);
	const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

	// Create a filename with current date
	const exportFileName = `derbyboard-${new Date().toISOString().slice(0, 10)}.json`;

	// Create and trigger download link
	const linkElement = document.createElement('a');
	linkElement.setAttribute('href', dataUri);
	linkElement.setAttribute('download', exportFileName);
	linkElement.click();
}

/**
 * Loads board state from a JSON file
 * @param file The JSON file to load
 * @param game The KonvaGame instance to update
 */
export async function loadBoardFromFile(file: File, game?: KonvaGame): Promise<void> {
	try {
		const fileContent = await file.text();
		const loadedState = JSON.parse(fileContent) as KonvaBoardState;

		// Validate the loaded state has required properties
		if (!loadedState.teamPlayers || !loadedState.skatingOfficials) {
			throw new Error('Invalid board state format');
		}

		// Update the store with the loaded state
		boardState.set({
			...loadedState,
			// Ensure we have the latest version number
			version: 3,
			// Update the timestamp when the state was loaded
			createdAt: loadedState.createdAt || new Date().toISOString()
		});

		// If game instance provided, refresh the board with new state
		if (game) {
			game.loadState();
		}
	} catch (error) {
		throw new Error(
			`Error loading board state: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
}
