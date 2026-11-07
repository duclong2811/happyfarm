# HappyFarm Approved UI Implementation Plan

Status: handoff plan only — no production UI implementation has started.

Approved direction: Premium Stylized 3D Farming Adventure.

## 0. Handoff gate

The approved reference is now present at `docs/design/references/HAPPYFARM_APPROVED_HUD_INVENTORY_REFERENCE.png`. It is a flattened desktop composition; the existing `prototypes/ui-art-direction/` material remains rejected and is not design input. The detailed intake findings are in `docs/design/HAPPYFARM_APPROVED_HUD_INVENTORY_HANDOFF.md`.

The implementation must remain blocked until the approved artwork is provided as an attachment or an accessible source export. The handoff should include:

- the approved HUD and Inventory reference at its original resolution;
- the approved desktop, tablet, and mobile layouts, if they are separate compositions;
- source artwork or exportable layers for frames, buttons, slots, icons, and backgrounds;
- font names and licensing information;
- annotations identifying which labels, counters, icons, and states are real game data;
- approval of any elements that are decorative only.

This plan records the implementation boundary without guessing the appearance of the missing reference.

## 1. Current production UI audit

The client is plain TypeScript + Vite with direct Three.js rendering. The HUD is DOM/HTML/CSS over the Three.js canvas; it is not a React surface. The redesign should therefore preserve the current DOM/event architecture and replace presentation in controlled slices.

| Production surface | Current entry points | Current responsibility | Handoff treatment |
| --- | --- | --- | --- |
| World shell and HUD | `apps/web/index.html`, `apps/web/src/styles.css`, `apps/web/src/main.ts` | Canvas, top HUD, status, loading/error surfaces, world overlay | Preserve canvas and state; restyle only after reference approval |
| Top HUD | `#top-hud`, `#wallet`, `#progression`, language/refresh controls, camera controls | Wallet, progression, language, refresh, camera mode and recenter | Map to approved premium HUD frame; numbers and labels remain live HTML |
| Navigation rail | `#module-rail`, `apps/web/src/panels.ts`, `apps/web/src/icons.ts` | Opens Inventory, Market, Build, Work Areas, and Workers | Preserve module IDs, transitions, keyboard behavior, and panel ownership; replace icon/frame art |
| Inventory | `#inventory-panel`, `#warehouse`, `renderInventory()`, `renderWarehouse()` in `main.ts` | Warehouse capacity, item categories, quantities, selected item, upgrade action | Map to approved Inventory composition; item data remains server/API sourced |
| Shared item cards | `apps/web/src/items/card.ts`, `items/visuals.ts`, `items/thumbnails.ts` | Real GLB thumbnail or honest fallback, quantity, selection, lock/empty state | Reuse data/state model; add approved slot/frame/icon art around it |
| Market/shop | `#market-panel`, `renderMarket()`, `build-shop/shop-view.ts`, `build-shop/shop-thumbnails.ts` | Buy/sell tabs, item cards, price, owned quantity, quantity stepper, submit | Map to approved shop treatment without changing price or settlement logic |
| Build catalog | `#build-panel`, `build-shop/shop-view.ts`, `render/thumbnail.ts` | Catalog, search, category rail, inspector, placement entry | Preserve the shared thumbnail pipeline; use approved panel and control styling |
| Work Areas | `#work-areas-panel`, `apps/web/src/work-areas/model.ts`, `renderWorkAreas()` | Area list, create/edit/delete, cell selection and validation | Map CRUD presentation into a game panel while keeping current commands and validation |
| Workers/Production | `#workers-panel`, `apps/web/src/workers/model.ts`, `renderWorkers()` | Actors, jobs, assignments, auto state, cargo and authoritative status | Use only real DTO fields; do not invent worker stats or production rewards |
| Tile/action dock | `#action-dock`, plant picker, crop/tree controls, `dock.ts` | Selection, move, plant, harvest, uproot, tree actions | Preserve selection and economic gating; give the dock the approved contextual frame |
| Placement/object panels | `#placement-hud`, `#object-panel`, object-editing and placement modules | Placement, construction selection and object editing | Use the same approved control language; no gameplay or placement changes |
| Offline return | `#return-popup`, `returnPopupShown`, reconciliation code in `main.ts` | Server-produced return summary, away duration presentation, zero-result state | Restyle the existing dialog only; never add fictional rewards |
| Boot/error state | `#status`, `#boot-retry`, `#render-3d-state`, `#render-3d` | Farm/session errors, retry, 3D readiness | Keep meaningful error and retry behavior visible in the new frame |
| Responsive interaction | breakpoint rules in `styles.css`, `panels.ts`, `dock.ts` | Desktop rail/panels, compact bottom navigation/drawers, safe areas | Preserve behavior while matching the approved viewport compositions |

Existing interaction logic is reusable. `panels.ts` owns module transitions, `dock.ts` owns action-dock presentation, and `main.ts` owns rendering and event wiring. These should not be replaced by artwork or duplicated in CSS prototypes.

## 2. Function-to-concept mapping

The table below is the implementation contract. The exact visual treatment is intentionally marked “from reference” until the approved image is supplied.

| Game function | Approved-concept region to map | Live source | Do not change |
| --- | --- | --- | --- |
| Wallet and progression | Top HUD resource cluster and progression badge | `/wallet`, `/progression`, `main.ts` state | Currency balances, level, XP and server authority |
| Farm navigation | Illustrated module rail or approved compact navigation | `panels.ts` and existing launchers | Panel IDs, open/close/toggle behavior |
| Inventory and Warehouse | Primary Inventory panel with visual slots and capacity strip | `/inventory`, `/warehouse`, `renderInventory`, `renderWarehouse` | Quantities, capacity, upgrade mutation and authoritative refresh |
| Market | Shop shelf/grid plus selected-item purchase/sell area | `/shop`, market render functions | Prices, ownership, quantity limits and settlement |
| Build/place | Catalog rail, illustrated thumbnails, inspector and placement action | build catalog and shared thumbnail renderer | Catalog, placement validation, object state |
| Work Areas | Management panel with list, editor, cell count and actions | work-area API and `work-areas/model.ts` | Farm authorization, cell rules, create/update/delete behavior |
| Workers and Auto | Worker cards, job/skill status, cargo and action controls | worker DTOs, `workers/model.ts`, auto endpoints | Server-reported status, cargo, jobs, funding and production |
| Tile actions | Contextual dock anchored to the selected world tile | `world-cell-actions.ts`, selection and `dock.ts` | Movement, crop/tree actions, action availability |
| Offline return | Return/reward dialog over the world | reconciliation result and `#return-popup` | Server-produced items, idempotency, zero-production state |
| Boot/recovery | Branded loading/error treatment that leaves the world visible when safe | boot/performance state and retry button | Retry semantics and honest error reporting |

## 3. Asset plan

### 3.1 Illustrated assets required

The following are required from the approved art direction or must be commissioned after the reference is signed off:

#### HUD frames and surfaces

- top HUD frame and corner treatment;
- wallet/resource counter frame;
- progression/level frame and progress treatment;
- module-rail background and active module treatment;
- contextual prompt and action-dock frame;
- panel frame, panel header, close treatment, and optional tab strip;
- modal/return-popup frame;
- optional nine-slice or tileable material variants for responsive resizing.

#### Buttons and control states

For every interactive family, request normal, hover, pressed, active/selected, disabled, loading, focus-visible, and destructive/warning states where the function needs them. Families include primary action, secondary action, compact icon button, tab, quantity stepper, close, retry, upgrade, buy, sell, plant, harvest, remove, and placement controls.

Artwork must not bake in dynamic text, prices, quantities, or player names.

#### Inventory slots and cards

- empty slot;
- normal slot;
- hover/focus slot;
- selected slot;
- disabled or insufficient-resource slot;
- locked slot;
- item illustration mask/background;
- quantity badge;
- optional rarity/quality treatment only if the actual game has that data;
- warehouse capacity strip and full/near-full states.

The slot art must work with the existing real thumbnail pipeline and honest fallbacks. It must not imply item rarity, ownership, or value that the server does not expose.

#### Resource and navigation icons

Required candidates are gold, level/XP, warehouse capacity, inventory, market, build, Work Areas, Workers, language, refresh, camera, recenter, close, search, plus/minus, move, plant, harvest, uproot, lock, and placement categories. Crop, seed, sapling, fish, forestry, mining, and aquaculture art should be requested only for identifiers that exist in the current catalogues.

The current inline SVG icon set in `apps/web/src/icons.ts` is functional utility art. It can remain as an accessibility-safe fallback during migration, but it is not assumed to satisfy the approved illustrated style.

#### Panel/background decoration

- panel interior material and edge treatment;
- header ornaments and section separators;
- optional illustrated category headers;
- overlay dimmer or world-readable scrim;
- loading and empty-state illustration only where a real state exists;
- mobile sheet handle/edge treatment if present in the approved mobile composition.

Decorative art must not occlude world interaction or make a disabled action look available.

### 3.2 Asset contract

Before implementation, create an asset manifest with stable semantic names, for example `ui.hud.top.frame`, `ui.inventory.slot.selected`, and `ui.nav.market.active`. Each entry must record:

- source file and license/ownership;
- format and color space;
- intrinsic pixel size and intended display size;
- 1x/2x/3x or vector policy;
- transparent padding and nine-slice/content insets;
- light/dark or state variants, if any;
- maximum file size and loading priority;
- fallback behavior when unavailable;
- whether it contains decorative art only or any approved static text.

The new UI art must remain separate from the existing Three.js world model pipeline. GLB world models and their thumbnail renderer are reusable sources for item presentation, but they are not substitutes for the approved HUD frame library.

## 4. Artwork versus interactive HTML/CSS

### Artwork owns

- illustrated frames, material textures, corner details and ornamental borders;
- custom resource and navigation illustrations;
- slot backgrounds, button surfaces, state chrome and decorative loading/empty art;
- any approved non-text character/item illustration supplied by the art handoff.

### HTML/CSS owns

- semantic structure and reading order;
- live labels, quantities, prices, progress values, player/farm names and error messages;
- focus, keyboard operation, hover, pressed, disabled and loading state behavior;
- responsive layout, scroll regions, safe-area padding, minimum touch targets and overflow;
- text contrast and reduced-motion behavior;
- positioning of UI over the world and pointer-event boundaries.

### Existing TypeScript/data ownership remains

- API calls, schema validation, authorization assumptions and server responses;
- inventory, Warehouse, wallet, progression, shop and production state;
- panel state, selection state, placement, camera and action dispatch;
- Three.js scene, terrain, models, collision and player movement;
- offline reconciliation and return-popup data.

The first implementation slice should alter classes/tokens and asset references around the existing DOM. It must not move game rules into CSS or make an image the source of truth for an interaction.

## 5. Layout plan

These are layout constraints to validate against the supplied reference, not a substitute for exact approved compositions.

### Desktop — 1440 × 900

- Keep the Three.js world as the dominant surface.
- Reserve a stable top HUD band and a single primary navigation anchor consistent with the reference.
- Allow one primary panel and its contextual action area to be open without hiding the selected world context.
- Keep panel content scrollable inside its frame rather than growing beyond the viewport.
- Keep selected-tile actions close to the lower world edge or the reference-defined anchor.
- Do not duplicate the same wallet, Warehouse, or action control in multiple visual locations.

### Tablet — 768 × 1024

- Use the reference-defined drawer/sheet composition; never rely on desktop widths scaled down.
- Show one major management panel at a time unless the reference explicitly demonstrates a split view.
- Keep the canvas visible behind or beside the panel and preserve a clear close/back path.
- Preserve touch targets and safe-area padding; no horizontal page overflow.
- Verify long item names, translated labels, quantity controls and work-area editors at this viewport.

### Mobile — 390 × 844

- Treat the supplied mobile reference as authoritative for navigation placement and panel height.
- Keep module navigation and action controls within the safe area; do not clip the bottom navigation or modal footer.
- Use a bounded bottom sheet or full-screen panel only where the approved design calls for it.
- Keep world controls and panel controls distinct so a touch cannot activate an occluded world object.
- Verify keyboard focus, scroll containment, close/retry access and no horizontal overflow at 390px.

The exact pixel measurements, anchors, z-order and crop/scale behavior must be annotated from the approved image before implementation begins.

## 6. Reuse versus create

### Reuse

- production DOM IDs and event handlers in `index.html` and `main.ts`;
- `panels.ts` module state machine and `dock.ts` responsive state decisions;
- existing `icons.ts` as a temporary or accessibility fallback;
- `items/card.ts` state model and shared thumbnail cache;
- `items/visuals.ts` mapping from real catalogues to real item visuals;
- `render/thumbnail.ts` and the existing GLB-based build/item thumbnails;
- current worker and Work Area pure models;
- current translation and API validation layers;
- Three.js world, camera, terrain, collision and player movement;
- current styles' safe-area, panel overflow and responsive behavior where it matches the approved layout.

### Create or commission

- all approved premium HUD/panel frame artwork;
- illustrated button and tab states;
- inventory slot and quantity-badge artwork;
- custom navigation/resource illustrations not covered by approved existing art;
- panel/material backgrounds and decorative separators;
- any 2D item illustrations required by the reference but not honestly represented by current GLB thumbnails;
- exact tablet/mobile layout assets and nine-slice insets, if needed.

Do not reuse rejected prototype screenshots, CSS themes, fictional card data, or generated art as production reference material.

## 7. Fictional UI and data audit

The concept image cannot be audited element-by-element until it is supplied. On intake, every visible element must be classified as `live`, `derived from live data`, `decorative`, or `not implemented`. The following are common risk areas and must not be added merely because they appear in a concept:

| Concept element | Current status until verified | Rule |
| --- | --- | --- |
| Wallet, Warehouse, inventory quantities | Live candidates | Bind only to validated API state |
| Level/XP/progression | Live candidate | Use current progression DTO; do not invent a second bar or stat |
| Crop, tree, fish, ore, seed or sapling icon | Live only when the matching catalogue/item exists | Use current visual mapping or label the art as pending |
| Worker status, cargo, jobs, auto state | Live only from worker/auto DTOs | No fabricated efficiency, stamina, route or reward numbers |
| Hearts, energy, quests, seasons, daily rewards, premium currency, badges | Unverified/not assumed | Remove or mark as concept-only unless a real contract exists |
| Population, happiness, reputation, decoration score | Unverified/not assumed | Do not display as gameplay data without an approved source |
| Timers and production rates | Live only if server-provided and currently exposed | Never calculate economy locally for display or mutation |
| Decorative item counts or reward callouts | Unsafe by default | Must not resemble live state or imply a grant |

No fictional value may be shipped as a placeholder in a live-looking HUD. If the approved reference contains an element that has no current game source, the design review must choose one of: remove it, make it unmistakably decorative, or separately approve a gameplay/data task.

## 8. Phased implementation plan

### Phase 0 — Reference intake and sign-off

Receive the approved artwork and layout annotations. Confirm formats, fonts, license, target density, exact viewport compositions, state coverage, and the list of live data fields. Resolve all fictional elements before coding.

### Phase 1 — Asset contract

Create the semantic asset manifest, review dimensions/insets, define loading priorities and fallbacks, and confirm that no art package contains secrets or unlicensed third-party content. Do not change game logic.

### Phase 2 — Shell-only visual layer

Apply approved tokens, frames, backgrounds and typography around the existing DOM. Keep current IDs and event listeners. Validate that the canvas, boot errors, retry, pointer events, and keyboard focus still work.

### Phase 3 — HUD and navigation

Replace top HUD and module-rail presentation, then verify all five panel transitions, camera controls, refresh, language, and responsive navigation without changing their state model.

### Phase 4 — Inventory and shop

Apply approved slot/card/market visuals to the shared item-card and thumbnail pipeline. Verify live quantities, prices, Warehouse capacity, locked/empty/selected states, upgrade, buy/sell, and no duplicate thumbnails or API calls.

### Phase 5 — Work Areas, Workers and world actions

Map the management, production, cargo, placement, selected-tile, plant, harvest and tree surfaces into the approved visual language. Preserve authoritative state, economic gating, selection behavior, and world visibility.

### Phase 6 — Return and recovery states

Apply the approved return-popup, loading, empty, disabled and error artwork. Keep actual server-produced offline results, meaningful failure messages, and retry behavior. No fabricated rewards or success states.

### Phase 7 — Responsive/accessibility pass

Validate desktop, tablet and mobile layouts, safe areas, scroll containment, focus order, touch targets, contrast, reduced motion and translated strings. Add only small CSS/DOM changes needed by the approved layout.

### Phase 8 — Screenshot-based visual QA

Capture actual rendered screenshots at 1440×900, 768×1024 and 390×844 using real game state. Compare with the approved references, inspect world occlusion and clipping, and record deviations. Compilation alone is not visual acceptance.

Deployment, migration, API changes, economy work and gameplay changes are outside this handoff and require separate approval.

## 9. Acceptance criteria for implementation readiness

- Approved HUD + Inventory artwork is available to the implementation team.
- Desktop/tablet/mobile reference compositions have exact dimensions and annotated anchors.
- Asset sources, licenses, formats, insets and state variants are recorded.
- Every live-looking concept value maps to a current validated data source.
- Existing DOM IDs, panel transitions, server-authoritative flows and Three.js world boundaries are preserved.
- No rejected prototype artifact is used as a visual reference.
- The implementation plan has a screenshot QA matrix and an explicit fallback for missing art.
- No production redesign is started before this gate is cleared.

## 10. Current change boundary

This handoff adds only this planning document. It does not modify production UI, gameplay, Three.js rendering, APIs, database migrations, economy, deployment configuration, or the intentionally dirty working tree.

**Next required input:** please provide the approved HUD + Inventory reference artwork (and any separate tablet/mobile layouts) before implementation begins.
