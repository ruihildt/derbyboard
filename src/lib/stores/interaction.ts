import { derived } from 'svelte/store';
import { toolMode } from './toolMode';

/**
 * Resolved canvas-interaction flags, derived from the active tool. KonvaGame
 * subscribes to this (rather than reading `toolMode` inline) so the drag/select
 * gating lives in one place shared by the subscription, `setReplayMode` and
 * `endAuthoredPlayback`.
 *
 * The two view tools are mutually exclusive and consistent across experiences:
 *  - `hand`   — dedicated panning: stage draggable, entities inert.
 *  - `select` — edit/select entities only; the canvas never pans on drag.
 *  - drawing tools — neither (their own gesture handlers run instead).
 */
export const interaction = derived(toolMode, (t) => ({
	panEnabled: t === 'hand',
	entitiesEnabled: t === 'select'
}));
