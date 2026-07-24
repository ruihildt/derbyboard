import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

import pkg from './package.json';

// `roller-derby-track-utils` lists `three` and `lodash` as peer dependencies,
// but only uses a tiny slice of each (Vector2; cloneDeep). We alias both bare
// specifiers to local shims (absolute paths) so the full packages never enter
// the bundle and Vite does not duplicate the aliased modules.
const shim = (name: string) =>
	fileURLToPath(new URL(`./src/lib/shims/${name}.ts`, import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), basicSsl(), sveltekit()],
	resolve: {
		alias: {
			three: shim('three'),
			lodash: shim('lodash')
		}
	},
	server: {
		host: true
	},
	define: {
		'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
		'import.meta.env.BUILD_DATE': JSON.stringify(new Date().toISOString())
	}
});
