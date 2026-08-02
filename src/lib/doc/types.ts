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
 * Pins an annotation to a single step. Absent `scope` ⇒ the mark is board-wide
 * (shown on every step and in free play).
 */
export interface AnnotationScope {
	stepId: string;
}

/**
 * An affine manipulation of an annotation's base geometry, expressed in planar
 * metres. The base geometry (points/from/to/at) never changes; move/resize/
 * rotate edit this transform instead, so the selection box can stay oriented
 * with the element and re-select consistently. Absent means identity.
 *
 * Effective anchor = `cx,cy + R(angle) * (sx*(b.x-baseCx), sy*(b.y-baseCy))`
 * where `baseCx,baseCy` is the centre of the base geometry's axis-aligned
 * bounding box (derived, not stored). `sx/sy` are per-axis scales relative to
 * that base box; `angle` is radians.
 */
export interface AnnotationTransform {
	cx: number;
	cy: number;
	angle: number;
	sx: number;
	sy: number;
}

/** Fields shared by every annotation kind. */
export interface AnnotationBase {
	id: string;
	style: AnnotationStyle;
	/** Pin a mark to one step; absent means board-wide (shown everywhere). */
	scope?: AnnotationScope;
	/** Move/resize/rotate manipulation; absent means identity. */
	transform?: AnnotationTransform;
}

/**
 * Flat annotation union. Every kind shares `AnnotationBase` (id + style +
 * optional `scope`) and carries its geometry entirely in planar world metres.
 * No nesting, no grouping. All annotations live board-wide on
 * `BoardDoc.annotations`; `scope.stepId` makes a mark visible only on that step.
 */
export type Annotation =
	| (AnnotationBase & { kind: 'pen'; points: PlanarPoint[] })
	| (AnnotationBase & { kind: 'arrow'; points: PlanarPoint[] })
	| (AnnotationBase & { kind: 'zone'; points: PlanarPoint[] })
	| (AnnotationBase & { kind: 'label'; at: PlanarPoint; text: string })
	| (AnnotationBase & { kind: 'gap'; from: PlanarPoint; to: PlanarPoint });

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
	/** Board-wide annotations. Each may carry an optional `scope` to pin it to a
	 * single step; absent scope ⇒ shown everywhere. Absent array means none. */
	annotations?: Annotation[];
}

export const CURRENT_VERSION = 9;

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
