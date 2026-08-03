import type { Entity } from '$lib/doc/types';

const ROLE_LABELS: Record<string, string> = {
	jammer: 'Jammer',
	blocker: 'Blocker',
	pivot: 'Pivot',
	jamRefA: 'Jam Ref A',
	jamRefB: 'Jam Ref B',
	backPackRef: 'Back Pack Ref',
	frontPackRef: 'Front Pack Ref',
	outsidePackRef: 'Outside Pack Ref',
	alternate: 'Alternate'
};

export function hudLabel(entity: Entity): string {
	if (entity.kind === 'skater' && entity.team) {
		return `${entity.team} ${ROLE_LABELS[entity.role] ?? entity.role}`;
	}
	return ROLE_LABELS[entity.role] ?? entity.role;
}
