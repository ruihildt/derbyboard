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
	/** Drawing tools available in this experience (empty for Free this phase). */
	admittedTools: DrawTool[];
	/**
	 * Entity kinds this experience admits. Today both are skater/official; the
	 * `cone` kind (Phase 3) will land on this seam — added to free/drill
	 * without touching any other code.
	 */
	admittedEntityKinds: EntityKind[];
}

/**
 * The full authoring tool palette — the seven tools in the top control bar.
 * Admitted by Drill; withheld from Free this phase (Free's universal props
 * arrive with `BoardDoc.props` in Phase 4).
 */
export const ALL_TOOLS: DrawTool[] = ['select', 'drawPath', 'pen', 'arrow', 'zone', 'label', 'gap'];

interface ExperienceEntry {
	timeline: boolean;
	admittedTools: DrawTool[];
	admittedEntityKinds: EntityKind[];
}

const REGISTRY: Record<Experience, ExperienceEntry> = {
	free: {
		timeline: false,
		admittedTools: [],
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
