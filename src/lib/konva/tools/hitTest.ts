import type Konva from 'konva';

/**
 * Hit-test helpers: resolve the domain object under a stage event by walking
 * the Konva node hierarchy for the marker names/attrs set by the renderers
 * (`playerGroup` + `player` attr, `.annotation` + `annId`, `.lineShape` +
 * `stepId`/`pathId`).
 */

/** The entity id under the event, or null. */
export function playerIdFromEvent(e: Konva.KonvaEventObject<unknown>): string | null {
	const target = e.target as Konva.Node;
	if (target.hasName('playerGroup') || target.getParent()?.hasName('playerGroup')) {
		const player = (target.getAttr('player') ?? target.getParent()?.getAttr('player')) as
			{ id?: string } | undefined;
		return player?.id ?? null;
	}
	return null;
}

/** The annotation id under the event (set by AnnotationRenderer), or null. */
export function annotationIdFromEvent(e: Konva.KonvaEventObject<unknown>): string | null {
	const target = e.target as Konva.Node;
	const group = target.findAncestors('.annotation', true)[0];
	return group ? ((group.getAttr('annId') as string | undefined) ?? null) : null;
}

/** The (stepId, pathId) of the path line under the event, or null. */
export function pathIdFromEvent(
	e: Konva.KonvaEventObject<unknown>
): { stepId: string; pathId: string } | null {
	const target = e.target as Konva.Node;
	const line = target.findAncestors('.lineShape', true)[0];
	if (!line) return null;
	const stepId = line.getAttr('stepId') as string | undefined;
	const pathId = line.getAttr('pathId') as string | undefined;
	return stepId && pathId ? { stepId, pathId } : null;
}
