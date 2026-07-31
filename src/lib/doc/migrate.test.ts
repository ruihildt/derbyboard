import { describe, it, expect } from 'vitest';
import { migrateBoardState, migrateTimelineProject, migrateBoardDoc } from './migrate';
import { CURRENT_VERSION } from './types';
import type { KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TimelineProject } from '$lib/recording/timeline/types';
import { TeamPlayerRole, TeamPlayerTeam } from '$lib/konva/KonvaTeamPlayer';
import { SkatingOfficialRole } from '$lib/konva/KonvaSkatingOfficial';

describe('migrate', () => {
	describe('migrateBoardState', () => {
		it('should migrate empty boardState to empty BoardDoc', () => {
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			};

			const doc = migrateBoardState(state);

			expect(doc.version).toBe(CURRENT_VERSION);
			expect(doc.createdAt).toBe('2024-01-01T00:00:00.000Z');
			expect(doc.entities).toHaveLength(0);
			expect(doc.clips).toHaveLength(0);
			expect(doc.activeClipId).toBeNull();
		});

		it('should migrate team players to entities with track coordinates', () => {
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [
					{
						id: 'player1',
						relative: { x: 100, y: 200 },
						role: TeamPlayerRole.jammer,
						team: TeamPlayerTeam.A
					},
					{
						id: 'player2',
						relative: { x: -50, y: -100 },
						role: TeamPlayerRole.blocker,
						team: TeamPlayerTeam.B
					}
				],
				skatingOfficials: []
			};

			const doc = migrateBoardState(state);

			expect(doc.entities).toHaveLength(2);

			const entity1 = doc.entities.find((e) => e.id === 'player1');
			expect(entity1).toBeDefined();
			expect(entity1!.kind).toBe('skater');
			expect(entity1!.team).toBe('A');
			expect(entity1!.role).toBe('jammer');
			expect(entity1!.S).toBeTypeOf('number');
			expect(entity1!.u).toBeTypeOf('number');
			expect(entity1!.heading).toBe(0);

			const entity2 = doc.entities.find((e) => e.id === 'player2');
			expect(entity2).toBeDefined();
			expect(entity2!.kind).toBe('skater');
			expect(entity2!.team).toBe('B');
			expect(entity2!.role).toBe('blocker');
		});

		it('should migrate skating officials to entities with track coordinates', () => {
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: [
					{
						id: 'ref1',
						relative: { x: 0, y: 0 },
						role: SkatingOfficialRole.jamRefA
					}
				]
			};

			const doc = migrateBoardState(state);

			expect(doc.entities).toHaveLength(1);

			const entity = doc.entities.find((e) => e.id === 'ref1');
			expect(entity).toBeDefined();
			expect(entity!.kind).toBe('official');
			expect(entity!.role).toBe('jamRefA');
			expect(entity!.S).toBeTypeOf('number');
			expect(entity!.u).toBeTypeOf('number');
			expect(entity!.heading).toBe(0);
		});

		it('should generate IDs for entities without IDs', () => {
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [
					{
						relative: { x: 100, y: 200 },
						role: TeamPlayerRole.jammer,
						team: TeamPlayerTeam.A
					}
				],
				skatingOfficials: []
			};

			const doc = migrateBoardState(state);

			expect(doc.entities).toHaveLength(1);
			expect(doc.entities[0].id).toBeDefined();
			expect(doc.entities[0].id).toMatch(/^[0-9a-f-]+$/i);
		});

		it('should preserve metadata from boardState', () => {
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			};

			const doc = migrateBoardState(state);

			expect(doc.createdAt).toBe('2024-01-01T00:00:00.000Z');
		});

		it('should convert pixel coordinates to track coordinates correctly', () => {
			// Test with a known position
			const state: KonvaBoardState = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [
					{
						id: 'player1',
						relative: { x: 0, y: 0 }, // Center of track
						role: TeamPlayerRole.jammer,
						team: TeamPlayerTeam.A
					}
				],
				skatingOfficials: []
			};

			const doc = migrateBoardState(state);
			const entity = doc.entities[0];

			// The track center is deep infield (u is unclamped, so this is
			// legitimately negative — well inside the inner boundary at u=0).
			expect(entity.S).toBeGreaterThanOrEqual(0);
			expect(entity.S).toBeLessThan(100); // Should be within one lap
			expect(entity.u).toBeLessThan(0);
		});

		// Regression: a previously-corrupted save (NaN persisted as null by
		// JSON.stringify) must migrate to finite coordinates rather than
		// propagating null/NaN into the document.
		it('coerces null relative coordinates to finite values', () => {
			const state = {
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [
					{
						id: 'p1',
						// Simulate `null` from a NaN that round-tripped through
						// JSON: JSON.stringify(NaN) === 'null'.
						relative: { x: null as unknown as number, y: null as unknown as number },
						role: TeamPlayerRole.blocker,
						team: TeamPlayerTeam.A
					}
				],
				skatingOfficials: [
					{
						id: 'o1',
						relative: { x: NaN, y: undefined as unknown as number },
						role: SkatingOfficialRole.jamRefA
					}
				]
			} as KonvaBoardState;

			const doc = migrateBoardState(state);

			for (const e of doc.entities) {
				expect(Number.isFinite(e.S)).toBe(true);
				expect(Number.isFinite(e.u)).toBe(true);
			}
		});
	});

	describe('migrateTimelineProject', () => {
		it('should migrate TimelineProject to CapturedClip', () => {
			const project: TimelineProject = {
				version: 1,
				createdAt: '2024-01-01T00:00:00.000Z',
				durationMs: 5000,
				samples: [
					{
						t: 0,
						teamPlayers: [],
						skatingOfficials: [],
						view: { zoom: 1, relativeX: 0, relativeY: 0 }
					}
				],
				source: { w: 800, h: 600 }
			};

			const clip = migrateTimelineProject(project);

			expect(clip.kind).toBe('captured');
			expect(clip.id).toMatch(/^[0-9a-f-]+$/i);
			expect(clip.createdAt).toBe('2024-01-01T00:00:00.000Z');
			expect(clip.durationMs).toBe(5000);
			expect(clip.samples).toHaveLength(1);
			expect(clip.audio).toBeUndefined();
		});

		it('should preserve all samples from TimelineProject', () => {
			const project: TimelineProject = {
				version: 1,
				createdAt: '2024-01-01T00:00:00.000Z',
				durationMs: 3000,
				samples: [
					{
						t: 0,
						teamPlayers: [
							{
								id: 'p1',
								relative: { x: 100, y: 200 },
								role: TeamPlayerRole.jammer,
								team: TeamPlayerTeam.A
							}
						],
						skatingOfficials: [],
						view: { zoom: 1, relativeX: 0, relativeY: 0 }
					},
					{
						t: 1000,
						teamPlayers: [
							{
								id: 'p1',
								relative: { x: 150, y: 250 },
								role: TeamPlayerRole.jammer,
								team: TeamPlayerTeam.A
							}
						],
						skatingOfficials: [],
						view: { zoom: 1, relativeX: 0, relativeY: 0 }
					}
				],
				source: { w: 800, h: 600 }
			};

			const clip = migrateTimelineProject(project);

			expect(clip.samples).toHaveLength(2);
			expect(clip.samples[0].t).toBe(0);
			expect(clip.samples[1].t).toBe(1000);
			expect(clip.samples[0].teamPlayers[0].relative.x).toBe(100);
			expect(clip.samples[1].teamPlayers[0].relative.x).toBe(150);
		});

		it('should handle TimelineProject with audio', () => {
			const project: TimelineProject = {
				version: 1,
				createdAt: '2024-01-01T00:00:00.000Z',
				durationMs: 5000,
				samples: [],
				source: { w: 800, h: 600 },
				audio: {
					file: 'audio.webm',
					durationMs: 5000,
					mimeType: 'audio/webm'
				}
			};

			const clip = migrateTimelineProject(project);

			expect(clip.audio).toBeDefined();
			expect(clip.audio!.mimeType).toBe('audio/webm');
		});
	});

	describe('migrateBoardDoc', () => {
		it('bumps a v1 document to the current version', () => {
			const v1 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v1.version = 1; // pretend it was persisted before v2
			const migrated = migrateBoardDoc(v1);
			expect(migrated.version).toBe(CURRENT_VERSION);
		});

		it('is idempotent on an already-current document', () => {
			const v1 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			const once = migrateBoardDoc(v1);
			const twice = migrateBoardDoc(once);
			expect(twice).toEqual(once);
		});

		it('preserves authored clips and steps across the v1→v2 bump', () => {
			const v1 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v1.version = 1;
			v1.clips = [
				{
					kind: 'authored',
					id: 'c1',
					title: 'Drill',
					steps: [{ id: 's1', entities: [{ id: 'e1', S: 1, u: 0.5, heading: 0 }] }]
				}
			];
			const migrated = migrateBoardDoc(v1);
			const clip = migrated.clips[0];
			expect(clip).toBeDefined();
			expect(clip.kind).toBe('authored');
			if (clip.kind !== 'authored') return;
			// showPackZone stays undefined (= ON) for pre-v2 steps.
			expect(clip.steps[0].showPackZone).toBeUndefined();
			expect(clip.steps[0].entities[0].S).toBe(1);
		});

		it('bumps a v2 document to v3, adding manualHeading field', () => {
			const v2 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v2.version = 2;
			const migrated = migrateBoardDoc(v2);
			expect(migrated.version).toBe(CURRENT_VERSION);
			// manualHeading should be undefined (auto) by default
			for (const entity of migrated.entities) {
				expect(entity.manualHeading).toBeUndefined();
			}
		});

		it('is idempotent on a v3 document', () => {
			const v2 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v2.version = 2;
			const once = migrateBoardDoc(v2);
			const twice = migrateBoardDoc(once);
			expect(twice).toEqual(once);
		});

		it('preserves manualHeading across v3→v3 migration', () => {
			const v2 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v2.version = 2;
			if (v2.entities.length === 0) {
				v2.entities.push({
					id: 'test-entity',
					kind: 'skater',
					team: 'A',
					role: 'jammer',
					S: 0,
					u: 0.5,
					heading: 0
				});
			}
			v2.entities[0].manualHeading = true;
			const once = migrateBoardDoc(v2);
			expect(once.entities[0].manualHeading).toBe(true);
			const twice = migrateBoardDoc(once);
			expect(twice.entities[0].manualHeading).toBe(true);
		});

		it('preserves manualHeading in step entities across v2→v3 migration', () => {
			const v2 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v2.version = 2;
			if (v2.entities.length === 0) {
				v2.entities.push({
					id: 'test-entity',
					kind: 'skater',
					team: 'A',
					role: 'jammer',
					S: 0,
					u: 0.5,
					heading: 0
				});
			}
			v2.clips = [
				{
					kind: 'authored',
					id: 'c1',
					steps: [
						{
							id: 's1',
							entities: [{ id: v2.entities[0].id, S: 1, u: 0.5, heading: 0, manualHeading: true }]
						}
					]
				}
			];
			const migrated = migrateBoardDoc(v2);
			const clip = migrated.clips[0];
			if (clip.kind !== 'authored') return;
			expect(clip.steps[0].entities[0].manualHeading).toBe(true);
		});

		it('bumps a v5 document to v6, adding annotations and paths fields', () => {
			const v5 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v5.version = 5;
			const migrated = migrateBoardDoc(v5);
			expect(migrated.version).toBe(6);
			const clip = migrated.clips[0];
			if (!clip || clip.kind !== 'authored') return;
			// annotations and paths should be undefined (absent = none)
			expect(clip.steps[0].annotations).toBeUndefined();
			expect(clip.steps[0].paths).toBeUndefined();
		});

		it('is idempotent on a v6 document', () => {
			const v5 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v5.version = 5;
			const once = migrateBoardDoc(v5);
			const twice = migrateBoardDoc(once);
			expect(twice.version).toBe(6);
			expect(twice).toEqual(once);
		});
	});
});
