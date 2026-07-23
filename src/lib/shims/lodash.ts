/**
 * Minimal `lodash` shim for `roller-derby-track-utils`.
 *
 * The package only uses `_.cloneDeep`. `structuredClone` (available in all
 * modern browsers and Node 17+) deep-clones plain data, which is all the
 * package ever clones (skater position objects).
 *
 * Aliased to the bare specifier `lodash` in vite.config.ts.
 */
const lodash = {
	cloneDeep: <T>(value: T): T => structuredClone(value)
};

export default lodash;
