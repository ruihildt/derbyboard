import { writable } from 'svelte/store';
import { browser } from '$app/environment';

/**
 * "Mobile" layout: a narrow viewport (portrait phones) OR a short viewport
 * (landscape phones). Tailwind's `@custom-variant` can't express an OR of two
 * media features, so this drives the layout switches from a single matchMedia.
 */
const MOBILE_QUERY = '(max-width: 639.98px), (max-height: 500px)';

function createIsMobile() {
	const store = writable(false);
	if (browser) {
		const mql = window.matchMedia(MOBILE_QUERY);
		store.set(mql.matches);
		mql.addEventListener('change', (e) => store.set(e.matches));
	}
	return store;
}

export const isMobile = createIsMobile();
