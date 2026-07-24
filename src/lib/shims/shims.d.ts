// Type-only shims for vite.config.ts so it can build an ABSOLUTE alias path
// without pulling in @types/node. vite.config runs in Node, so `node:url` and
// `import.meta.url` exist at runtime; this file only provides their types for
// svelte-check. (No effect on the app bundle.)
declare module 'node:url' {
	export function fileURLToPath(url: string | URL): string;
}

interface ImportMeta {
	readonly url: string;
}
