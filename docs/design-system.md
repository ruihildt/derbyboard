# Derbyboard Design System

The conventions below are the established standard for all UI controls. Apply them
consistently so every bar, button, and overlay matches.

## Sizing

### Control height — 44px (the standard)

**44px (`min-h-11`) is the standard height for every interactive control**, on both
desktop and mobile. This is the WCAG/Apple/Google recommended minimum touch target
and the single source of truth for control height.

- Text + icon buttons: `min-h-11`
- Icon-only buttons (mic, play, zoom `−`/`+`, menu, …): `min-h-11 min-w-11` (square)

Tailwind mapping: `min-h-11` = `min-w-11` = `2.75rem` = **44px**. Do **not** introduce
other heights (e.g. `min-h-9`/36px) for controls — if a control needs to be taller or
shorter, raise it here first.

### Bars / pills

- Every bar (zoom, capture, replay) is **exactly 44px** (`h-11` / `2.75rem`) tall,
  matching the zoom bar. Control bars (`control-bar` class, styled in
  `src/app.css`) enforce this with a fixed `height: 2.75rem`.
- Inside capture/replay control bars, buttons are **36px** (`min-h-9`), inset with
  `0.25rem` padding so there is consistent spacing around every button (4px on all
  sides, plus the bar's `gap-*` between buttons). Icon-only buttons stay square at
  `min-h-9 min-w-9` (36×36). Buttons get a resting `bg-gray-100` background;
  hover/active backgrounds are still per-button utilities.
- Flowbite `ToolbarButton` carries a default `m-0.5` that adds vertical height; always
  pass `!my-0` on `ToolbarButton`s used inside bars so the bar stays exactly 44px.
- Horizontal spacing between buttons uses the bar's `gap-*`, not button margins.

## Corner radius — `rounded-lg` (8px)

- Bars, pills, and all buttons use `rounded-lg`.
- Because buttons sit flush in their bar (no padding) and share the same radius,
  hover/active backgrounds never clip past the bar's corners.
- Segmented groups (e.g. the zoom control) may use `rounded-lg` on every button since
  the buttons are separated by their default horizontal margin.
- Dropdown **menu items** keep `rounded` (4px) — they are inset within their popup
  (`p-1`), so there is no corner clipping.

## Layout & responsiveness

- "Mobile" layout is driven by `src/lib/stores/viewport.ts` → `isMobile`, via
  `matchMedia('(max-width: 639.98px), (max-height: 500px)')` — narrow **or** short
  viewports (covers portrait phones and landscape phones). Tailwind's `@custom-variant`
  cannot express an OR of two media features, so layout switches read `$isMobile`.
- All overlays use `env(safe-area-inset-*)` (with `viewport-fit=cover` in `app.html`)
  so controls clear notches and the home indicator.
- The canvas (`#container`) uses `100dvh`/`100dvw` and `KonvaGame` measures the
  container element (not `window`) for sizing.
