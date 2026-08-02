<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { getCapabilities } from '$lib/experiences/capabilities';
	import { toolMode, type DrawTool } from '$lib/stores/toolMode';
	import { BookOpenOutline, DrawSquareOutline } from 'flowbite-svelte-icons';

	import Menu from './Menu.svelte';
	import ExperienceSwitcher from './ExperienceSwitcher.svelte';

	let {
		game,
		docked = false,
		onOpenArchive,
		onOpenNews,
		onOpenBoardSettings,
		onOpenLibrary
	}: {
		game: KonvaGame;
		/** When true the Library sidebar is docked: the bar frames only the
		 * canvas area (right-inset by the sidebar width) so its centered
		 * content and right-anchored trigger follow the canvas, not the viewport. */
		docked?: boolean;
		onOpenArchive?: () => void;
		onOpenNews?: () => void;
		onOpenBoardSettings?: () => void;
		onOpenLibrary?: () => void;
	} = $props();

	// Capabilities are derived from the doc shape. Touch both stores so this
	// re-derives when either the document or the authoring session changes.
	const caps = $derived.by(() => {
		void $boardDoc;
		void $authoringSession;
		return getCapabilities($boardDoc);
	});

	const tools: { id: DrawTool; label: string; icon: string }[] = [
		{ id: 'select', label: 'Select', icon: '' },
		{ id: 'hand', label: 'Pan (hand)', icon: '' },
		{ id: 'drawPath', label: 'Draw movement path', icon: '' },
		{ id: 'pen', label: 'Freehand pen', icon: '✏' },
		{ id: 'arrow', label: 'Arrow', icon: '→' },
		{ id: 'zone', label: 'Zone', icon: '◯' },
		{ id: 'label', label: 'Label', icon: 'A' },
		{ id: 'gap', label: 'Gap', icon: '⫶' }
	];

	// Reset to the neutral tool whenever the current tool isn't admitted by the
	// active experience (e.g. a drawing tool armed in Drill, then the board
	// drops back to Free; or the `hand` tool armed in Free, then a clip turns
	// the board into Drill). Keeps a stale tool from acting on an uneditable
	// board.
	$effect(() => {
		if (!caps.admittedTools.includes($toolMode)) {
			toolMode.set('select');
		}
	});
</script>

<div
	class="pointer-events-none fixed top-0 z-30 {docked
		? 'left-0 right-[24rem]'
		: 'inset-x-0'} px-[max(0.75rem,env(safe-area-inset-left))] py-[max(0.5rem,env(safe-area-inset-top))]"
>
	<!-- Main menu: top-left, separate from the board controls. -->
	<div class="pointer-events-auto">
		<Menu {game} {onOpenArchive} {onOpenNews} {onOpenBoardSettings} />
	</div>

	<!-- Unified control bar (centered): board interactions only. The switcher
	     is shared across Free Play and Drill; the drawing tools appear only in
	     Drill (behind a divider). The switcher badge indicates the mode. -->
	<div
		class="pointer-events-auto absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] -translate-x-1/2"
	>
		<div
			class="flex flex-wrap items-center justify-center gap-1 rounded-2xl bg-white p-1 shadow-lg shadow-black/10"
		>
			<ExperienceSwitcher />

			{#if caps.admittedTools.length > 0}
				<div class="mx-0.5 h-6 w-px self-center bg-gray-200"></div>
				<div class="flex items-center gap-0.5">
					{#each tools as tool (tool.id)}
						{#if caps.admittedTools.includes(tool.id)}
							<button
								type="button"
								class="flex min-h-11 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors {$toolMode ===
								tool.id
									? 'bg-primary-100 text-primary-700'
									: 'text-gray-600 hover:bg-primary-50'}"
								onclick={() => toolMode.set(tool.id)}
								aria-label={tool.label}
								title={tool.label}
							>
								{#if tool.id === 'select'}
									<!-- Mouse-cursor glyph: the Select tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M5.5 2.5v15l3.2-3 2.3 5 1.8-.8-2.3-5 4.5 0z" />
									</svg>
								{:else if tool.id === 'hand'}
									<!-- Open-hand glyph: the dedicated Pan tool. -->
									<svg
										class="h-[18px] w-[18px]"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M18 11V6a2 2 0 0 0-4 0" />
										<path d="M14 10V4a2 2 0 0 0-4 0v2" />
										<path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
										<path
											d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
										/>
									</svg>
								{:else if tool.id === 'drawPath'}
									<DrawSquareOutline class="h-[18px] w-[18px]" aria-hidden="true" />
								{:else}
									{tool.icon}
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Library trigger: top-right, opens the Library sidebar. Hidden while the
	     sidebar is docked (open + pinned) — its own pin/close controls suffice. -->
	{#if !docked}
		<div
			class="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))]"
		>
			<button
				type="button"
				class="library-trigger flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white p-2 shadow-lg shadow-black/5 hover:bg-primary-200"
				onclick={onOpenLibrary}
				aria-label="Library"
				title="Library"
			>
				<BookOpenOutline class="h-6 w-6 text-gray-700" />
			</button>
		</div>
	{/if}
</div>
