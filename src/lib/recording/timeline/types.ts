import type { CaptureZone } from '$lib/utils/capture';
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

/** Selection rect as viewport-relative fractions (resolution-independent). */
export type TimelineRegion = CaptureZone;

/** Output frame; presence enables the composition mask overlay / crop. */
export interface TimelineFrame {
	region: CaptureZone;
}

export interface TimelineProject {
	version: 1;
	createdAt: string; // ISO
	durationMs: number;
	samples: TimelineSample[];
	audio?: TimelineAudioMeta;
	frame?: TimelineFrame;
}
