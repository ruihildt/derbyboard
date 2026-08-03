import { boardDoc } from '$lib/doc/store';
import { colors } from '$lib/constants';

/**
 * Team colour for an entity: team A/B primary colours for skaters, the
 * official secondary colour for officials and unknown ids. Used by trails,
 * onion-skin ghosts and path previews so all of them agree on colouring.
 */
export function entityColorFor(id: string): string {
	const entity = boardDoc.current.entities.find((e) => e.id === id);
	if (entity?.team === 'A') return colors.teamAPrimary;
	if (entity?.team === 'B') return colors.teamBPrimary;
	return colors.officialSecondary;
}
