# HappyFarm — V2 UI Design Contract

## Visual direction

Modern, vivid, toy-like 2.5D/3D casual farm game. Warm coral-orange and honey highlights; rich leaf-green for active/positive states; dark cocoa contours and values; clean cream reading surfaces. **Not** old wood grain, beige parchment everywhere, flat dashboard skins, or thin button outlines. Avoid wallpapering a panel with flower stickers.

Existing approved illustrations are **visual references**, not sprites. Keep the current functioning 3D world, game economy and controls.

## Material hierarchy

- **Outer shell**: colored, dimensional thick rim with distinct side/lower-edge material and local contact shadow.
- **Inner content**: calmer clean cream, enough room for readable dynamic text. This *may* be a CSS fill: not every empty center needs raster texture.
- **Primary action**: the strongest shape/value contrast on its screen; visible normal/hover/pressed/disabled states.
- **Selected**: strong boundary contrast and a second cue (shape/check mark) beyond color alone.
- **Card**: artwork occupies the upper visual region, title/price/quantity occupy consistent live HTML/DOM zones. Do not bake them into the sprite.
- **HUD**: sufficiently dark or solid underlying plaque for reliable contrast over the 3D world.

## Artwork/export contract

For **each** sprite:
1. Keep an editable source (layered design file, vector, or source scene/script that genuinely reproduces the artwork).
2. Export PNG or WebP with **real RGBA transparency** where specified, high quality, high DPI (normally 2x of intended CSS dimensions).
3. No text, numerical values, item counts, player state, or locale strings baked into artwork.
4. Include every interaction state as an explicit sprite or supply documented compatible reuse rules.
5. For frames: reserve a center/edge stretch zone with a documented cap-inset in **source image pixels**. Decorations never cross repeat/stretch seams.
6. Keep a consistent light source (top-left), contour thickness, shadow softness, camera angle, color temperature and scale across assets.
7. Record source/provenance/license and intended screen/components.
8. Preview at actual rendered scale: 1x desktop, 2x high DPI, mobile 390x844.

## Required core families

| Family | Required variants | Typical consumers |
|---|---|---|
| `panel.shell` | default, compact | Build, Market, Inventory, Work Areas, Workers |
| `panel.header` | standard | all panels |
| `button.primary` | normal, hover, pressed, disabled | Build action, trading, upgrade |
| `button.secondary` | normal, hover, pressed, disabled | close/back/retry/secondary |
| `button.nav` | normal, active, disabled | side navigation |
| `card.item` | normal, hover, selected, disabled | market, inventory, planting |
| `badge.resource` | gold/level/price families as needed | HUD, price |

Illustrated item icons should be **identity-safe**: a carrot seed never depicts corn; use a neutral fallback when the item has no verified art.

## Code/UI contract (existing Vite + TypeScript DOM app)

- Codex must inspect live `apps/web/src/ui/components.ts`, `apps/web/src/main.ts`, `apps/web/src/styles.css`, and Build/Market renderers before editing.
- One **typed asset registry** with stable keys; no scattered raw URLs/filenames embedded in per-screen CSS overrides.
- One **shared presentation layer** for panel/header/button/card/slot; each screen supplies semantic classes/content and existing handlers.
- Avoid new state ownership. Existing DOM dynamic values, i18n, accessibility, backend semantics and click handlers remain authoritative.
- Use component-level CSS vars and asset mappings. Limit theme-specific selectors to `.ui-v2` (or chosen namespace) and keep existing V1 as non-destructive fallback until acceptance.
- For 9-slice: source-pixel cap insets are different from CSS border width. Example at `density=2`: 96px source cap corresponds to ~48 CSS px displayed border when at original design scale. Validate layout rather than blindly using these illustrative numbers.
- Responsive **composition** may change between 1440x900 and 390x844; do not shrink a full desktop modal via CSS transform.
- UI text scale should be evaluated relative to containers, with real Vietnamese text + longest available localized strings. Preserve CJK fallback.

## Quality gate

The integration is *not done* if:
- only the corners changed but >80% of the visible shell/card still uses the old material;
- assets visibly stretch or have opaque matte/halo artifacts;
- buttons look like lightly beveled CSS rectangles, not like the approved toy-like material;
- item art is mostly blank or represented by incorrect placeholders;
- screenshots do not show a clearly different result at identical screen/data/state;
- responsive controls overlap, clip or block gameplay; or
- the change works in tests but visually fails in the actual browser.
