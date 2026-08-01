import type {
	BoardDoc,
	Entity,
	CapturedClip,
	EntityPose,
	EntityPath,
	Annotation,
	Step,
	PlanarPoint
} from './types';
import { CURRENT_VERSION } from './types';
import type { KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TimelineProject } from '$lib/recording/timeline/types';
import { fromTrack } from '$lib/track/trackFrame';
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
 * Migrate boardState v3 (pixel-relative positions) to BoardDoc v7 (planar
 * world metres). The viewport center is assumed to be at (0, 0) in the relative
 * coordinate system, so a pixel-relative `(rx, ry)` maps to world metres
 * `(rx / TRACK_SCALE, ry / TRACK_SCALE)` directly — no track conversion.
 */
export function migrateBoardState(state: KonvaBoardState): BoardDoc {
	const doc = createEmptyDoc();
	doc.createdAt = state.createdAt;
	doc.meta.name = state.name;

	// Convert team players
	for (const player of state.teamPlayers) {
		const id = player.id || crypto.randomUUID();
		// Relative position is already relative to center, so we can use it
		// directly as metres by dividing by TRACK_SCALE.
		const x = finiteOrZero(player.relative.x) / TRACK_SCALE;
		const y = finiteOrZero(player.relative.y) / TRACK_SCALE;

		doc.entities.push({
			id,
			kind: 'skater',
			team: player.team,
			role: player.role,
			x,
			y,
			heading: 0
		});
	}

	// Convert skating officials
	for (const official of state.skatingOfficials) {
		const id = official.id || crypto.randomUUID();
		const x = finiteOrZero(official.relative.x) / TRACK_SCALE;
		const y = finiteOrZero(official.relative.y) / TRACK_SCALE;

		doc.entities.push({
			id,
			kind: 'official',
			role: official.role,
			x,
			y,
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
 * Convert a BoardDoc entity to pixel-relative position for rendering.
 * Positions are already planar metres, so this is a direct scale.
 */
export function entityToPixelRelative(entity: Entity): { x: number; y: number } {
	return {
		x: entity.x * TRACK_SCALE,
		y: entity.y * TRACK_SCALE
	};
}

/**
 * Forward-migrate a loaded `BoardDoc` to the current schema version. Each
 * step is additive and idempotent: it leaves already-current documents
 * untouched and fills defaults for fields introduced by that version.
 *
 * Version history:
 *  - v1 → v2: added optional `showPackZone` to `Step` (defaults to ON when
 *    absent, so existing authored steps keep showing the overlay).
 *  - v2 → v3: added optional `manualHeading` to `Entity` and `EntityPose`.
 *    Absent means auto (false), matching pre-v3 behaviour.
 *  - v3 → v4: added optional `headingMode` / `headingDelta` / `lookAt` to
 *    `Entity` and `EntityPose` for the two-mode direction control. Absent
 *    means pure auto, matching pre-v4 behaviour.
 *  - v4 → v5: the look-at mode was renamed `'locked'` → `'pinned'`, and a new
 *    `'fixed'` (absolute-heading) mode was added. Existing `'locked'` values
 *    are relabelled to `'pinned'` (behaviour unchanged).
 *  - v5 → v6: added optional `annotations: Annotation[]` and `paths: EntityPath[]` to `Step`
 *    (geometry in track space). Absent means none, matching pre-v6 behaviour.
 *  - v6 → v7: the canonical stored coordinate system moved from track space
 *    `(S, u)` to planar world metres `(x, y)`. Every stored pose (`Entity`/
 *    `EntityPose`), path point and annotation geometry is converted via
 *    `fromTrack(S, u)`; heading modes and metadata are unchanged. `(S, u)`
 *    becomes a derived view computed on demand by the track layer.
 *  - v7 → v8: added optional `domain` to `AuthoredClip` (derives the
 *    experience — Drill vs Strategy). Absent means `'practice'`, matching
 *    pre-v8 authored clips. No coordinate work: planar is already canonical.
 */
export function migrateBoardDoc(doc: BoardDoc): BoardDoc {
	let next = doc;

	if (next.version < 2) {
		// Defensive copy so we never mutate the caller's object.
		next = {
			...next,
			clips: next.clips.map((clip) =>
				clip.kind === 'authored'
					? { ...clip, steps: clip.steps.map((step) => ({ ...step })) }
					: clip
			)
		};
		// `showPackZone` is intentionally left undefined here: absent means ON,
		// matching pre-v2 authored behaviour.
		next.version = 2;
	}

	if (next.version < 3) {
		// Defensive copy for v3 migration.
		next = {
			...next,
			entities: next.entities.map((e) => ({ ...e })),
			clips: next.clips.map((clip) =>
				clip.kind === 'authored'
					? {
							...clip,
							steps: clip.steps.map((step) => ({
								...step,
								entities: step.entities.map((p) => ({ ...p }))
							}))
						}
					: clip
			)
		};
		// `manualHeading` is intentionally left undefined here: absent means auto,
		// matching pre-v3 behaviour.
		next.version = 3;
	}

	if (next.version < 4) {
		// Defensive copy for v4 migration. The new fields stay undefined
		// (absent = pure auto), so no data needs to be synthesised.
		next = {
			...next,
			entities: next.entities.map((e) => ({ ...e })),
			clips: next.clips.map((clip) =>
				clip.kind === 'authored'
					? {
							...clip,
							steps: clip.steps.map((step) => ({
								...step,
								entities: step.entities.map((p) => ({ ...p }))
							}))
						}
					: clip
			)
		};
		next.version = 4;
	}

	if (next.version < 5) {
		// Relabel the look-at heading mode `'locked'` → `'pinned'` on entities
		// and authored step poses. `'fixed'` (new) needs no synthesis.
		const relabel = (p: { headingMode?: string }) => {
			if (p.headingMode === 'locked') p.headingMode = 'pinned';
		};
		next = {
			...next,
			entities: next.entities.map((e) => {
				const c = { ...e };
				relabel(c);
				return c;
			}),
			clips: next.clips.map((clip) =>
				clip.kind === 'authored'
					? {
							...clip,
							steps: clip.steps.map((step) => ({
								...step,
								entities: step.entities.map((p) => {
									const c = { ...p };
									relabel(c);
									return c;
								})
							}))
						}
					: clip
			)
		};
		next.version = 5;
	}

	if (next.version < 6) {
		// Defensive copy so we never mutate the caller's object. The new `annotations`
		// and `paths` fields stay undefined (absent = none), so no data is synthesised.
		next = {
			...next,
			clips: next.clips.map((clip) =>
				clip.kind === 'authored'
					? { ...clip, steps: clip.steps.map((step) => ({ ...step })) }
					: clip
			)
		};
		next.version = 6;
	}

	if (next.version < 7) {
		next = migrateV6ToV7(next);
		next.version = 7;
	}

	next.version = CURRENT_VERSION;
	return next;
}

/**
 * v6 → v7: convert every stored `(S, u)` to planar `(x, y)` metres via
 * `fromTrack`. Applies to board entities, authored step poses, movement-path
 * points and annotation geometry. This is a near-exact inverse for in-bounds
 * poses (the realistic case); see the `toTrack` singularity note for the
 * deep-infield caveat. Non-finite coordinates are coerced to 0.
 */
function migrateV6ToV7(doc: BoardDoc): BoardDoc {
	const posFromTrack = (S: number | undefined, u: number | undefined): { x: number; y: number } => {
		const s = typeof S === 'number' && Number.isFinite(S) ? S : 0;
		const lane = typeof u === 'number' && Number.isFinite(u) ? u : 0.5;
		const m = fromTrack(s, lane);
		return { x: Number.isFinite(m.x) ? m.x : 0, y: Number.isFinite(m.y) ? m.y : 0 };
	};

	const convertPose = <P extends { S?: number; u?: number; x?: number; y?: number }>(
		p: P
	): P & { x: number; y: number } => {
		// Idempotent: a pose already in v7 form (has x/y, no S/u) is left as-is.
		if ((p.x !== undefined || p.y !== undefined) && p.S === undefined && p.u === undefined) {
			return { ...p, x: p.x ?? 0, y: p.y ?? 0 } as P & { x: number; y: number };
		}
		const { x, y } = posFromTrack(p.S, p.u);
		// Strip the legacy S/u keys (keep all other fields), then add x/y.
		const rest = { ...p } as Record<string, unknown>;
		delete rest.S;
		delete rest.u;
		return { ...(rest as P), x, y };
	};

	// A legacy (v6) geometry point may carry `S`/`u`; an already-planar point
	// carries `x`/`y`. Detect by shape (via unknown) and convert as needed.
	const pointToPlanar = (pt: PlanarPoint): PlanarPoint => {
		const raw = pt as unknown as { x?: number; y?: number; S?: number; u?: number };
		if (raw.x !== undefined && raw.S === undefined) {
			return { x: raw.x, y: raw.y ?? 0 };
		}
		return posFromTrack(raw.S, raw.u);
	};

	const convertPath = (path: EntityPath): EntityPath => ({
		...path,
		points: path.points.map(pointToPlanar)
	});

	const convertAnn = (ann: Annotation): Annotation => {
		if (ann.kind === 'pen' || ann.kind === 'zone') {
			return {
				...ann,
				points: ann.points.map(pointToPlanar)
			} as Annotation;
		}
		if (ann.kind === 'arrow' || ann.kind === 'gap') {
			return {
				...ann,
				from: pointToPlanar(ann.from),
				to: pointToPlanar(ann.to)
			} as Annotation;
		}
		// label
		return { ...ann, at: pointToPlanar(ann.at) } as Annotation;
	};

	const convertStep = (step: Step): Step => {
		const entities = step.entities.map((e) => convertPose(e as EntityPose) as EntityPose);
		const out: Step = { ...step, entities };
		if (step.paths) out.paths = step.paths.map(convertPath);
		if (step.annotations) out.annotations = step.annotations.map(convertAnn);
		return out;
	};

	const convertClip = (clip: BoardDoc['clips'][number]): BoardDoc['clips'][number] =>
		clip.kind === 'authored' ? { ...clip, steps: clip.steps.map(convertStep) } : clip;

	return {
		...doc,
		entities: doc.entities.map((e) => convertPose(e as Entity) as Entity),
		clips: doc.clips.map(convertClip)
	};
}
