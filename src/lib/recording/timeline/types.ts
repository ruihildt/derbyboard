import type { CaptureZone } from '$lib/utils/capture';
import type { TeamPlayerPosition, SkatingOfficialPosition } from '$lib/stores/konvaBoardState';
import type { PlanarPoint } from '$lib/doc/types';

/** Board view (zoom + pan), stored relative to the stage center. */
export interface TimelineView {
	zoom: number;
	relativeX: number;
	relativeY: number;
}

/** A compact path definition stored in a PathFrame. */
export interface PathEntry {
	id: string;
	entityId: string;
	points: PlanarPoint[];
}

/**
 * Path overlay state captured per frame. Optional — absent means no path
 * overlay (e.g. not in authoring mode, or paths hidden).
 */
export interface PathFrame {
	/** Movement paths for the active step. */
	paths: PathEntry[];
	/** Entity ID of the selected skater (controls which paths are visible). */
	selectedEntityId: string | null;
	/** Ghost paths from the previous step (light-grey context lines). */
	prevPaths?: PathEntry[];
	/** Ghost paths from the next step (light-grey context lines). */
	nextPaths?: PathEntry[];
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
	/** Path overlay state; present only when recording during authoring with visible paths. */
	pathFrame?: PathFrame;
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
	/** Capture-time viewport size in CSS px (canonical for replay + export). */
	source: { w: number; h: number };
}
