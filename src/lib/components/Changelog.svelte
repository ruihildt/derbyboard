<script lang="ts">
	import { Drawer, Timeline, TimelineItem } from 'flowbite-svelte';
	import { CloseOutline } from 'flowbite-svelte-icons';
	let hidden = true;

	function onWindowPointerDown(e: PointerEvent) {
		if (hidden) return;
		const panel = document.querySelector('.news-drawer');
		if (!panel) return;
		const target = e.target;
		if (target instanceof Element && !panel.contains(target) && !target.closest('.news-trigger')) {
			hidden = true;
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<button
	on:click={() => (hidden = !hidden)}
	class="news-trigger rounded-lg bg-white px-4 py-2 text-sm text-gray-700 hover:bg-primary-200"
>
	News
</button>

<Drawer
	bind:hidden
	placement="right"
	modal={false}
	dismissable={false}
	class="news-drawer w-96 shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.1)]"
>
	<div class="mb-2 flex shrink-0 items-center justify-between">
		<h5 class="pl-5 text-xl font-bold">The latest</h5>
		<button on:click={() => (hidden = true)} class="rounded-lg p-2 hover:bg-primary-200">
			<CloseOutline class="h-5 w-5" />
		</button>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto pe-2 pl-2">
		<Timeline>
			<TimelineItem title="Same same but different" date="2025 April 1st" liClass="!mb-7">
				<p>
					This is the Track of Theseus, where everything is progressively being replaced over time.
					But you can feel differences. An infinite canvas ready to be explored. A window of
					opportunity when recording. A different approach to a start. And a refined design coming
					to an end.
				</p>
			</TimelineItem>
			<TimelineItem title="Fingerplay" date="2024 December 2nd" liClass="!mb-7">
				<p>
					If you have multiple fingers you can now move multiple players around simultaneously. If
					you just want to keep using the one, that's also fine. Feel free to zoom past your
					opponents and pan them too.
				</p>
			</TimelineItem>
			<TimelineItem title="Holding on" date="2024 November 30th" liClass="!mb-7">
				<p>
					Players will now hold on to their positions, even when you refresh the page or restart the
					browser. Good players!
				</p>
			</TimelineItem>
			<TimelineItem title="A bite for everyone" date="2024 November 29th" liClass="!mb-7">
				<p>
					On the menu, a smörgås-board of options: save/load the current board state, export it as
					an image or just reset it. Outside the track, officials get a lane. For the record, you
					get a countdown and a time tracker. And finally Derbyboard gets a brand new brand!
				</p>
			</TimelineItem>
			<TimelineItem title="It's (skating) official!" date="2024 November 23th" liClass="!mb-7">
				<p>We welcome skating officials on board. Please behave.</p>
			</TimelineItem>
			<TimelineItem title="Covering your track" date="2024 November 20th" liClass="!mb-7">
				<p>Quick, take cover! Here pivots stripe and jammers star.</p>
			</TimelineItem>
			<TimelineItem title="Second chance" date="2024 November 19th" liClass="!mb-7">
				<p>Before saving a recording, you get a chance to review it. Annoying voice, right?</p>
			</TimelineItem>
			<TimelineItem title="Derbyboard is out!" date="2024 November 18th" liClass="!mb-7">
				<p>
					There's a track, players move and the pack is visible along with the engagement zone.
					Record along with audio now directly from your browser!
				</p>
			</TimelineItem>
		</Timeline>
	</div>
</Drawer>
