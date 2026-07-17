// Derbyboard service worker — installable + offline.
// Strategy: network-first (always latest when online) with cache fallback
// (offline works after the first load). No precache manifest is needed: hashed
// assets are cached lazily as they're requested, and navigations cache the SPA
// shell so the whole app boots offline. Bump CACHE to invalidate on deploy.
const CACHE = 'derbyboard-v1';

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// Best-effort shell warm-up; individual failures (e.g. a URL not served
			// in dev) must not break installation.
			await Promise.allSettled([
				cache.add('/'),
				cache.add('/manifest.webmanifest'),
				cache.add('/favicon.png')
			]);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			try {
				const fresh = await fetch(req);
				cache.put(req, fresh.clone());
				return fresh;
			} catch {
				return (await cache.match(req)) || (await cache.match('/')) || Response.error();
			}
		})()
	);
});
