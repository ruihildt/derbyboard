import type { SkatingOfficialRole } from '$lib/konva/KonvaSkatingOfficial';
import type { TeamPlayerRole, TeamPlayerTeam } from '$lib/konva/KonvaTeamPlayer';
import { persisted } from 'svelte-persisted-store';

// Position is relative to the center of the track
export interface TeamPlayerPosition {
	relative: {
		x: number;
		y: number;
	};
	role: TeamPlayerRole;
	team: TeamPlayerTeam;
}

export interface SkatingOfficialPosition {
	relative: {
		x: number;
		y: number;
	};
	role: SkatingOfficialRole;
}

interface ViewSettings {
	zoom: number;
	relativeX: number;
	relativeY: number;
}

export interface KonvaBoardState {
	version: number;
	createdAt: string;
	name?: string;
	teamPlayers: TeamPlayerPosition[];
	skatingOfficials: SkatingOfficialPosition[];
	viewSettings?: ViewSettings;
}

export const boardState = persisted<KonvaBoardState>('derbyboard-save', {
	version: 3,
	createdAt: new Date().toISOString(),
	teamPlayers: [],
	skatingOfficials: [],
	viewSettings: {
		zoom: 1,
		relativeX: 0,
		relativeY: 0
	}
});
