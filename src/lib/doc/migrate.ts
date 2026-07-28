import type { BoardDoc, Entity, CapturedClip } from './types';
import type { KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TimelineProject } from '$lib/recording/timeline/types';
import { toTrack, fromTrack } from '$lib/track/trackFrame';
import { TRACK_SCALE } from '$lib/constants';
import { createEmptyDoc } from './types';

/**
 * Coerces a persisted coordinate to a finite number. `JSON.stringify` turns
 * `NaN` into `null`; a previously-corrupted save can therefore arrive with
 * `null` (or genuinely undefined) coordinates. Coerce those to 0 rather than
 * letting `null / TRACK_SCALE` quirks or NaN propagate into the document.
 */
function finiteOrZero(v: number | null | undefined): number {
	const n = typeof v === 'number' ? v : 0;
	return Number.isFinite(n) ? n : 0;
}

/**
 * Migrate boardState v3 (pixel-relative positions) to BoardDoc v1 (track space S, u).
 * The viewport center is assumed to be at (0, 0) in the relative coordinate system.
 */
export function migrateBoardState(state: KonvaBoardState): BoardDoc {
	const doc = createEmptyDoc();
	doc.createdAt = state.createdAt;
	doc.meta.name = state.name;

	// Convert team players
	for (const player of state.teamPlayers) {
		const id = player.id || crypto.randomUUID();
		// Relative position is already relative to center, so we can use it directly as meters
		// by dividing by TRACK_SCALE
		const meterPos = {
			x: finiteOrZero(player.relative.x) / TRACK_SCALE,
			y: finiteOrZero(player.relative.y) / TRACK_SCALE
		};
		const { s, u } = toTrack(meterPos);

		doc.entities.push({
			id,
			kind: 'skater',
			team: player.team,
			role: player.role,
			S: s,
			u,
			heading: 0
		});
	}

	// Convert skating officials
	for (const official of state.skatingOfficials) {
		const id = official.id || crypto.randomUUID();
		const meterPos = {
			x: finiteOrZero(official.relative.x) / TRACK_SCALE,
			y: finiteOrZero(official.relative.y) / TRACK_SCALE
		};
		const { s, u } = toTrack(meterPos);

		doc.entities.push({
			id,
			kind: 'official',
			role: official.role,
			S: s,
			u,
			heading: 0
		});
	}

	return doc;
}

/**
 * Migrate TimelineProject v1 to a CapturedClip.
 * The samples are kept as-is (pixel-relative format) for backward compatibility.
 */
export function migrateTimelineProject(project: TimelineProject): CapturedClip {
	return {
		kind: 'captured',
		id: crypto.randomUUID(),
		createdAt: project.createdAt,
		durationMs: project.durationMs,
		samples: project.samples,
		source: project.source,
		audio: project.audio,
		frame: project.frame
	};
}

/**
 * Convert a BoardDoc entity back to pixel-relative position for rendering.
 * This is the inverse of the migration process.
 */
export function entityToPixelRelative(entity: Entity): { x: number; y: number } {
	const meterPos = fromTrack(entity.S, entity.u);
	return {
		x: meterPos.x * TRACK_SCALE,
		y: meterPos.y * TRACK_SCALE
	};
}
