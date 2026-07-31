import type { EntityPose, Step } from '$lib/doc/types';
import { unwrap, shortestDelta, LAP_LENGTH } from '$lib/track/trackFrame';
import { buildArcLength, sampleAtArcLength, pathTangentAt, type ArcLengthPath } from './pathMath';

/** Smooth ease-in/out so tweens read as acceleration/deceleration, not linear drift. */
export function easeInOutCubic(f: number): number {
	const x = Math.min(1, Math.max(0, f));
	return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Linear interpolation. */
function lerp(a: number, b: number, f: number): number {
	return a + (b - a) * f;
}

/**
 * Interpolate an angle along the shortest rotational direction. Heading is
 * stored as radians; lerping it naively spins the long way around across the
 * ±π boundary. Auto-face/manual heading land in P4, but the tween must still
 * carry heading without a visible 360° spin.
 */
function lerpAngle(a: number, b: number, f: number): number {
	let delta = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
	if (delta < -Math.PI) delta += 2 * Math.PI;
	return a + delta * f;
}

export interface TweenOptions {
	/** Easing applied to the normalised fraction before sampling poses. */
	ease?: (f: number) => number;
}

/**
 * Precompute arc-length-parametrised paths for one step, keyed by entityId.
 *
 * **Endpoint injection:** the path's first point is replaced with the entity's
 * pose on `step` (the FROM step), and the last point is replaced with the
 * entity's pose on `nextStep` (the TO step). This guarantees the path always
 * connects the two step poses — no matter where the coach started/ended the
 * freehand stroke — and stays in sync when either step's pose is edited.
 * The drawn interior points define the curve shape between those anchors.
 */
export function resolveStepPaths(
	step: Step | undefined,
	nextStep?: Step | undefined
): Map<string, ArcLengthPath> {
	const map = new Map<string, ArcLengthPath>();
	if (!step?.paths) return map;

	for (const path of step.paths) {
		// Look up the entity's actual poses to inject as path endpoints.
		const startPose = step.entities.find((e) => e.id === path.entityId);
		const endPose = nextStep?.entities.find((e) => e.id === path.entityId);

		const points = path.points.map((p) => ({ ...p }));

		// Replace first point with the FROM-step pose so the path starts
		// exactly where the skater is on step i.
		if (startPose && points.length > 0) {
			points[0] = { S: startPose.S, u: startPose.u };
		}

		// Replace last point with the TO-step pose so the path ends exactly
		// where the skater arrives on step i+1.
		if (endPose && points.length >= 2) {
			points[points.length - 1] = { S: endPose.S, u: endPose.u };
		}

		const arcPath = buildArcLength(points);
		if (arcPath.total > 0) {
			map.set(path.entityId, arcPath);
		}
	}

	return map;
}

/**
 * Track-aware interpolation between two entity poses.
 *
 * `S` is interpolated through the covering space using `unwrap` (nearest
 * equivalent), so an entity travelling from the end of a lap to the start
 * follows the track *forward across the seam* instead of cutting the infield
 * on a straight Cartesian lerp. `u` (lane) and `heading` interpolate directly.
 */
export function tweenPose(
	a: EntityPose,
	b: EntityPose,
	f: number,
	opts?: TweenOptions
): EntityPose {
	const eased = opts?.ease ? opts.ease(f) : f;
	const sTarget = unwrap(a.S, b.S);
	return {
		id: a.id,
		S: lerp(a.S, sTarget, eased),
		u: lerp(a.u, b.u, eased),
		heading: lerpAngle(a.heading, b.heading, eased)
	};
}

/**
 * Track-aware interpolation between two entity poses. If `path` is provided, samples the entity's
 * position along the arc-length-parametrised path at fraction `f` (uniform speed) instead of a
 * direct (S,u) lerp. Endpoints are CLAMPED to the exact `a`/`b` poses (locked decision). Heading:
 * if `path` is provided and `pathHeading` is true, derive from the path tangent; otherwise lerp
 * via lerpAngle as before.
 */
export function tweenPoseAlong(
	a: EntityPose,
	b: EntityPose,
	f: number,
	path: ArcLengthPath | undefined,
	pathHeading: boolean,
	opts?: TweenOptions
): EntityPose {
	const eased = opts?.ease ? opts.ease(f) : f;

	if (f <= 0) return { ...a };
	if (f >= 1) return { ...b };

	if (!path || path.total === 0) {
		return tweenPose(a, b, f, opts);
	}

	const sp = sampleAtArcLength(path, eased * path.total);
	let heading: number;

	if (pathHeading) {
		const t = pathTangentAt(path, eased);
		heading = Math.atan2(t.y, t.x);
	} else {
		heading = lerpAngle(a.heading, b.heading, eased);
	}

	return {
		id: a.id,
		S: sp.S,
		u: sp.u,
		heading
	};
}

/**
 * Interpolates a whole step's roster by id. Entities present in both are
 * tweened; entities present in only one are snapped (no invented motion).
 * This mirrors the captured-clip `lerpRoster` contract so a tween never
 * fabricates a pose for an entity that doesn't exist at one endpoint.
 */
export function tweenSteps(
	from: EntityPose[],
	to: EntityPose[],
	f: number,
	opts?: TweenOptions,
	/** Path map keyed by entityId, governing the from→to transition (paths live on the FROM step). */
	fromPaths?: Map<string, ArcLengthPath>,
	pathHeading?: boolean
): EntityPose[] {
	const byIdTo = new Map<string, EntityPose>();
	for (const p of to) byIdTo.set(p.id, p);

	const seen = new Set<string>();
	const result: EntityPose[] = [];

	for (const a of from) {
		seen.add(a.id);
		const b = byIdTo.get(a.id);
		const path = fromPaths?.get(a.id);
		if (b) {
			result.push(tweenPoseAlong(a, b, f, path, pathHeading ?? false, opts));
		} else {
			result.push({ ...a });
		}
	}
	for (const b of to) {
		if (!seen.has(b.id)) result.push({ ...b });
	}
	return result;
}

/**
 * The greatest arc-length (metres) any single entity travels between two
 * steps along the shortest path. Lane changes contribute their metre
 * equivalent via a representative lane width so a wide lateral move isn't
 * treated as instant. Used to derive tween duration.
 */
export function transitionDistanceMeters(from: EntityPose[], to: EntityPose[]): number {
	const byIdTo = new Map<string, EntityPose>();
	for (const p of to) byIdTo.set(p.id, p);

	let max = 0;
	for (const a of from) {
		const b = byIdTo.get(a.id);
		if (!b) continue;
		const arc = Math.abs(shortestDelta(a.S, b.S));
		const lane = Math.abs(b.u - a.u) * 4.0; // ~4 m typical lane width
		const d = Math.hypot(arc, lane);
		if (d > max) max = d;
	}
	return max;
}

// ── Fixed-duration step model ──────────────────────────────────────────────
// A step represents exactly one second of action. The coach authors in
// 1-second beats; path length (capped below) governs speed within that second.

/** Fixed duration of each step. Every step is exactly one second. */
export const STEP_DURATION_MS = 1000;

/** Maximum path arc-length in metres (~8 m/s sprint × 1 s). */
export const MAX_PATH_LENGTH_M = 8;

/** Maximum number of control points in an authored movement path. */
export const MAX_PATH_POINTS = 5;

/**
 * One step's time slot in the timeline. Under the fixed-duration model each
 * segment is exactly {@link STEP_DURATION_MS} long; `fromStep` is the step
 * whose second this is. The entity follows the path on step `fromStep` toward
 * step `fromStep + 1`'s pose (or the path's own endpoint if it's the last step).
 */
export interface TimelineSegment {
	/** Index of the step that owns this time slot. */
	fromStep: number;
	startMs: number;
	durationMs: number;
}

export interface AuthoredTimeline {
	segments: TimelineSegment[];
	totalMs: number;
	stepCount: number;
}

/**
 * Precomputes the authored-clip timeline. Under the fixed-duration model each
 * step occupies exactly {@link STEP_DURATION_MS} (1 second). For N steps there
 * are N segments, laid back-to-back starting at t=0. During step i's second
 * the entity either follows its path (if one exists) toward step i+1's pose,
 * or dwells at step i's pose. Even a single step has 1 s of duration so
 * playback always works.
 */
export function buildTimeline(
	steps: { entities: EntityPose[]; holdMs?: number }[]
): AuthoredTimeline {
	const stepCount = steps.length;
	const segments: TimelineSegment[] = [];
	for (let i = 0; i < stepCount; i++) {
		segments.push({
			fromStep: i,
			startMs: i * STEP_DURATION_MS,
			durationMs: STEP_DURATION_MS
		});
	}
	return { segments, totalMs: stepCount * STEP_DURATION_MS, stepCount };
}

export { LAP_LENGTH };

/**
 * Samples the authored-clip timeline at wall-clock time `t` (ms) and returns
 * the interpolated `EntityPose[]` for that instant. Pure (no rendering).
 *
 * Under the fixed-duration model, `t` falls within step i's 1-second slot.
 * If step i has a path, the entity follows it from step i's pose toward step
 * i+1's pose (or the path's own endpoint on the last step). If no path, the
 * entity dwells at step i's pose for the full second.
 */
export function sampleAuthoredAt(
	tl: AuthoredTimeline,
	steps: EntityPose[][],
	t: number,
	/** Optional per-step resolved path maps; stepMaps[i] governs step i's motion. */
	stepMaps?: Map<string, ArcLengthPath>[],
	pathHeading?: boolean
): EntityPose[] {
	const n = steps.length;
	if (n === 0) return [];
	if (t <= 0) return steps[0];

	const clampedT = Math.min(t, tl.totalMs);

	// Find the segment whose time slot contains t (last segment with startMs ≤ t).
	let seg: TimelineSegment | undefined;
	for (const s of tl.segments) {
		if (s.startMs <= clampedT) seg = s;
		else break;
	}
	if (!seg) return steps[0];

	const i = seg.fromStep;
	const f = seg.durationMs > 0 ? (clampedT - seg.startMs) / seg.durationMs : 0;
	const from = steps[i];
	const pathMap = stepMaps?.[i];

	// Destination poses: next step's poses, or synthesised from the path's own
	// endpoint when this is the last step (self-contained path playback).
	let to: EntityPose[];
	if (i < n - 1) {
		to = steps[i + 1];
	} else {
		to = from.map((p) => {
			const ap = pathMap?.get(p.id);
			if (ap && ap.points.length > 0) {
				const end = ap.points[ap.points.length - 1];
				return { ...p, S: end.S, u: end.u };
			}
			return p; // no path → stays put
		});
	}

	return tweenSteps(from, to, f, { ease: easeInOutCubic }, pathMap, pathHeading);
}

/**
 * The step index nearest to wall-clock time `t` — used to highlight the
 * StepStrip chip that playback is currently heading toward. At the halfway
 * point of a step's second it tips to the arrival step.
 */
export function nearestStepAt(tl: AuthoredTimeline, t: number): number {
	const n = tl.stepCount;
	if (n === 0) return -1;
	if (t <= 0) return 0;
	if (t >= tl.totalMs) return n - 1;

	let seg: TimelineSegment | undefined;
	for (const s of tl.segments) {
		if (s.startMs <= t) seg = s;
		else break;
	}
	if (!seg) return 0;

	// The last step is always "current" during its own second.
	if (seg.fromStep >= n - 1) return n - 1;

	const f = seg.durationMs > 0 ? (t - seg.startMs) / seg.durationMs : 0;
	return f < 0.5 ? seg.fromStep : seg.fromStep + 1;
}
