# HappyFarm UI art direction — visual prototype review

Status: `UI_ART_DIRECTION_READY_FOR_REVIEW`  
Scope: design exploration and isolated local prototypes only  
Production UI, gameplay, API, economy, migrations, and deployment: unchanged

## Review artifact

The interactive prototype is isolated at:

`prototypes/ui-art-direction/index.html`

Run it from the repository root with a local Vite server, then open:

`http://127.0.0.1:4174/prototypes/ui-art-direction/`

The prototype has four screen states—HUD, Work Areas, Inventory, and Shop—plus direction tabs and
responsive breakpoints. Query parameters make review repeatable:

```text
?direction=meadowloom&screen=hud
?direction=sprout-circuit&screen=inventory
?direction=hearth-hedge&screen=shop
```

All artwork in the prototype is clearly temporary CSS/emoji-style illustration. It is a visual
composition study, not a replacement asset pack. The production model library remains the source of
truth for world objects and includes crops, trees, buildings, fish, props, and characters under
`apps/web/src/assets/models/`.

## Current visual audit

The existing client already has a strong interaction spine that should be preserved:

- `apps/web/index.html` provides a single world canvas, top HUD, module rail, contextual action dock,
  inventory/warehouse, market, build, Work Areas, Workers, placement, and offline/status surfaces.
- `apps/web/src/panels.ts` centralizes the one-active-module rule. This is reusable interaction logic,
  not a visual problem.
- `apps/web/src/icons.ts` owns inline SVG icons and avoids a third-party icon dependency. The current
  set is consistent but mostly outline/tool glyphs, so it does not yet create a recognisable item or
  world-art language.
- `apps/web/src/styles.css` already has responsive drawers, safe-area offsets, touch targets, focus
  rings, item grids, warehouse capacity, market cards, and Workers/Work Area states.
- `apps/web/src/build-shop/shop-view.ts` already renders catalogue thumbnails and states; the visual
  opportunity is stronger category framing, item storytelling, and price hierarchy.
- `apps/web/src/work-areas/model.ts` already owns selection, naming, and draft-cell behavior. The
  current CRUD presentation can become a named place card without changing that model.

The current production treatment is a single parchment/forest system: beige rectangular surfaces,
thin neutral borders, compact outline icons, and text-first rows. It is readable and functional, but
it does not give the HUD, the illustrated world, the item shelf, and the shop a shared emotional
identity. The prototype keeps the existing interaction concepts while testing three different
material languages.

## Direction A — Cozy Handcrafted Farm / Meadowloom

### Intent

Make the interface feel like a well-loved farm journal: warm paper, soft wood, stitched edges,
small illustrated objects, and gentle relief. It should feel tactile without looking like a literal
wooden dashboard.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#513B29` | Headings and item names |
| Paper | `#F7E7BD` | Panels and cards |
| Paper shadow | `rgba(71,49,29,.23)` | Lift from the world |
| Leaf | `#6F945D` | Primary actions, progress, ready state |
| Honey | `#F5D277` | Gold, focus, selected state |
| Berry | `#B96D72` | Hearts and warnings |
| Sky | `#A8D5D0` | World-facing atmospheric field |

- Typography: Fraunces/Georgia for place names and headings; DM Sans for labels, quantities, and
  controls.
- Panel material: warm parchment, one inset dotted rule, low soft shadow, asymmetrical 12–18 px
  corners. Use paper grain only as a low-opacity background texture.
- Button states: leaf green ready; honey selected; muted paper disabled; a small animated stitch or
  seed-pip for loading rather than a generic spinner.
- Custom icon style: filled mini illustrations—carrot, seed pouch, fish, pinecone, barn bell,
  basket—paired with a small label. Keep existing inline SVG for utility actions only.
- HUD: a framed brand mark, compact counters, a quest note, and a named location chip. The HUD should
  float over the world like a field journal, leaving the horizon visible.
- Inventory slots: square paper cards with an illustrated item window, quantity badge, category
  caption, and selected outline. Use the real game item id as the accessible label.
- Resource counters: gold, hearts, and level use different illustrated silhouettes, not color alone.
- Motion: 120–180 ms lift/fade; 300 ms reward bounce; no constant shimmer or idle animation that
  competes with the 3D world.
- Desktop/mobile: floating parchment panel on desktop; bottom sheet on phones; dock remains a
  compact, touch-sized tray. Preserve safe-area padding.

## Direction B — Modern Stylized Farming Adventure / Sprout Circuit

### Intent

Make the farm read as an explorable game immediately: high contrast, crisp information clusters,
bold custom glyphs, and controlled color accents. This is the strongest option for dense systems such
as Workers, Production, Warehouse, and the shop.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| Deep teal | `#163B49` | Panel body |
| Slate teal | `#214E5C` | Secondary surfaces |
| Mint | `#C8F1E7` | Readable level chip |
| Acid sprout | `#D8F35F` | Selected/ready/focus |
| Coral | `#F17A7F` | Alerts and hearts |
| Aqua | `#79D7CA` | Supporting labels |

- Typography: Nunito Sans or a comparable rounded grotesk; heavier weights for action labels and
  compact metrics. Avoid using a decorative display font for system-heavy panels.
- Panel material: deep translucent teal with a one-pixel aqua edge, 8–14 px corners, and restrained
  blur. Cards should resemble equipment readouts rather than SaaS widgets.
- Button states: acid sprout for selected and confirm; aqua outline for secondary; disabled is a
  lower-contrast slate with an explicit lock label; loading uses a tiny ring plus a status word.
- Custom icon style: chunky two-tone pictograms with a fill plane and a simple highlight. Utility
  symbols may remain inline SVG; item symbols should be illustrated silhouettes.
- HUD: left quest objective, top resource strip, bottom action dock, and a strong location label.
  Information density is higher, but each cluster has one dominant reading order.
- Inventory slots: darker shelf, acid selection frame, large crop/fish/material silhouette, quantity
  in a badge, and a short production/status label.
- Resource counters: compact chips with distinct shape/color pairs and tabular numbers.
- Motion: 100–140 ms snap/lift transitions, short confirmation pulse on a selected target, no
  parallax that reduces aiming or camera readability.
- Desktop/mobile: desktop panel can sit beside the world; phone becomes a full-width lower sheet with
  two-column slots and a horizontally scrollable category rail.

## Direction C — Rustic Village Storybook / Hearth & Hedge

### Intent

Make each interaction feel like opening a page from a village storybook. Decorative borders and warm
ink are used as framing devices, while content stays sparse enough for the 3D scene to remain the
hero.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| Story ink | `#62383B` | Text and outlines |
| Cream paper | `#F7E2BB` | Pages and cards |
| Clay red | `#A8544B` | Navigation and emphasis |
| Sage | `#8A9B61` | Ready/healthy state |
| Marigold | `#F5C677` | Gold and focus |
| Rose | `#B96D72` | Hearts and warnings |

- Typography: a restrained storybook display face for major titles, paired with Georgia/system text
  for reliable body readability. Avoid using the display face for quantities or long instructions.
- Panel material: double-line or dotted crafted borders, lightly mottled cream paper, squared or
  very small corners, and a clay-red chapter tab.
- Button states: clay-red confirm, marigold selected, cream secondary, desaturated paper disabled.
  Never communicate state through decorative border changes alone.
- Custom icon style: illustrated stamps—rosette, basket, windmill, seed packet, fish hook, worker
  badge—rather than a generic utility icon grid.
- HUD: chapter title, small village crest, resource ribbons, and a page-like quest card. It should
  feel authored, not procedurally generated.
- Inventory slots: storybook specimen cards with a large item illustration and a caption line. Avoid
  more than six visible slots on a phone.
- Resource counters: small paper tags with icon + label; use text and silhouette together.
- Motion: page-turn-like 180–240 ms reveal, gentle status bob for a newly earned item, no aggressive
  bounce or spring physics.
- Desktop/mobile: desktop uses an inset story page; phone uses a bottom sheet with chapter header and
  scrollable content. Keep ornamental borders out of the touch hit area.

## Prototype component inventory

The isolated preview intentionally mirrors the concepts already present in the client:

- world window with a temporary farm illustration and an explicit `TEMP ART` label;
- top brand, location, resource counters, level/progress, and menu control;
- quest/objective card and contextual interaction prompt;
- module dock for Bag, Market, Build, and Workers;
- Work Area cards with name, tile count, tags, edit, and assignment actions;
- Warehouse capacity strip and category tabs;
- illustrated item slots with quantities, selected state, and category text;
- shop hero, category tabs, offer cards, price tags, buy, and locked states;
- state strip for ready, selected, disabled, and loading controls;
- desktop, tablet, and mobile layout behavior.

These are visual components only. They do not import production application code or send commands.

## Screenshot evidence

Screenshots were captured from the local-only prototype with the installed headless Edge browser after
the responsive header overflow was corrected.

### Desktop — 1440 × 900

- [Meadowloom HUD](../../prototypes/ui-art-direction/meadowloom-1440x900.png)
- [Sprout Circuit HUD](../../prototypes/ui-art-direction/sprout-circuit-1440x900.png)
- [Hearth & Hedge HUD](../../prototypes/ui-art-direction/hearth-hedge-1440x900.png)

### Tablet — 768 × 1024

- [Meadowloom inventory](../../prototypes/ui-art-direction/meadowloom-768x1024.png)
- [Sprout Circuit inventory](../../prototypes/ui-art-direction/sprout-circuit-768x1024.png)
- [Hearth & Hedge inventory](../../prototypes/ui-art-direction/hearth-hedge-768x1024.png)

### Mobile — 390 × 844

- [Meadowloom Work Areas](../../prototypes/ui-art-direction/meadowloom-390x844.png)
- [Sprout Circuit Work Areas](../../prototypes/ui-art-direction/sprout-circuit-390x844.png)
- [Hearth & Hedge Work Areas](../../prototypes/ui-art-direction/hearth-hedge-390x844.png)

## Visual QA observations

- 1440 desktop: the world remains the largest visual field; the panel occupies a clear right-side
  reading column; quest and action prompt create a diagonal reading path without covering the barn.
- 768 tablet: direction cards stack and the panel remains legible; the inventory grid changes to two
  columns at the narrow breakpoint. This is the strongest review size for hierarchy and touch target
  inspection.
- 390 mobile: the direction selector stacks, the panel becomes a lower sheet, the action dock stays
  reachable, and the heading now wraps within the viewport. Panel content is intentionally scrollable;
  long Work Area descriptions wrap instead of forcing horizontal page scroll.
- Text readability: all directions pair display treatment with a more functional body face and use
  text labels beside color/silhouette state cues.
- Touch targets: prototype buttons use generous padding and the phone dock uses flexible equal-width
  controls. Production implementation must retain the existing safe-area and `--touch-target` rules.
- Layering/occlusion: panel shadows separate UI from the world, while the world caption and action
  prompt are clearly prototype-only annotations to remove in implementation.
- Artwork consistency: A is tactile and soft; B is high-contrast and game-system oriented; C is
  decorative and authored. They are not palette-only variants.

## Recommendation

Choose **A — Meadowloom** as the primary direction, with Sprout Circuit’s contrast and state discipline
as a constraint. Meadowloom best closes the gap between the warm 3D farm and the HUD, gives inventory
and shop items a natural illustrated presentation, and can make Work Areas feel like named places
rather than CRUD records. Sprout Circuit is the fallback if later testing shows that production-heavy
Worker/Warehouse panels need more information density. Hearth & Hedge is a strong seasonal/event skin,
but its decorative border system should not become the default for dense management screens.

## Artwork requirements

Before production implementation, commission or author a small coherent set rather than adding one-off
icons:

1. 12–16 item illustrations covering seeds, crops, fish, wood, stone, and warehouse materials.
2. 6 resource/currency silhouettes with filled and disabled variants.
3. 5 module marks and 8 utility icons; utility icons can remain the existing inline SVG family.
4. 3 worker portraits or role badges for the Workers/Auto panel.
5. 4 shop category stamps and 3 Work Area state markers.
6. One subtle paper/wood or storybook texture per selected direction, exported compressed and reused.

Every asset needs an accessible text label, a disabled/high-contrast treatment, and a documented license.
Read `docs/ASSET_LICENSES.md` before introducing third-party artwork.

## Implementation roadmap after approval

1. Select one direction and freeze its tokens, type scale, material rules, and icon approach.
2. Extract a presentation-only token layer; do not change `panels.ts`, domain logic, contracts, or
   authoritative data flow.
3. Replace the module shell and navigation treatment first, preserving existing element IDs and event
   wiring where practical.
4. Add an item-illustration adapter to the current thumbnail/item-card path; keep model ids and server
   quantities authoritative.
5. Restyle Work Areas as named place cards using the existing `work-areas/model.ts` state transitions.
6. Restyle Warehouse, Workers, offline return, and shop panels in that order, with screenshot review at
   1440×900, 768×1024, and 390×844 after each surface.
7. Add visual regression screenshots and keyboard/touch accessibility checks before any staging
   deployment.

## Performance and accessibility guardrails

- Keep the renderer and HUD on separate layers; do not add a full-screen blur or animated canvas texture
  to every panel.
- Prefer CSS gradients, SVG, and a small sprite/illustration set over many large raster images.
- Lazy-load noncritical decorative art; first 3D frame must not wait for shop or inventory artwork.
- Retain semantic buttons, labels, `aria-expanded`/`aria-selected` state, keyboard focus rings, and
  the existing touch target minimum.
- Never rely on color alone for ready, locked, disabled, or selected states.
- Respect `prefers-reduced-motion`; reward feedback must have a non-motion equivalent.
- Keep safe-area insets and ensure a panel can be dismissed without covering the only route back to the
  3D world.

## Out of scope for this prototype

No production HTML/CSS refactor, gameplay change, Production Rate or Warehouse change, API or migration,
deployment, commit, push, reset, stash, or clean operation was performed.
