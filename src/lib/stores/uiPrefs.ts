import { persisted } from 'svelte-persisted-store';

export interface UiPrefs {
	rotateHintDismissed: boolean;
}

export const uiPrefs = persisted<UiPrefs>('derbyboard-ui', {
	rotateHintDismissed: false
});
