import type { Snapshot, TimelineProject, TimelineSample } from './types';

type Positioned = { id?: string; relative: { x: number; y: number } };

function lerp(a: number, b: number, f: number): number {
	return a + (b - a) * f;
}

/**
 * Linearly interpolates two rosters by id. Entities present in both are
 * interpolated; entities present in only one are snapped (not lerped in/out).
 */
function lerpRoster<T extends Positioned>(a: T[], b: T[], f: number): T[] {
	const byIdB = new Map<string, T>();
	for (const p of b) {
		if (p.id) byIdB.set(p.id, p);
	}

	const result: T[] = [];
	const seen = new Set<string>();

	for (const pa of a) {
		const id = pa.id ?? '';
		if (id) seen.add(id);
		const pb = id ? byIdB.get(id) : undefined;
		if (pb) {
			result.push({
				...pa,
				relative: {
					x: lerp(pa.relative.x, pb.relative.x, f),
					y: lerp(pa.relative.y, pb.relative.y, f)
				}
			});
		} else {
			result.push({ ...pa }); // snap: present only in `a`
		}
	}

	for (const pb of b) {
		const id = pb.id ?? '';
		if (id && !seen.has(id)) {
			result.push({ ...pb }); // snap: present only in `b`
		}
	}

	return result;
}

function rosterEqual(a: Positioned[], b: Positioned[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id) return false;
		if (a[i].relative.x !== b[i].relative.x || a[i].relative.y !== b[i].relative.y) return false;
	}
	return true;
}

/**
 * True when two samples are positionally identical (rosters + view). The
 * recorder's hold anchors create long plateaus of such pairs; detecting them
 * lets replay skip the per-frame roster rebuild (Maps/Sets/spreads per
 * entity) for a result identical to the previous frame anyway.
 */
function samplesEqual(a: TimelineSample, b: TimelineSample): boolean {
	if (a.view.zoom !== b.view.zoom) return false;
	if (a.view.relativeX !== b.view.relativeX) return false;
	if (a.view.relativeY !== b.view.relativeY) return false;
	if (a.pathFrame !== b.pathFrame) return false;
	return (
		rosterEqual(a.teamPlayers, b.teamPlayers) && rosterEqual(a.skatingOfficials, b.skatingOfficials)
	);
}

/**
 * Binary-searches the surrounding samples in a project and interpolates the
 * board state at time `t` (ms). Clamps to the first/last sample at the ends.
 */
export function interpolateSample(project: TimelineProject, t: number): TimelineSample {
	const samples = project.samples;
	const n = samples.length;
	const empty: Snapshot = {
		teamPlayers: [],
		skatingOfficials: [],
		view: { zoom: 1, relativeX: 0, relativeY: 0 }
	};
	if (n === 0) return { t, ...empty };

	if (t <= samples[0].t) return { ...samples[0], t };
	const last = samples[n - 1];
	if (t >= last.t) return { ...last, t };

	// Find i with samples[i].t <= t < samples[i + 1].t.
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (samples[mid].t <= t) lo = mid;
		else hi = mid - 1;
	}
	const a = samples[lo];
	const b = samples[lo + 1] ?? a;

	// Hold-plateau fast path: identical endpoints interpolate to themselves.
	if (a === b || samplesEqual(a, b)) return { ...a, t };

	const span = b.t - a.t;
	const f = span > 0 ? (t - a.t) / span : 0;

	const view = {
		zoom: lerp(a.view.zoom, b.view.zoom, f),
		relativeX: lerp(a.view.relativeX, b.view.relativeX, f),
		relativeY: lerp(a.view.relativeY, b.view.relativeY, f)
	};

	return {
		t,
		teamPlayers: lerpRoster(a.teamPlayers, b.teamPlayers, f),
		skatingOfficials: lerpRoster(a.skatingOfficials, b.skatingOfficials, f),
		view,
		pathFrame: f < 0.5 ? a.pathFrame : b.pathFrame
	};
}
