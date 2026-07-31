import type { PlanarPoint } from '$lib/doc/types';
import {
	fromTrack as frameFromTrack,
	toTrack as frameToTrack,
	tangentAt as frameTangentAt,
	laneBounds as frameLaneBounds,
	isInBoundsTrack
} from './trackFrame';

/**
 * A point in canonical track space. `S` is wrapped to [0, LAP_LENGTH). This is a
 * **derived** view of a {@link PlanarPoint}: the track layer converts on demand.
 * Track-dependent features (auto-face tangent, in-bounds) use it.
 */
export interface TrackPoint {
	S: number;
	u: number;
}

/**
 * The optional track layer. Converts the canonical planar position `(x, y)` to
 * and from track space `(S, u)` and exposes the track-semantic helpers (tangent,
 * lane bounds, in-bounds) that only make sense when a track is present.
 *
 * In phase 1 the track is always present, so {@link trackLayer} is a non-null
 * singleton wrapping `trackFrame`. Track-optional UX (phase 2) makes the layer
 * absent, at which point every consumer that already routes through it simply
 * gets no track semantics — no per-call-site fork required.
 */
export interface TrackContext {
	/** Planar `(x, y)` metres → track space `(S, u)` (wrapped S). */
	toTrack(p: PlanarPoint): TrackPoint;
	/** Track space `(S, u)` → planar `(x, y)` metres. */
	fromTrack(S: number, u: number): PlanarPoint;
	/** Unit tangent of the skating direction at a planar point. */
	tangentAt(p: PlanarPoint): PlanarPoint;
	/** Inner/outer lane offsets (metres from the measurement line) at a planar point. */
	laneBounds(p: PlanarPoint): { inner: number; outer: number };
	/** Whether a planar pose (with drawn radius) is in bounds. */
	isInBounds(p: PlanarPoint, radiusM?: number): boolean;
}

/**
 * The always-on track context (phase 1). Thin wrappers over `trackFrame` that
 * accept/return planar positions at the boundary, so callers never touch `(S, u)`
 * directly unless they need a track-semantic value.
 */
export const trackLayer: TrackContext = {
	toTrack: (p) => {
		const { s, u } = frameToTrack(p);
		return { S: s, u };
	},
	fromTrack: (S, u) => frameFromTrack(S, u),
	tangentAt: (p) => {
		const { s } = frameToTrack(p);
		return frameTangentAt(s);
	},
	laneBounds: (p) => {
		const { s } = frameToTrack(p);
		return frameLaneBounds(s);
	},
	isInBounds: (p, radiusM = 0) => {
		const { s, u } = frameToTrack(p);
		return isInBoundsTrack(s, u, radiusM);
	}
};
