import { persisted } from 'svelte-persisted-store';

/**
 * Durable authoring session state: which clip and step the user was working
 * on, restored across reloads (P3 task 11 — session restore). Kept separate
 * from the `BoardDoc` schema so the document's shape stays stable and these
 * ephemeral pointers don't require a document migration when they change.
 */
export interface AuthoringSession {
	/** id of the clip being authored, or null when editing the free board. */
	activeClipId: string | null;
	/** Index into that clip's `steps`. Clamped on use; -1 when inactive. */
	activeStepIndex: number;
}

export const authoringSession = persisted<AuthoringSession>('derbyboard-authoring-session', {
	activeClipId: null,
	activeStepIndex: -1
});
