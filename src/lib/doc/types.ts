export type EntityKind = 'skater' | 'official';

export type TeamPlayerRole = 'jammer' | 'blocker' | 'pivot';
export type TeamPlayerTeam = 'A' | 'B';

export type SkatingOfficialRole =
	'jamRefA' | 'jamRefB' | 'backPackRef' | 'frontPackRef' | 'outsidePackRef' | 'alternate';

export interface Entity {
	id: string;
	kind: EntityKind;
	team?: TeamPlayerTeam;
	role: TeamPlayerRole | SkatingOfficialRole;
	S: number;
	u: number;
	heading: number;
}

export interface EntityPose {
	id: string;
	S: number;
	u: number;
	heading: number;
}

export interface Step {
	id: string;
	title?: string;
	entities: EntityPose[];
	holdMs?: number;
	annotations?: [];
}

export interface AuthoredClip {
	kind: 'authored';
	id: string;
	title?: string;
	steps: Step[];
}

export interface CapturedClipAudioMeta {
	file: string;
	durationMs: number;
	mimeType: string;
}

export interface CapturedClipFrame {
	region: {
		xFrac: number;
		yFrac: number;
		wFrac: number;
		hFrac: number;
	};
}

export interface CapturedClipSample {
	t: number;
	teamPlayers: Array<{
		id?: string;
		relative: { x: number; y: number };
		role: TeamPlayerRole;
		team: TeamPlayerTeam;
	}>;
	skatingOfficials: Array<{
		id?: string;
		relative: { x: number; y: number };
		role: SkatingOfficialRole;
	}>;
	view: {
		zoom: number;
		relativeX: number;
		relativeY: number;
	};
}

export interface CapturedClip {
	kind: 'captured';
	id: string;
	title?: string;
	createdAt?: string;
	durationMs?: number;
	samples: CapturedClipSample[];
	source: { w: number; h: number };
	audio?: CapturedClipAudioMeta;
	frame?: CapturedClipFrame;
}

export type Clip = AuthoredClip | CapturedClip;

export interface BoardDoc {
	version: number;
	createdAt: string;
	meta: {
		name?: string;
	};
	entities: Entity[];
	clips: Clip[];
	activeClipId: string | null;
}

export const CURRENT_VERSION = 1;

export function createEmptyDoc(): BoardDoc {
	return {
		version: CURRENT_VERSION,
		createdAt: new Date().toISOString(),
		meta: {},
		entities: [],
		clips: [],
		activeClipId: null
	};
}
