// Base scaling
export const TRACK_SCALE = 35;
export const LINE_WIDTH = TRACK_SCALE / 10;
export const TEN_FEET_LINE_WIDTH = TRACK_SCALE / 20;
export const PLAYER_RADIUS = TRACK_SCALE / 2.4;
export const PLAYER_STROKE_WIDTH = TRACK_SCALE / 13;

// Primitive track points
export const CENTER_POINT_OFFSET = 5.33 * TRACK_SCALE; // Distance from center in meters
export const VERTICAL_OFFSET_1 = 3.81 * TRACK_SCALE; // First vertical offset in meters
export const VERTICAL_OFFSET_2 = 0.3 * TRACK_SCALE; // Second vertical offset in meters
export const OUTER_VERTICAL_OFFSET_1 = 8.38 * TRACK_SCALE; // First outer vertical offset in meters
export const OUTER_VERTICAL_OFFSET_2 = 7.78 * TRACK_SCALE; // Second outer vertical offset in meters

// Common distances to draw track and do pack calculations
export const TENFEET = 3.05 * TRACK_SCALE;
export const TWENTYFEET = 6.1 * TRACK_SCALE;
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
