import { describe, it, expect } from 'vitest';
import { migrateBoardState, migrateTimelineProject, migrateBoardDoc } from './migrate';
import { CURRENT_VERSION } from './types';
import type { BoardDoc } from './types';
import type { KonvaBoardState } from '$lib/stores/konvaBoardState';
import type { TimelineProject } from '$lib/recording/timeline/types';
import { TeamPlayerRole, TeamPlayerTeam } from '$lib/konva/KonvaTeamPlayer';
import { SkatingOfficialRole } from '$lib/konva/KonvaSkatingOfficial';
import { fromTrack, LAP_LENGTH } from '$lib/track/trackFrame';
import { TRACK_SCALE } from '$lib/constants';

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
			expect(entity1!.x).toBeTypeOf('number');
			expect(entity1!.y).toBeTypeOf('number');
			expect(entity1!.x).toBeCloseTo(100 / TRACK_SCALE, 6);
			expect(entity1!.y).toBeCloseTo(200 / TRACK_SCALE, 6);
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
			expect(entity!.x).toBeTypeOf('number');
			expect(entity!.y).toBeTypeOf('number');
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

		it('should convert pixel coordinates to planar metres correctly', () => {
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

			// Center maps to the planar origin (0, 0) metres.
			expect(entity.x).toBeCloseTo(0, 6);
			expect(entity.y).toBeCloseTo(0, 6);
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
				expect(Number.isFinite(e.x)).toBe(true);
				expect(Number.isFinite(e.y)).toBe(true);
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
			] as unknown as BoardDoc['clips'];
			const migrated = migrateBoardDoc(v1);
			const clip = migrated.clips[0];
			expect(clip).toBeDefined();
			expect(clip.kind).toBe('authored');
			if (clip.kind !== 'authored') return;
			// showPackZone stays undefined (= ON) for pre-v2 steps.
			expect(clip.steps[0].showPackZone).toBeUndefined();
			// The track-space entity (S=1, u=0.5) is converted to planar metres.
			expect(clip.steps[0].entities[0].id).toBe('e1');
			expect(Number.isFinite(clip.steps[0].entities[0].x)).toBe(true);
			expect(Number.isFinite(clip.steps[0].entities[0].y)).toBe(true);
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
				} as unknown as (typeof v2.entities)[number]);
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
				} as unknown as (typeof v2.entities)[number]);
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
			] as unknown as BoardDoc['clips'];
			const migrated = migrateBoardDoc(v2);
			const clip = migrated.clips[0];
			if (clip.kind !== 'authored') return;
			expect(clip.steps[0].entities[0].manualHeading).toBe(true);
		});

		it('bumps a v5 document to v6 (annotations/paths absent)', () => {
			const v5 = migrateBoardState({
				version: 3,
				createdAt: '2024-01-01T00:00:00.000Z',
				teamPlayers: [],
				skatingOfficials: []
			});
			v5.version = 5;
			const migrated = migrateBoardDoc(v5);
			expect(migrated.version).toBe(CURRENT_VERSION);
			// No annotations on an empty board; steps carry no paths (absent = none).
			expect(migrated.annotations).toBeUndefined();
			const clip = migrated.clips[0];
			if (!clip || clip.kind !== 'authored') return;
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
			expect(twice.version).toBe(CURRENT_VERSION);
			expect(twice).toEqual(once);
		});
	});

	describe('migrateBoardDoc — v6 → v7 (track space → planar)', () => {
		/** Builds a v6 doc (track-space S/u) with realistic in-bounds poses. */
		function v6Doc(): BoardDoc {
			const inBoundsSamples: Array<{ id: string; S: number; u: number }> = [
				{ id: 'e1', S: 0, u: 0.5 },
				{ id: 'e2', S: 5, u: 0.3 },
				{ id: 'e3', S: LAP_LENGTH - 5, u: 0.7 },
				{ id: 'e4', S: 25, u: 0.4 }
			];
			const entities = inBoundsSamples.map((s) => ({
				id: s.id,
				kind: 'skater' as const,
				team: 'A' as const,
				role: 'blocker' as const,
				S: s.S,
				u: s.u,
				heading: 0
			}));
			return {
				version: 6,
				createdAt: '2024-01-01T00:00:00.000Z',
				meta: {},
				entities,
				clips: [
					{
						kind: 'authored',
						id: 'c1',
						steps: [
							{
								id: 's0',
								entities: entities.map((e) => ({
									id: e.id,
									S: e.S,
									u: e.u,
									heading: e.heading
								})),
								paths: [
									{
										id: 'p1',
										entityId: 'e1',
										points: [
											{ S: 0, u: 0.5 },
											{ S: 2, u: 0.5 },
											{ S: 4, u: 0.5 }
										]
									}
								],
								annotations: [
									{
										id: 'a1',
										kind: 'pen',
										points: [
											{ S: 1, u: 0.5 },
											{ S: 3, u: 0.5 }
										],
										style: { color: '#ff0000' }
									},
									{
										id: 'a2',
										kind: 'arrow',
										from: { S: 1, u: 0.3 },
										to: { S: 3, u: 0.7 },
										style: { color: '#00ff00' }
									},
									{
										id: 'a3',
										kind: 'label',
										at: { S: 6, u: 0.5 },
										text: 'hi',
										style: { color: '#0000ff' }
									}
								]
							}
						]
					}
				],
				activeClipId: 'c1'
			} as unknown as BoardDoc;
		}

		it('converts board-entity poses to planar metres via fromTrack', () => {
			const migrated = migrateBoardDoc(v6Doc());
			expect(migrated.version).toBe(CURRENT_VERSION);
			for (const e of migrated.entities) {
				expect((e as { S?: number }).S).toBeUndefined();
				expect((e as { u?: number }).u).toBeUndefined();
				expect(Number.isFinite(e.x)).toBe(true);
				expect(Number.isFinite(e.y)).toBe(true);
			}
		});

		it('maps in-bounds poses to fromTrack(S,u) within tolerance', () => {
			const v6 = v6Doc();
			const migrated = migrateBoardDoc(v6);
			const raw = v6.entities as unknown as Array<{ id: string; S: number; u: number }>;
			const byId = new Map(raw.map((e) => [e.id, e] as const));
			for (const e of migrated.entities) {
				const orig = byId.get(e.id)!;
				const expected = fromTrack(orig.S, orig.u);
				expect(e.x).toBeCloseTo(expected.x, 5);
				expect(e.y).toBeCloseTo(expected.y, 5);
			}
		});

		it('converts authored step poses to planar metres', () => {
			const v6 = v6Doc();
			const migrated = migrateBoardDoc(v6);
			const clip = migrated.clips[0];
			if (clip.kind !== 'authored') throw new Error('expected authored clip');
			const step = clip.steps[0];
			const origStep = (
				v6.clips[0] as unknown as {
					steps: { entities: Array<{ id: string; S: number; u: number }> }[];
				}
			).steps[0];
			const byId = new Map(origStep.entities.map((e) => [e.id, e] as const));
			for (const pose of step.entities) {
				const orig = byId.get(pose.id)!;
				const expected = fromTrack(orig.S, orig.u);
				expect(pose.x).toBeCloseTo(expected.x, 5);
				expect(pose.y).toBeCloseTo(expected.y, 5);
			}
		});

		it('converts path points and annotation geometry to planar metres', () => {
			const v6 = v6Doc();
			const migrated = migrateBoardDoc(v6);
			const clip = migrated.clips[0];
			if (clip.kind !== 'authored') throw new Error('expected authored clip');
			const step = clip.steps[0];

			// Path points
			expect(step.paths).toBeDefined();
			for (const pt of step.paths![0].points) {
				expect(Number.isFinite(pt.x)).toBe(true);
				expect(Number.isFinite(pt.y)).toBe(true);
			}
			const expectedPath = fromTrack(2, 0.5);
			expect(step.paths![0].points[1].x).toBeCloseTo(expectedPath.x, 5);

			// Step annotations were flattened onto the board array (v7→v8), each
			// tagged scope.stepId === 's0', with planar geometry. The step itself
			// carries no annotations field any more.
			expect((step as unknown as { annotations?: unknown }).annotations).toBeUndefined();
			expect(migrated.annotations).toHaveLength(3);
			const anns = migrated.annotations!;
			for (const a of anns) expect(a.scope).toEqual({ stepId: 's0' });

			// Pen points
			const pen = anns[0];
			if (pen.kind !== 'pen') throw new Error('expected pen');
			for (const pt of pen.points) {
				expect(Number.isFinite(pt.x)).toBe(true);
				expect(Number.isFinite(pt.y)).toBe(true);
			}

			// Arrow points (migrated from from/to)
			const arrow = anns[1];
			if (arrow.kind !== 'arrow') throw new Error('expected arrow');
			const expectedFrom = fromTrack(1, 0.3);
			expect(arrow.points[0].x).toBeCloseTo(expectedFrom.x, 5);
			const expectedTo = fromTrack(3, 0.7);
			expect(arrow.points[1].x).toBeCloseTo(expectedTo.x, 5);

			// Label at
			const label = anns[2];
			if (label.kind !== 'label') throw new Error('expected label');
			const expectedAt = fromTrack(6, 0.5);
			expect(label.at.x).toBeCloseTo(expectedAt.x, 5);
		});

		it('is idempotent on an already-v7 document', () => {
			const once = migrateBoardDoc(v6Doc());
			const twice = migrateBoardDoc(once);
			expect(twice).toEqual(once);
		});

		it('re-migrating a converted-then-downgraded doc leaves planar poses intact', () => {
			// Convert, then pretend it's still v6: the planar poses (no S/u)
			// must survive untouched (idempotent conversion).
			const once = migrateBoardDoc(v6Doc());
			const downgraded = { ...once, version: 6 } as BoardDoc;
			const twice = migrateBoardDoc(downgraded);
			expect(twice).toEqual(once);
		});

		it('coerces a non-finite stored S/u to a finite planar pose', () => {
			const v6 = v6Doc();
			// Corrupt one entity with NaN coordinates (as a bad save might).
			v6.entities[0] = {
				...v6.entities[0],
				S: NaN,
				u: NaN
			} as unknown as (typeof v6.entities)[number];
			const migrated = migrateBoardDoc(v6);
			expect(Number.isFinite(migrated.entities[0].x)).toBe(true);
			expect(Number.isFinite(migrated.entities[0].y)).toBe(true);
		});
	});

	describe('migrateBoardDoc — v7 → v8 (flatten step annotations)', () => {
		/** A v7 doc: planar geometry, a step still carrying legacy annotations. */
		function v7Doc(): BoardDoc {
			return {
				version: 7,
				createdAt: '2024-01-01T00:00:00.000Z',
				meta: {},
				entities: [],
				clips: [
					{
						kind: 'authored',
						id: 'c1',
						steps: [
							{
								id: 's0',
								entities: [],
								annotations: [
									{
										id: 'a1',
										kind: 'pen',
										points: [
											{ x: 1, y: 2 },
											{ x: 3, y: 4 }
										],
										style: { color: '#ff0000' }
									},
									{
										id: 'a2',
										kind: 'label',
										at: { x: 5, y: 6 },
										text: 'hi',
										style: { color: '#0000ff' }
									}
								]
							}
						]
					}
				],
				activeClipId: 'c1'
			} as unknown as BoardDoc;
		}

		it('flattens step annotations onto the board array with scope.stepId', () => {
			const migrated = migrateBoardDoc(v7Doc());
			expect(migrated.version).toBe(CURRENT_VERSION);
			expect(migrated.annotations).toHaveLength(2);
			for (const a of migrated.annotations!) {
				expect(a.scope).toEqual({ stepId: 's0' });
			}
			const clip = migrated.clips[0];
			if (clip.kind !== 'authored') throw new Error('expected authored clip');
			// The step no longer carries an annotations field.
			expect((clip.steps[0] as unknown as { annotations?: unknown }).annotations).toBeUndefined();
		});

		it('keeps existing board annotations board-wide and dedups by id', () => {
			const v7 = v7Doc();
			// A board-wide annotation + one sharing an id with a step annotation.
			v7.annotations = [
				{
					id: 'b1',
					kind: 'label',
					at: { x: 0, y: 0 },
					text: 'board',
					style: { color: '#000' }
				},
				{
					id: 'a1',
					kind: 'label',
					at: { x: 9, y: 9 },
					text: 'dup',
					style: { color: '#000' }
				}
			];
			const migrated = migrateBoardDoc(v7);
			// b1 + step a1 + step a2; the step's a1 (dup of the board one) is skipped.
			expect(migrated.annotations).toHaveLength(3);
			expect(migrated.annotations!.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'b1']);
			// The board-wide b1 keeps no scope; flattened marks are scoped to s0.
			const b1 = migrated.annotations!.find((a) => a.id === 'b1')!;
			expect(b1.scope).toBeUndefined();
			const a2 = migrated.annotations!.find((a) => a.id === 'a2')!;
			expect(a2.scope).toEqual({ stepId: 's0' });
		});

		it('is idempotent', () => {
			const once = migrateBoardDoc(v7Doc());
			const twice = migrateBoardDoc(once);
			expect(twice).toEqual(once);
		});

		it('leaves an empty board with no annotations array', () => {
			const v7 = v7Doc();
			// Strip the step annotations: nothing to flatten.
			(v7.clips[0] as unknown as { steps: { annotations?: unknown }[] }).steps[0].annotations =
				undefined;
			const migrated = migrateBoardDoc(v7);
			expect(migrated.annotations).toBeUndefined();
		});
	});
});
