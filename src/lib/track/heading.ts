import { trackLayer } from './trackLayer';
import type { EntityPose, PlanarPoint } from '$lib/doc/types';

const REST_EPS = 0.001; // 1mm in world metres; movement below this is considered at rest.

/**
 * Resolves a single pose's facing (looking) direction.
 *
 * The chevron represents where the skater is **looking**, which is conceptually
 * independent of movement. Resolution order (when auto-face is on):
 *  1. `'pinned'` mode + `lookAt` ⇒ face the fixed world point from this pose.
 *     Uses the planar `atan2` directly (no track conversion).
 *  2. `'fixed'` mode ⇒ the stored absolute heading, frozen on the canvas.
 *  3. `'relative'` mode (or a `headingDelta`) ⇒ track tangent at this position
 *     + delta, via the track layer. The delta is an offset from the skating
 *     direction, so a skater turned 180° keeps facing 180° off as they move.
 *  4. otherwise ⇒ track tangent at this position (pure auto, delta 0), via the
 *     track layer.
 *
 * When `autoFace` is off, or a legacy `manualHeading` flag is set, the stored
 * absolute `heading` is used as-is. Modes 1–3 are functions of stored data
 * only (not step-to-step motion), so the resolved heading never snaps mid-move.
 */
export function resolveHeading(pose: EntityPose, autoFace: boolean): number {
	if (!autoFace || pose.manualHeading) {
		return pose.heading;
	}
	if (pose.headingMode === 'pinned' && pose.lookAt) {
		return Math.atan2(pose.lookAt.y - pose.y, pose.lookAt.x - pose.x);
	}
	if (pose.headingMode === 'fixed') {
		return pose.heading;
	}
	const t = trackLayer.tangentAt({ x: pose.x, y: pose.y });
	const tangentHeading = Math.atan2(t.y, t.x);
	if (pose.headingMode === 'relative' || pose.headingDelta !== undefined) {
		return tangentHeading + (pose.headingDelta ?? 0);
	}
	return tangentHeading;
}

/**
 * Resolves headings for a sequence of steps. Returns a new copy where each
 * pose's `heading` is the resolved facing via {@link resolveHeading}.
 *
 * Because auto facing is the track tangent (a function of position only), the
 * resolved heading is stable: it does not depend on the next step's position,
 * so it never changes "because the player moved" and never snaps at the end of
 * a transition.
 */
export function resolveHeadings(steps: EntityPose[][], autoFace: boolean): EntityPose[][] {
	return steps.map((step) =>
		step.map((pose) => ({ ...pose, heading: resolveHeading(pose, autoFace) }))
	);
}

/**
 * Computes heading from motion between consecutive captured-clip samples.
 *
 * Captured (recorded) clips have no "looking" signal — only motion — so for
 * replay the facing is derived from the sample-to-sample displacement and held
 * at rest. This is intentionally separate from {@link resolveHeading} (the
 * authored/free-board path), which uses the track tangent.
 *
 * `prev`/`cur` are planar world-metre points; `fallback` is the last known
 * heading.
 */
export function motionHeading(prev: PlanarPoint, cur: PlanarPoint, fallback: number): number {
	const dx = cur.x - prev.x;
	const dy = cur.y - prev.y;
	const distSq = dx * dx + dy * dy;

	if (distSq < REST_EPS * REST_EPS) {
		return fallback; // At rest: hold previous heading.
	}

	return Math.atan2(dy, dx);
}
