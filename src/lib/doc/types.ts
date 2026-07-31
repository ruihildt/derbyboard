export type EntityKind = 'skater' | 'official';

export type TeamPlayerRole = 'jammer' | 'blocker' | 'pivot';
export type TeamPlayerTeam = 'A' | 'B';

export type SkatingOfficialRole =
	'jamRefA' | 'jamRefB' | 'backPackRef' | 'frontPackRef' | 'outsidePackRef' | 'alternate';

/**
 * A point in the planar world plane, in metres. This is the **canonical** stored
 * coordinate system: entities, poses, paths and annotation geometry all live here.
 * Track space `(S, u)` is a derived view computed on demand by the track layer
 * (`$lib/track/trackLayer`) — only track-dependent features (auto-face, in-bounds)
 * ask the layer to convert.
 */
export interface PlanarPoint {
	x: number;
	y: number;
}

/**
 * How a skater's facing (looking direction) is resolved when auto-face is on:
 *  - `'relative'`: facing = track tangent + `headingDelta`. The authored
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

/** A world-space (track metres) point. Used for the pinned look-at target. */
export type WorldPoint = PlanarPoint;

/** Minimal flat style token. `color` is a CSS string; `width` in world metres (render-scaled). */
export interface AnnotationStyle {
	color: string;
	width?: number;
}

/**
 * Flat annotation union. Every kind carries `id`, a `style`, and its geometry
 * entirely in planar world metres. No nesting, no grouping. Captured clips do
 * not carry annotations — only authored-clip steps do.
 */
export type Annotation =
	| { id: string; kind: 'pen'; points: PlanarPoint[]; style: AnnotationStyle }
	| { id: string; kind: 'arrow'; from: PlanarPoint; to: PlanarPoint; style: AnnotationStyle }
	| { id: string; kind: 'zone'; points: PlanarPoint[]; style: AnnotationStyle }
	| { id: string; kind: 'label'; at: PlanarPoint; text: string; style: AnnotationStyle }
	| { id: string; kind: 'gap'; from: PlanarPoint; to: PlanarPoint; style: AnnotationStyle };

export interface Entity {
	id: string;
	kind: EntityKind;
	team?: TeamPlayerTeam;
	role: TeamPlayerRole | SkatingOfficialRole;
	x: number;
	y: number;
	heading: number;
	manualHeading?: boolean;
	headingMode?: HeadingMode;
	headingDelta?: number;
	lookAt?: WorldPoint;
}

export interface EntityPose {
	id: string;
	x: number;
	y: number;
	heading: number;
	manualHeading?: boolean;
	headingMode?: HeadingMode;
	headingDelta?: number;
	lookAt?: WorldPoint;
}

/** A per-entity movement path attached to a step. See locked decisions for ownership. */
export interface EntityPath {
	id: string;
	entityId: string;
	/** Ordered planar points. First ≈ entity's pose on this step; last ≈ next step's pose. */
	points: PlanarPoint[];
}

export interface Step {
	id: string;
	title?: string;
	entities: EntityPose[];
	/** @deprecated Under the fixed-duration model every step is exactly 1 s. Kept for backward-compat. */
	holdMs?: number;
	/** Freehand/marker annotations belonging to this step; appear/disappear with it. */
	annotations?: Annotation[];
	/** Per-entity movement paths; a path on step i describes motion during step i's second. */
	paths?: EntityPath[];
	/**
	 * Whether the pack / engagement-zone overlay is shown while this step is
	 * active. Per-step so a coach can author "show the pack here, hide it
	 * there". Undefined is treated as ON for backward compatibility with
	 * steps authored before the field existed.
	 */
	showPackZone?: boolean;
}

/** Hard cap on the number of steps per authored clip (each step = 1 second). */
export const MAX_STEPS_PER_CLIP = 8;

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

export const CURRENT_VERSION = 7;

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
