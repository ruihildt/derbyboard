import type { BoardDoc, EntityKind } from '$lib/doc/types';
import type { DrawTool } from '$lib/stores/toolMode';
import { getActiveClip } from '$lib/doc/clipOps';

/**
 * The user-facing experiences. An experience is **derived from the document
 * shape** (single source of truth), never an independent toggle:
 *  - no active authored clip → `free`
 *  - an active authored clip → `drill`
 */
export type Experience = 'free' | 'drill';

/**
 * The capabilities an experience exposes. Components gate on these, never on
 * `activeClipId` / `isAuthoring` mode strings. Track/auto-face presence is
 * intentionally omitted here — the track stays always-rendered and auto-face
 * always-on until the trackless work lands in a later phase.
 */
export interface Capabilities {
	experience: Experience;
	/** User-facing label ("Free Play" / "Drill"). */
	label: string;
	/** Whether the step timeline (steps, scrub, playback) is available. */
	timeline: boolean;
	/** View tools available in this experience. Free Play exposes the
	 * select/hand pair plus the annotation tools; Drill admits the full
	 * authoring palette (adds the step-scoped `drawPath`/`gap` tools). */
	admittedTools: DrawTool[];
	/**
	 * Entity kinds this experience admits. Today both are skater/official; the
	 * `cone` kind (Phase 3) will land on this seam — added to free/drill
	 * without touching any other code.
	 */
	admittedEntityKinds: EntityKind[];
}

/**
 * View tools admitted in every experience: `select` (edit/select entities)
 * and `hand` (pan the canvas).
 */
export const VIEW_TOOLS: DrawTool[] = ['select', 'hand'];

/**
 * Annotation/drawing tools that lay marks directly on the board surface with
 * no step required — admitted in both Free Play and Drill. Includes `erase`,
 * which removes an annotation by tapping it (annotations only; never players
 * or movement paths).
 */
export const ANNOTATION_TOOLS: DrawTool[] = ['pen', 'arrow', 'zone', 'label', 'erase'];

/**
 * Step-scoped authoring tools, admitted only by Drill: `drawPath` (movement
 * paths need a step) and `gap` (the measurement tool).
 */
export const DRILL_ONLY_TOOLS: DrawTool[] = ['drawPath', 'gap'];

/**
 * The full tool palette admitted by Drill — view tools plus annotations plus
 * the step-scoped authoring tools. Free Play admits `VIEW_TOOLS` plus
 * `ANNOTATION_TOOLS`.
 */
export const ALL_TOOLS: DrawTool[] = [...VIEW_TOOLS, ...ANNOTATION_TOOLS, ...DRILL_ONLY_TOOLS];

/** Free Play's palette: view tools plus the board-level annotation tools. */
export const FREE_TOOLS: DrawTool[] = [...VIEW_TOOLS, ...ANNOTATION_TOOLS];

interface ExperienceEntry {
	timeline: boolean;
	admittedTools: DrawTool[];
	admittedEntityKinds: EntityKind[];
}

const REGISTRY: Record<Experience, ExperienceEntry> = {
	free: {
		timeline: false,
		admittedTools: FREE_TOOLS,
		admittedEntityKinds: ['skater', 'official']
	},
	drill: {
		timeline: true,
		admittedTools: ALL_TOOLS,
		admittedEntityKinds: ['skater', 'official']
	}
};

const LABELS: Record<Experience, string> = {
	free: 'Free Play',
	drill: 'Drill'
};

/**
 * Derives the experience from the document's shape: no active authored clip →
 * `free`; any active authored clip → `drill`.
 */
export function getExperience(doc: BoardDoc): Experience {
	const clip = getActiveClip(doc);
	if (!clip) return 'free';
	return 'drill';
}

/**
 * Resolves the full capability bundle for a document: experience + label +
 * the registry entry. This is the single entry point components should call
 * to decide what to render.
 */
export function getCapabilities(doc: BoardDoc): Capabilities {
	const experience = getExperience(doc);
	const entry = REGISTRY[experience];
	return {
		experience,
		label: LABELS[experience],
		...entry
	};
}
