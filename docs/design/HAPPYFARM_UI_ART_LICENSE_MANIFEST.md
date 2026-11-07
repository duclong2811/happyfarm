# HappyFarm Inventory artwork license manifest

This manifest records both the preserved third-party source history and the independent artwork used
by the current Inventory presentation. Item names, quantities, capacity values and all interaction
labels remain DOM content owned by HappyFarm.

The current Inventory primary surfaces use the original, text-free PNG layers in
`apps/web/src/assets/ui/inventory-premium/`. The Kenney files and superseded wood-grain layers remain
in the repository with their license/source records for provenance, but are not used as the primary
Golden Farm Adventure material layer.

## Integrated source

| Source | Artist | License | Files used | Modification |
| --- | --- | --- | --- | --- |
| [Kenney UI Pack - Adventure](https://kenney.nl/assets/ui-pack-adventure) | Kenney | Creative Commons CC0 / public domain | `apps/web/src/assets/ui/kenney/*` | Preserved unchanged for license/provenance. Removed from the primary Inventory material layer after visual review rejected the pixel/fantasy direction. |

## Current primary artwork

| Source | Artist | License | Files used | Modification |
| --- | --- | --- | --- | --- |
| HappyFarm original asset kit 01 | HappyFarm project / generated original artwork | Project-owned original artwork; no third-party source material | `v1-panel-frame.png`, `v1-title-bar.png`, `parchment-texture.png`, `golden-slot-normal.png`, `v1-tab-normal.png`, `v1-tab-active.png`, `golden-button-primary.png`, `golden-button-secondary.png`, `v1-seed-generic.png`, `v1-seed-carrot.png`, `v1-seed-corn.png`, `leaf-sprig.png` | Authored as text-free, independent PNG layers for the Premium Stylized / Golden Farm Adventure direction. Carrot and corn pouches are separate transparent assets selected from the real crop catalogue. No competitor screenshots or approved concept-sheet crops were used. Panel, title, tab, slot, button, HUD and navigation frames are consumed through CSS 9-slice/border-image rules; DOM owns all copy and quantities. |

The kit was generated from text-only art briefs for this repository and visually checked for baked text,
numbers, neighboring sprites and screenshot fragments before integration. The source outputs are retained
outside the repository by the generation service; the normalized project copies above are the release assets.

The source archive's `License.txt` is preserved at
`apps/web/src/assets/ui/kenney/Kenney-License.txt`.

## V1 candidate trial

The first-party candidate kit in `docs/design/artwork-candidates/HAPPYFARM_PREMIUM_ART_KIT_V1.zip`
was visually inspected against light/dark backgrounds. The following clean, text-free candidates are
integrated only into the real Inventory trial under the `v1-*` filenames:

| Candidate | Project file | Decision |
| --- | --- | --- |
| `inventory_panel_blank.png` | `v1-panel-frame.png` | Integrated with 9-slice `160 82 180 84`. |
| `wood_title_blank.png` | `v1-title-bar.png` | Integrated as a scalable blank title bar; title remains DOM text. |
| `button_primary_blank.png` | `v1-button-primary.png` | Previously trialed, now superseded by `golden-button-primary.png`; preserved for provenance. |
| `category_tab_blank.png`, `category_tab_alt_blank.png` | `v1-tab-normal.png`, `v1-tab-active.png` | Integrated as normal/active tab frames; labels remain DOM text. |
| `item_seed_generic.png`, `item_seed_carrot.png`, `item_seed_corn.png` | `v1-seed-generic.png`, `v1-seed-carrot.png`, `v1-seed-corn.png` | Integrated through the existing real crop catalogue mapping. |

The candidate `slot_normal.png`, `slot_hover.png`, `slot_selected.png` and `slot_disabled.png`
were rejected because direct inspection showed baked state labels (`Normal`, `Hover`, `Selected`,
`Disabled`) below the slot artwork. The legacy clean slot assets remain preserved but are no longer the
primary slot material after the Golden Farm Adventure refinement. Source atlases,
contact sheets and synthetic QA frames are not shipped or used as UI layers.

## Reviewed but not integrated

| Source | Artist | License | Decision |
| --- | --- | --- | --- |
| [Game wood panel](https://opengameart.org/content/game-wood-panel) | PINKCANNON | CC0 | Rejected for this slice: the available PNG is a flattened composite panel and the layered PSD is not a browser-ready independent asset set. It is not forced into the Inventory layout. |
| [Ultimate RPG Pack](https://quaternius.com/packs/ultimaterpg.html) | Quaternius | CC0 / Quaternius Asset License | Rejected for this slice: it is a 3D model/render pack, not a matching Inventory UI artwork source. |

No competitor-game screenshots or approved concept-sheet crops were used.

## Golden Farm Adventure refinement artwork

| Source | Artist / origin | License | Files used | Modification |
| --- | --- | --- | --- | --- |
| HappyFarm Golden Farm Adventure material kit | Newly authored project artwork generated from text-only briefs; no third-party source material | Project-owned original artwork; no third-party source material | `golden-button-primary.png`, `golden-button-secondary.png`, `golden-slot-normal.png` | Transparent, text-free, independently reusable honey-gold/caramel frames. Optimized to production dimensions and consumed through CSS 9-slice/border-image rules. Primary/hover/selected/disabled states are DOM/CSS state selections over the same clean material family; no concept screenshot was cropped. |

The superseded `button-*`, `hud-resource.png`, `nav-button-*` and `slot-*` wood-grain layers remain
available for provenance but are not referenced by the Golden Farm Adventure semantic tokens.

## UI target handoff icon artwork

| Source | Artist / origin | License | Files used | Modification |
| --- | --- | --- | --- | --- |
| HappyFarm target-handoff icon set | Newly authored project artwork generated from text-only briefs; no third-party source material | Project-owned original artwork; no third-party source material | `apps/web/src/assets/ui/target-handoff/nav-inventory-bag.png`, `nav-market-map.png`, `nav-build-hammer.png`, `nav-work-area.png`, `nav-workers.png`, `hud-gold-coin.png`, `hud-level-star.png` | Transparent standalone dimensional icons, downscaled to 256px source canvases for CSS background rendering. No reference screenshot pixels, text, labels, quantities or gameplay data were copied. Existing DOM labels and authoritative values remain unchanged. |

## Reproducible production 2.5D material family

| Source | Toolchain | License / provenance | Files used | Rebuild command |
| --- | --- | --- | --- | --- |
| HappyFarm production material pipeline | Python 3.11 + Pillow; editable source `tools/ui-art/generate_premium_ui.py` | Project-owned original raster artwork; no third-party source material | `apps/web/src/assets/ui/premium-2_5d/button-primary.png`, `button-secondary.png`, `button-selected.png`, `button-disabled.png`, `nav-button-normal.png`, `nav-button-active.png`, `item-slot.png` | `python tools/ui-art/generate_premium_ui.py` |

The generator renders independent RGBA layers with contact shadow, material gradient, bevel/highlight
passes and fixed corner leaves. Text, quantities and localization are not baked into any output. The
button and slot layers are consumed through CSS 9-slice `border-image`; detailed corner ornaments are
kept in the fixed slices rather than stretched. Blender was checked and is not installed locally, so
the Pillow pipeline is the reproducible authoring tool for this slice.

## Vibrant Cozy Farm 3D Market acceptance assets

| Source | Artist / origin | License / provenance | Files used | Modification |
| --- | --- | --- | --- | --- |
| HappyFarm original AI-authored Market material set | HappyFarm project / generated from the documented text-only briefs in this task | Project-owned original artwork; no third-party source material and no reference-image pixels | `apps/web/src/assets/ui/vibrant-market/panel-header.png`, `panel-corner.png`, `product-card-corner.png`, `primary-orange.png`, `secondary-cream.png`, `selected-green.png`, `close-coral.png`, `price-badge.png`, `tab-cream.png` | Original transparent RGBA renders, resampled for browser use with FFmpeg. The panel and product-card corner layers remain fixed-size and are mirrored only by CSS; they are never stretched through the center. They contain no labels, prices, quantities, icons or gameplay state; CSS supplies all dynamic copy and real item thumbnails. The set is scoped to `.ui-market-vibrant` only while the new direction awaits review. |

Two earlier generated full-frame candidates were rejected and are deliberately not copied to the
project because inspection found a baked opaque backdrop rather than clean alpha. They are not
production assets. The accepted replacement is a layered equivalent: independent transparent corner
sprites over clean, ornament-free stretch zones. This keeps decorative material out of the stretch
zones while retaining a responsive panel and card interior for actual DOM content.

## Self-hosted UI fonts

| Package | Upstream authors | License | Imported entry point | Coverage / usage |
| --- | --- | --- | --- | --- |
| `@fontsource-variable/baloo-2@5.3.0` | Baloo 2 Project Authors | SIL Open Font License 1.1 | `apps/web/src/main.ts` → `@fontsource-variable/baloo-2/index.css` | Variable normal face with Latin, Latin-ext and Vietnamese ranges; display headings and prominent actions. |
| `@fontsource-variable/nunito@5.3.0` | Nunito Project Authors | SIL Open Font License 1.1 | `apps/web/src/main.ts` → `@fontsource-variable/nunito/index.css` | Variable normal face with Latin, Latin-ext and Vietnamese ranges; body labels, counters, tabs and HUD values. |

Only the normal variable CSS entry points are imported. Italic faces are not bundled, and unicode-range
rules allow browsers to request only the matching glyph subset. Korean/CJK text continues through the
existing system fallback stack.
