<script lang="ts">
	import { WATERMARK_FRACTIONS, WATERMARK_PAD_FRACTION } from '$lib/konva/Watermark';
	import { exportSettings } from '$lib/stores/exportSettings';

	// Selected size drives the fraction; matches Watermark.draw.
	const frac = $derived(WATERMARK_FRACTIONS[$exportSettings.watermark]);

	// Logo intrinsic size (aspect ratio only), resolved once the image loads.
	let naturalW = $state(0);
	let naturalH = $state(0);
	// Width of the positioned parent (the region box or the viewport).
	let cw = $state(0);

	// Size + corner inset scale with the parent width, matching Watermark.draw so
	// the logo keeps a consistent relative size and corner distance at any size.
	const w = $derived(cw ? Math.min(cw * frac, cw / 2) : 0);
	const h = $derived(naturalW ? w * (naturalH / naturalW) : 0);
	const pad = $derived(cw * WATERMARK_PAD_FRACTION);
</script>

<!--
	Clips to its positioned parent (the region box or the viewport) so the logo
	sits exactly where the export will stamp it: inset from the bottom-right
	corner by a width-proportional margin, never wider than half the parent.
-->
<div class="pointer-events-none absolute inset-0 overflow-hidden" bind:clientWidth={cw}>
	<img
		src="/derbyboard-logo.svg"
		alt=""
		aria-hidden="true"
		class="absolute select-none"
		style="right: {pad}px; bottom: {pad}px; width: {w}px; height: {h}px;"
		onload={(e) => {
			const img = e.currentTarget as HTMLImageElement;
			naturalW = img.naturalWidth;
			naturalH = img.naturalHeight;
		}}
	/>
</div>
