import type { Entity, SkatingOfficialRole, TeamPlayerRole, TeamPlayerTeam } from '$lib/doc/types';
import { fromTrack, LAP_LENGTH } from '$lib/track/trackFrame';

/**
 * Lineup presets, authored in track space `(S, u)` and converted to planar
 * world metres `(x, y)` at build time — the canonical stored coordinate frame.
 * Coaches nudge from here via duplicate-and-nudge, so preset precision is
 * secondary to coverage of the common starting contexts.
 *
 * `S` is arc length along the measurement line (0 ≈ top of the right turn);
 * `u` is the normalised lane (0 = inner, 1 = outer). Officials sit just inside
 * the inner boundary (u < 0) as they do in real lineups.
 */

type SkaterSpec = {
	team: TeamPlayerTeam;
	role: TeamPlayerRole;
	S: number;
	u: number;
};
type OfficialSpec = { role: SkatingOfficialRole; S: number; u: number };

export interface Preset {
	id: string;
	name: string;
	skaters: SkaterSpec[];
	officials: OfficialSpec[];
}

function wrap(s: number): number {
	return ((s % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
}

/** Track-space `(S, u)` → planar metres `(x, y)`. */
function planar(S: number, u: number): { x: number; y: number } {
	return fromTrack(wrap(S), u);
}

/**
 * Builds the preset's entity roster with deterministic ids so loading the same
 * preset twice reconciles nodes in place (no orphaned duplicates), mirroring
 * the default-lineup id-stability pattern.
 */
export function presetEntities(preset: Preset): Entity[] {
	const entities: Entity[] = [];
	preset.skaters.forEach((s, i) => {
		const p = planar(s.S, s.u);
		entities.push({
			id: `preset-${preset.id}-skater-${s.team}-${s.role}-${i}`,
			kind: 'skater',
			team: s.team,
			role: s.role,
			x: p.x,
			y: p.y,
			heading: 0
		});
	});
	preset.officials.forEach((o, i) => {
		const p = planar(o.S, o.u);
		entities.push({
			id: `preset-${preset.id}-official-${o.role}-${i}`,
			kind: 'official',
			role: o.role,
			x: p.x,
			y: p.y,
			heading: 0
		});
	});
	return entities;
}

// Standard 4-blocker + pivot wall for one team, spread `gap` metres apart,
// centred on `centerS` at lane `u`.
function wall(team: TeamPlayerTeam, centerS: number, u: number, gap = 1.5): SkaterSpec[] {
	const pivot: SkaterSpec = { team, role: 'pivot', S: centerS - 1.5 * gap, u };
	return [
		{ team, role: 'blocker', S: centerS + 1.5 * gap, u },
		{ team, role: 'blocker', S: centerS + 0.5 * gap, u },
		{ team, role: 'blocker', S: centerS - 0.5 * gap, u },
		pivot
	];
}

// Officials: jam refs near the jammer line, pack refs inside the pack, outside
// refs at the apex of each turn (just inside the inner line, u < 0).
const STANDARD_OFFICIALS: OfficialSpec[] = [
	{ role: 'jamRefA', S: 21, u: -0.05 },
	{ role: 'jamRefB', S: 21, u: -0.18 },
	{ role: 'frontPackRef', S: 19, u: -0.12 },
	{ role: 'backPackRef', S: 22, u: -0.12 },
	{ role: 'outsidePackRef', S: 8, u: -0.12 },
	{ role: 'outsidePackRef', S: 36, u: -0.12 },
	{ role: 'outsidePackRef', S: 47, u: -0.12 }
];

export const PRESETS: Preset[] = [
	{
		id: 'start-flat',
		name: 'Start flat (jammer line)',
		skaters: [
			...wall('A', 19.5, 0.25),
			...wall('B', 19.5, 0.4),
			{ team: 'A', role: 'jammer', S: 17, u: 0.3 },
			{ team: 'B', role: 'jammer', S: 17, u: 0.35 }
		],
		officials: STANDARD_OFFICIALS
	},
	{
		id: 'pack-in-turn',
		name: 'Pack in the turn',
		skaters: [
			...wall('A', 8, 0.4),
			...wall('B', 8, 0.55),
			{ team: 'A', role: 'jammer', S: 5, u: 0.45 },
			{ team: 'B', role: 'jammer', S: 5, u: 0.5 }
		],
		officials: STANDARD_OFFICIALS
	},
	{
		id: 'three-wall',
		name: '3-wall on the straight',
		skaters: [
			{ team: 'A', role: 'blocker', S: 20, u: 0.3 },
			{ team: 'A', role: 'blocker', S: 21.5, u: 0.3 },
			{ team: 'A', role: 'pivot', S: 23, u: 0.3 },
			{ team: 'B', role: 'blocker', S: 20, u: 0.45 },
			{ team: 'B', role: 'blocker', S: 21.5, u: 0.45 },
			{ team: 'B', role: 'pivot', S: 23, u: 0.45 }
		],
		officials: STANDARD_OFFICIALS
	},
	{
		id: 'single-file',
		name: 'Single file',
		skaters: [
			{ team: 'A', role: 'pivot', S: 18, u: 0.35 },
			{ team: 'A', role: 'blocker', S: 20, u: 0.35 },
			{ team: 'A', role: 'blocker', S: 22, u: 0.35 },
			{ team: 'A', role: 'blocker', S: 24, u: 0.35 },
			{ team: 'B', role: 'pivot', S: 18, u: 0.5 },
			{ team: 'B', role: 'blocker', S: 20, u: 0.5 },
			{ team: 'B', role: 'blocker', S: 22, u: 0.5 },
			{ team: 'B', role: 'blocker', S: 24, u: 0.5 },
			{ team: 'A', role: 'jammer', S: 15, u: 0.4 },
			{ team: 'B', role: 'jammer', S: 15, u: 0.45 }
		],
		officials: STANDARD_OFFICIALS
	},
	{
		id: 'pre-jam',
		name: 'Pre-jam formation',
		skaters: [
			...wall('A', 21, 0.25),
			...wall('B', 21, 0.4),
			{ team: 'A', role: 'jammer', S: 21.5, u: 0.6 },
			{ team: 'B', role: 'jammer', S: 21.5, u: 0.65 }
		],
		officials: STANDARD_OFFICIALS
	}
];
