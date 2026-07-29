export type EntityKind = 'skater' | 'official';

export type TeamPlayerRole = 'jammer' | 'blocker' | 'pivot';
export type TeamPlayerTeam = 'A' | 'B';

export type SkatingOfficialRole =
	'jamRefA' | 'jamRefB' | 'backPackRef' | 'frontPackRef' | 'outsidePackRef' | 'alternate';

/**
 * How a skater's facing (looking direction) is resolved when auto-face is on:
 *  - `'relative'`: facing = track tangent at S + `headingDelta`. The authored
 *    rotation is an offset from the skating direction, so a skater turned 180°
 *    keeps facing 180° off as they move around the track. (Control icon: "A")
 *  - `'pinned'`: facing always points toward the fixed world point `lookAt`,
 *    regardless of where the skater is. The direction control is pinned to
 *    that map point. (Control icon: pin)
 *  - `'fixed'`: facing is an absolute world angle that never changes as the
 *    skater moves — the direction is frozen on the canvas. (Control icon: lock)
 * Absent means pure auto (facing = track tangent, delta 0).
 */
export type HeadingMode = 'relative' | 'pinned' | 'fixed';

/** A world-space (track metres) point. Used for the locked look-at target. */
export interface WorldPoint {
	x: number;
	y: number;
}

export interface Entity {
	id: string;
	kind: EntityKind;
	team?: TeamPlayerTeam;
	role: TeamPlayerRole | SkatingOfficialRole;
	S: number;
	u: number;
	heading: number;
	manualHeading?: boolean;
	headingMode?: HeadingMode;
	headingDelta?: number;
	lookAt?: WorldPoint;
}

export interface EntityPose {
	id: string;
	S: number;
	u: number;
	heading: number;
	manualHeading?: boolean;
	headingMode?: HeadingMode;
	headingDelta?: number;
	lookAt?: WorldPoint;
}

export interface Step {
	id: string;
	title?: string;
	entities: EntityPose[];
	holdMs?: number;
	annotations?: [];
	/**
	 * Whether the pack / engagement-zone overlay is shown while this step is
	 * active. Per-step so a coach can author "show the pack here, hide it
	 * there". Undefined is treated as ON for backward compatibility with
	 * steps authored before the field existed.
	 */
	showPackZone?: boolean;
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

export const CURRENT_VERSION = 5;

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
