import { describe, it, expect, beforeEach } from 'vitest';
import { boardDoc } from '$lib/doc/store';
import { createEmptyDoc, type Entity, type AuthoredClip } from '$lib/doc/types';
import { authoringSession } from '$lib/stores/session';
import { getExperience, getCapabilities, ALL_TOOLS } from './capabilities';

function entity(id: string, x = 0): Entity {
	return { id, kind: 'skater', team: 'A', role: 'blocker', x, y: 0.5, heading: 0 };
}

function authoredClip(id: string): AuthoredClip {
	return {
		kind: 'authored',
		id,
		steps: [{ id: 's1', entities: [{ id: 'e1', x: 0, y: 0.5, heading: 0 }] }]
	};
}

function resetBoard(entities: Entity[]): void {
	const doc = createEmptyDoc();
	doc.entities = entities;
	boardDoc.set(doc);
	boardDoc.clearHistory();
	authoringSession.set({ activeClipId: null, activeStepIndex: -1 });
}

describe('capabilities — getExperience', () => {
	beforeEach(() => resetBoard([entity('a')]));

	it('returns "free" when no clip is active', () => {
		expect(getExperience(boardDoc.current)).toBe('free');
	});

	it('returns "drill" when an authored clip is active', () => {
		boardDoc.applyEdit((d) => {
			d.clips.push(authoredClip('c1'));
		}, 'add clip');
		authoringSession.set({ activeClipId: 'c1', activeStepIndex: 0 });
		expect(getExperience(boardDoc.current)).toBe('drill');
	});

	it('returns "free" when the session references a missing clip', () => {
		authoringSession.set({ activeClipId: 'nope', activeStepIndex: 0 });
		expect(getExperience(boardDoc.current)).toBe('free');
	});
});

describe('capabilities — getCapabilities', () => {
	beforeEach(() => resetBoard([entity('a')]));

	it('free: no timeline, no tools, skater/official admitted', () => {
		const caps = getCapabilities(boardDoc.current);
		expect(caps.experience).toBe('free');
		expect(caps.label).toBe('Free Play');
		expect(caps.timeline).toBe(false);
		expect(caps.admittedTools).toEqual([]);
		expect(caps.admittedEntityKinds).toEqual(['skater', 'official']);
	});

	it('drill: timeline on, all tools admitted', () => {
		boardDoc.applyEdit((d) => {
			d.clips.push(authoredClip('c1'));
		}, 'add clip');
		authoringSession.set({ activeClipId: 'c1', activeStepIndex: 0 });
		const caps = getCapabilities(boardDoc.current);
		expect(caps.experience).toBe('drill');
		expect(caps.label).toBe('Drill');
		expect(caps.timeline).toBe(true);
		expect(caps.admittedTools).toEqual(ALL_TOOLS);
		expect(caps.admittedEntityKinds).toEqual(['skater', 'official']);
	});
});
