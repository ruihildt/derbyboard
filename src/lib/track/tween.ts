import type { EntityPose } from '$lib/doc/types';
import { LAP_LENGTH, unwrap, shortestDelta } from '$lib/track/trackFrame';

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
 * Interpolates a whole step's roster by id. Entities present in both are
 * tweened; entities present in only one are snapped (no invented motion).
 * This mirrors the captured-clip `lerpRoster` contract so a tween never
 * fabricates a pose for an entity that doesn't exist at one endpoint.
 */
export function tweenSteps(
	from: EntityPose[],
	to: EntityPose[],
	f: number,
	opts?: TweenOptions
): EntityPose[] {
	const byIdTo = new Map<string, EntityPose>();
	for (const p of to) byIdTo.set(p.id, p);

	const seen = new Set<string>();
	const result: EntityPose[] = [];

	for (const a of from) {
		seen.add(a.id);
		const b = byIdTo.get(a.id);
		result.push(b ? tweenPose(a, b, f, opts) : { ...a });
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

const DURATION_MIN_MS = 500;
const DURATION_MAX_MS = 3200;
const METRES_PER_SECOND = 6.5; // brisk skating pace; drives the "feel" of a transition

/**
 * Per-transition duration derived from the furthest-travelling entity, clamped
 * to a sensible band so tiny nudges still read and full-straight moves don't
 * drag. Coarse speed presets (0.25/0.5/1) scale this at playback time; the
 * duration itself is never exposed as a numeric authoring field (standing rule).
 */
export function transitionDurationMs(from: EntityPose[], to: EntityPose[]): number {
	const d = transitionDistanceMeters(from, to);
	const ms = (d / METRES_PER_SECOND) * 1000;
	return Math.min(DURATION_MAX_MS, Math.max(d > 0.05 ? DURATION_MIN_MS : 0, ms));
}

/**
 * Precomputes the authored-clip timeline: for N steps there are N−1
 * transitions, each placed back-to-back. Returns cumulative start times (ms)
 * so a player can binary-search a wall-clock `t` into a transition + fraction.
 * `holdMs` adds a dwell at each step before its outgoing transition.
 */
export interface TimelineSegment {
	/** Index of the "from" step; the transition ends at `from + 1`. */
	fromStep: number;
	startMs: number;
	durationMs: number;
}

export interface AuthoredTimeline {
	segments: TimelineSegment[];
	totalMs: number;
	stepCount: number;
}

export function buildTimeline(
	steps: { entities: EntityPose[]; holdMs?: number }[]
): AuthoredTimeline {
	const segments: TimelineSegment[] = [];
	let t = 0;
	for (let i = 0; i < steps.length - 1; i++) {
		const hold = steps[i].holdMs ?? 0;
		t += hold;
		const dur = transitionDurationMs(steps[i].entities, steps[i + 1].entities);
		segments.push({ fromStep: i, startMs: t, durationMs: dur });
		t += dur;
	}
	// Account for the final step's hold (dwell at the end).
	if (steps.length > 0) {
		t += steps[steps.length - 1].holdMs ?? 0;
	}
	return { segments, totalMs: t, stepCount: steps.length };
}

export { LAP_LENGTH };

/**
 * Samples the authored-clip timeline at wall-clock time `t` (ms) and returns
 * the interpolated `EntityPose[]` for that instant. Pure (no rendering) so it
 * can be unit-tested and reused by both the live player and any future
 * exporter. Holds dwell on the arrival step; the seam between a transition and
 * its following hold is exact (arrival pose at f=1).
 */
export function sampleAuthoredAt(
	tl: AuthoredTimeline,
	steps: EntityPose[][],
	t: number
): EntityPose[] {
	const n = steps.length;
	if (n === 0) return [];
	if (n === 1 || t <= 0) return steps[0];
	if (t >= tl.totalMs) return steps[n - 1];

	// Find the last segment whose start is <= t (segments are ordered).
	let seg: TimelineSegment | undefined;
	for (const s of tl.segments) {
		if (s.startMs <= t) seg = s;
		else break;
	}
	if (!seg) return steps[0];

	const transitionEnd = seg.startMs + seg.durationMs;
	if (t < transitionEnd) {
		const f = seg.durationMs > 0 ? (t - seg.startMs) / seg.durationMs : 1;
		return tweenSteps(steps[seg.fromStep], steps[seg.fromStep + 1], f, {
			ease: easeInOutCubic
		});
	}
	// Past this transition but before the next: dwelling on the arrival step.
	return steps[seg.fromStep + 1];
}

/**
 * The step index nearest to wall-clock time `t` — used to highlight the
 * StepStrip chip that playback is currently heading toward. At the halfway
 * point of a transition it tips to the arrival step.
 */
export function nearestStepAt(tl: AuthoredTimeline, t: number): number {
	const n = tl.stepCount;
	if (n === 0) return -1;
	if (n === 1 || t <= 0) return 0;
	if (t >= tl.totalMs) return n - 1;
	let seg: TimelineSegment | undefined;
	for (const s of tl.segments) {
		if (s.startMs <= t) seg = s;
		else break;
	}
	if (!seg) return 0;
	const transitionEnd = seg.startMs + seg.durationMs;
	if (t < transitionEnd) {
		const f = seg.durationMs > 0 ? (t - seg.startMs) / seg.durationMs : 1;
		return f < 0.5 ? seg.fromStep : seg.fromStep + 1;
	}
	return seg.fromStep + 1;
}
