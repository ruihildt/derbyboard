import type { AspectRatio } from '$lib/utils/recording';
import type { TeamPlayerPosition, SkatingOfficialPosition } from '$lib/stores/konvaBoardState';

/** Board view (zoom + pan), stored relative to the stage center. */
export interface TimelineView {
	zoom: number;
	relativeX: number;
	relativeY: number;
}

/**
 * A single timestamped board snapshot. Player/official positions reuse the
 * existing `boardState` shape (relative, center-based coords) and include a
 * stable `id` so capture and replay can correlate the same entity over time.
 */
export interface TimelineSample {
	t: number; // ms from record start
	teamPlayers: TeamPlayerPosition[];
	skatingOfficials: SkatingOfficialPosition[];
	view: TimelineView;
}

/** A snapshot without a timestamp; the caller stamps `t` on capture. */
export type Snapshot = Omit<TimelineSample, 't'>;

export interface TimelineAudioMeta {
	file: string;
	durationMs: number;
	mimeType: string;
}

/** Region geometry as viewport-relative fractions (resolution-independent). */
export interface TimelineRegion {
	widthFrac: number; // region width / viewport width
	centerXFrac: number; // region center.x / viewport width
	centerYFrac: number; // region center.y / viewport height
}

/** Aspect-locked output frame; presence enables the composition mask overlay. */
export interface TimelineFrame {
	ratio: AspectRatio;
	region: TimelineRegion;
}

export interface TimelineProject {
	version: 1;
	createdAt: string; // ISO
	durationMs: number;
	samples: TimelineSample[];
	audio?: TimelineAudioMeta;
	frame?: TimelineFrame;
}
