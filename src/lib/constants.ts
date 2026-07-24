import {
	C1,
	C2,
	C1_OUTER,
	RADIUS_INNER,
	F_OUTER_TOP,
	ENGAGEMENT_ZONE_DISTANCE_TO_PACK
} from 'roller-derby-track-utils';

// Base scaling
export const TRACK_SCALE = 35;
export const LINE_WIDTH = TRACK_SCALE / 10;
export const TEN_FEET_LINE_WIDTH = TRACK_SCALE / 20;
export const PLAYER_RADIUS = TRACK_SCALE / 2.4;
export const PLAYER_STROKE_WIDTH = TRACK_SCALE / 13;

// Track dimensions sourced from roller-derby-track-utils (metres) so the package
// is the single source of truth for the track geometry. All values are
// metres * TRACK_SCALE (rendered pixels). The package's exact values (e.g. the
// 0.305 m outer offset, 8.385/7.775 m slanted-outer ends) align the drawn track
// with the package-derived engagement-zone overlay.
export const CENTER_POINT_OFFSET = C1.x * TRACK_SCALE; // turn-centre x (5.33 m)
export const VERTICAL_OFFSET_1 = RADIUS_INNER * TRACK_SCALE; // inner radius (3.81 m)
export const VERTICAL_OFFSET_2 = Math.abs(C1_OUTER.y) * TRACK_SCALE; // outer turn-centre offset (0.305 m)
export const OUTER_VERTICAL_OFFSET_1 = Math.abs(F_OUTER_TOP(C1.x)) * TRACK_SCALE; // wide outer end (8.385 m)
export const OUTER_VERTICAL_OFFSET_2 = Math.abs(F_OUTER_TOP(C2.x)) * TRACK_SCALE; // narrow outer end (7.775 m)

// Common distances to draw track and do pack calculations
export const TENFEET = 3.05 * TRACK_SCALE;
export const TWENTYFEET = ENGAGEMENT_ZONE_DISTANCE_TO_PACK * TRACK_SCALE; // engagement-zone distance (6.1 m)
export const THIRTYFEET = 9.15 * TRACK_SCALE;
export const TENFEETLINE = 0.8 * TRACK_SCALE;
export const TURNSEGMENT = 2.15 * TRACK_SCALE;

// Arc constants
export const HALF_PI = Math.PI / 2;
export const CLOCKWISE = true;
export const COUNTER_CLOCKWISE = false;

export interface Colors {
	playerDefault: string;
	teamAPrimary: string;
	teamASecondary: string;
	teamBPrimary: string;
	teamBSecondary: string;
	officialPrimary: string;
	officialSecondary: string;
	outOfBounds: string;
	inBounds: string;
	inPack: string;
	inEngagementZone: string;
	engagementZone: string;
	canvasBackground: string;
	trackSurface: string;
	trackBoundaries: string;
	officialLane: string;
	tenFeetLines: string;
}
export const colors: Colors = {
	playerDefault: 'black',
	teamAPrimary: 'yellow',
	teamASecondary: 'black',
	teamBPrimary: 'deepskyblue',
	teamBSecondary: 'rebeccapurple',
	officialPrimary: 'white',
	officialSecondary: 'black',
	outOfBounds: 'red',
	inBounds: 'black',
	inEngagementZone: '#FFA500',
	inPack: 'green',
	engagementZone: '#b8deb8',
	canvasBackground: '#f0f0f0',
	trackSurface: '#D3D3D3',
	trackBoundaries: 'blue',
	officialLane: 'black',
	tenFeetLines: 'black'
};

// Zoom levels
export const BASE_ZOOM = 1; // 100% zoom
export const MIN_ZOOM = 0.1; // 10% minimum zoom (matches the ZoomControl threshold)
export const ZOOM_INCREMENT = 0.1;
export const MAX_ZOOM = 4; // 500% maximum zoom
