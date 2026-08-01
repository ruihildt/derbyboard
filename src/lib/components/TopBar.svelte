<script lang="ts">
	import type { KonvaGame } from '$lib/konva/KonvaGame';
	import { boardDoc } from '$lib/doc/store';
	import { authoringSession } from '$lib/stores/session';
	import { getCapabilities } from '$lib/experiences/capabilities';
	import { toolMode, type DrawTool } from '$lib/stores/toolMode';
	import { BookOpenOutline } from 'flowbite-svelte-icons';

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
		{ id: 'select', label: 'Select / pan', icon: '✋' },
		{ id: 'drawPath', label: 'Draw movement path', icon: '↗' },
		{ id: 'pen', label: 'Freehand pen', icon: '✏' },
		{ id: 'arrow', label: 'Arrow', icon: '→' },
		{ id: 'zone', label: 'Zone', icon: '◯' },
		{ id: 'label', label: 'Label', icon: 'A' },
		{ id: 'gap', label: 'Gap', icon: '⫶' }
	];

	// When the experience no longer admits tools (Free), reset to the default
	// tool so a stale draw tool isn't left armed against an uneditable board.
	$effect(() => {
		if (caps.admittedTools.length === 0 && $toolMode !== 'select') {
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
								{tool.icon}
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
