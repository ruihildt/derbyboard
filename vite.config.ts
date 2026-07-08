import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

import pkg from './package.json';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
		'import.meta.env.BUILD_DATE': JSON.stringify(new Date().toISOString())
	}
});
