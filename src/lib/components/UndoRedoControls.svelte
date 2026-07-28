<script lang="ts">
	import { Toolbar, ToolbarButton, Tooltip } from 'flowbite-svelte';
	import { UndoOutline, RedoOutline } from 'flowbite-svelte-icons';
	import { boardDoc } from '$lib/doc/store';

	let canUndo = $state(false);
	let canRedo = $state(false);

	// boardDoc.canUndo / canRedo are plain class getters, not Svelte signals.
	// Reading $boardDoc subscribes to the store so this $effect re-runs on
	// every edit / undo / redo, picking up the updated history state.
	$effect(() => {
		void $boardDoc;
		canUndo = boardDoc.canUndo;
		canRedo = boardDoc.canRedo;
	});

	function undo() {
		boardDoc.undo();
	}

	function redo() {
		boardDoc.redo();
	}
</script>

<Toolbar class="inline-flex items-center rounded-lg !p-0 shadow-lg shadow-black/5">
	<div class="relative flex items-center">
		<ToolbarButton
			class={canUndo
				? 'flex !my-0 min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200'
				: 'flex !my-0 min-h-11 min-w-11 cursor-not-allowed items-center justify-center rounded-lg px-3 text-sm text-gray-700 opacity-50'}
			onclick={undo}
			disabled={!canUndo}
			aria-label="Undo"
		>
			<UndoOutline />
		</ToolbarButton>
		<Tooltip
			trigger="hover"
			arrow={false}
			color="primary"
			class="hidden whitespace-nowrap md:block"
		>
			Undo (Ctrl+Z)
		</Tooltip>
	</div>
	<div class="relative flex items-center">
		<ToolbarButton
			class={canRedo
				? 'flex !my-0 min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm text-gray-700 hover:bg-primary-200'
				: 'flex !my-0 min-h-11 min-w-11 cursor-not-allowed items-center justify-center rounded-lg px-3 text-sm text-gray-700 opacity-50'}
			onclick={redo}
			disabled={!canRedo}
			aria-label="Redo"
		>
			<RedoOutline />
		</ToolbarButton>
		<Tooltip
			trigger="hover"
			arrow={false}
			color="primary"
			class="hidden whitespace-nowrap md:block"
		>
			Redo (Ctrl+Shift+Z)
		</Tooltip>
	</div>
</Toolbar>
