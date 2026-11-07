# HappyFarm Approved HUD + Inventory Artwork Intake

Status: planning only. No production UI, gameplay, economy, API, migration, or deployment changes are included.

Approved direction: Premium Stylized 3D Farming Adventure.

The rejected A/B/C prototypes and their screenshots are explicitly excluded.

## 1. Reference record

| Field | Result |
| --- | --- |
| File | `docs/design/references/HAPPYFARM_APPROVED_HUD_INVENTORY_REFERENCE.png` |
| Format | PNG, flattened raster reference |
| Intrinsic size | 1672 × 941 px |
| File size | 2,439,844 bytes |
| Composition | Desktop HUD + Inventory over an illustrated 3D farm scene |
| Source layers | Not included; individual asset dimensions cannot be recovered exactly from this flattened image |
| Mobile/tablet references | Not provided; responsive layouts remain a separate approval item |

The reference is an art-direction and composition reference, not a background image to place over HappyFarm. Dynamic text, quantities, prices, item ownership, and controls must remain HTML/DOM content bound to real state.

## 2. Visual specification extracted from the reference

### Overall language

- Premium, colorful, illustrated farming-game presentation over a readable isometric 3D world.
- Warm carved wood for primary frames, with rounded bevels, layered highlights, dark brown edges, and deep soft shadows.
- Cream/parchment content surfaces inside the Inventory panel, with rounded cards, warm inner shading, and restrained borders.
- Bright green for active/available state and progress; gold for value and rewards; red for notification badges; purple is used by the reference for a gem-like resource but is not a confirmed HappyFarm currency.
- High-contrast illustrated objects rather than generic line-only controls.
- Decorative leaves, flowers, barn/produce motifs, and small corner ornaments connect the HUD to the farm world.
- UI has a strong dark outline/shadow so labels remain readable over foliage and terrain.

### Typography

The reference uses a bold rounded display sans with dark outline/shadow for white labels and dark brown text on the light Inventory surface. The exact font cannot be identified reliably from the flattened PNG. The production handoff must provide the font name/license or approve a close licensed substitute.

Rules for implementation:

- Keep all live text as HTML so English/Vietnamese translations and accessibility remain possible.
- Use outlined/high-contrast treatment only for display labels where it matches the reference; do not bake text into frame artwork.
- Use tabular numerals for wallet, Warehouse, inventory and progression values.
- Ensure the selected font still fits the existing translated strings and narrow mobile widths.

### Working color tokens

These are visual starting points sampled/estimated from the reference, not final source-art color values. Calibrate them against supplied source layers before implementation.

| Role | Working token | Use |
| --- | --- | --- |
| Deep wood edge | `#4A2411` | Outer frame, outlines, strongest shadow |
| Warm wood | `#8A4C1E` | Panel and button body |
| Amber wood highlight | `#C47A2B` | Bevel/highlight and active trim |
| Cream parchment | `#FFF1CF` | Inventory surface and item cards |
| Dark parchment ink | `#3A1C0B` | Inventory labels and values |
| Active green | `#45C83B` | Active tabs, available actions, progress fill |
| Progress green | `#9BE52D` | Bright progress highlight |
| Gold | `#F3B52B` | Gold coin/value accents |
| Notification red | `#EF3E35` | Small status badges only when real state exists |
| Reference purple | `#9653E8` | Reference gem art; not approved as a game currency |
| World sea/sky blue | `#1E9FD1` | Reference world color, not a HUD data token |

## 3. Reference layout measurements

The measurements below are planning estimates from the flattened 1672 × 941 composition. They describe placement and scale, not reusable source-asset sizes.

| Region | Approximate reference bounds | Layout intent |
| --- | --- | --- |
| Player/brand block | x 24–454, y 18–166 | Prominent upper-left identity/progression group |
| Resource counters | x 683–1191, y 21–96 | Centered horizontal counter cluster |
| Utility icons | x 1393–1653, y 13–109 | Upper-right illustrated utility buttons |
| Module navigation | x 20–171, y 177–704 | Vertical stack of large illustrated buttons |
| Inventory frame | x 1088–1652, y 123–892 | Right-side dominant panel, approximately one third of canvas width |
| Inventory header | x 1090–1650, y 125–216 | Wood title bar with illustrated barn emblem and close button |
| Inventory tabs | x 1110–1634, y 220–302 | Four visible category tabs in the reference |
| Item grid | x 1110–1637, y 304–865 | Three-column card grid; two empty slots are shown |
| Bottom quest strip | x 20–734, y 787–916 | Large lower-left quest/reward strip; not part of first slice unless a real feature is approved |

The reference is desktop-only. Exact tablet and mobile anchors, panel heights, navigation behavior, and safe-area treatment require separate approved compositions; they must not be inferred by simply scaling this screenshot.

## 4. Asset inventory for the first slice

### 4.1 HUD artwork

| Asset family | Required reusable assets | State/format requirement | Production source/status |
| --- | --- | --- | --- |
| Top HUD frame | Left identity/progression frame; resource counter capsule; optional top-right utility button frame | Transparent PNG/WebP or vector source; nine-slice insets if resizable | Create from approved layered art; no source layer supplied |
| Brand/identity | HappyFarm wordmark treatment, farm/leaf ornament, optional approved avatar frame | Vector or transparent raster; no player-specific text baked in | Wordmark/ornament needs source approval; avatar is not a current data field |
| Gold counter | Illustrated coin icon and wood capsule/plus affordance | Icon separate from dynamic amount; plus only if an actual action exists | Gold exists; art must be created or supplied |
| Progression | Level badge, XP bar frame/fill treatment | Dynamic level/XP remains HTML/CSS | Level/XP exists; reference badge art needs source |
| Utility buttons | Map, mail, settings-style art shown in reference | Each requires a real current action before shipping | Reference features are not verified; do not implement from image alone |
| Navigation buttons | Work Areas, Inventory, Market, Build, Workers illustrated button/icon families | Normal, hover, active, pressed, disabled, focus-visible; transparent source | Create custom illustrations for actual five modules |
| Badge treatment | Small red circular badge and numberless dot variant | Use only for a real unread/pending state | No current notification source identified; do not add yet |
| Decorative frame details | Leaves, flowers, small corners, wood end caps, bevel highlights | Tileable or nine-slice where possible; separate from text | Create as reusable decoration, optimized for texture size |

### 4.2 Inventory artwork

| Asset family | Required reusable assets | State/format requirement | Production source/status |
| --- | --- | --- | --- |
| Inventory frame | Outer wood frame, parchment interior, header plank, barn emblem, close button | Nine-slice/edge-cap source preferred; transparent corners | Create from approved art; flattened PNG is not suitable as the panel itself |
| Category tabs | Active green tab, inactive cream/wood tabs, focus/pressed/disabled variants | Label separate from art; tab dimensions must support translated text | Create; map to actual categories, not necessarily the four shown |
| Item slots | Card background, inner highlight, border, quantity pill, selected outline, locked/empty states | Separate slot art from item image; CSS/DOM owns state and text | Create; integrate with existing `item-card` state model |
| Empty state | Empty slot background and neutral illustration | A plus symbol must not imply an action unless one exists | Create neutral empty state; reference plus is currently unverified |
| Item imagery | Illustrated produce, fish, materials, seeds, saplings where needed | Transparent PNG/WebP or approved vector; semantic item IDs; no fictional counts | Reuse real GLB thumbnails where acceptable; create 2D art for missing/fallback visuals |
| Warehouse strip | Capacity emblem, usage bar, full/over-capacity treatment, upgrade action styling | Values and status remain live; preserve current warning copy | Create matching surface art; data already comes from `/warehouse` |
| Inventory header icon | Barn/warehouse illustration | Separate from title text | Create or supply; current DOM has text-only header |

### 4.3 Asset size and delivery requirements

The flattened reference does not contain source dimensions for individual assets. Before coding, request:

- vector/SVG for icons and simple frame geometry where possible;
- transparent PNG or WebP for painted illustrations and texture details;
- 1x/2x export policy and maximum displayed size for every raster;
- nine-slice/content insets for all resizable frames;
- explicit transparent padding and intended visual bounds;
- font files or licensed web-font identifiers;
- source color profile and export settings;
- license/ownership for all commissioned or generated artwork.

The reference PNG itself should remain a QA reference only. It should not be shipped as a full-screen UI layer.

## 5. Comparison with current HappyFarm components

### HUD

Current production HUD in `apps/web/index.html` has a compact brand, gold wallet, progression, language, refresh, camera-mode and recenter controls. `styles.css` currently uses translucent dark forest capsules, Inter/ui-rounded/system fonts, inline SVG utility icons, and a world-first layout.

The approved direction calls for larger illustrated wood-framed groups and a much stronger game identity. The first slice can restyle the existing `#top-hud`, `#wallet`, `#progression`, `#language`, `#refresh`, `#camera-mode`, and `#camera-recenter` surfaces without adding unsupported map, mail, gems, quests, locations, or notifications.

### Navigation

Current `#module-rail` has five working launchers for Inventory, Market, Build, Work Areas, and Workers. `apps/web/src/panels.ts` owns their state transitions and `apps/web/src/icons.ts` supplies 24-unit inline SVG line icons.

The reference uses large illustrated vertical buttons with custom object art and leaf decoration. Replace only presentation and icon assets in a later implementation slice; preserve launcher IDs, `aria-expanded`, keyboard behavior, and the one-panel interaction model.

### Inventory and Warehouse

Current `#inventory-panel` contains:

- `#inventory-title` and `#inventory-close`;
- the `#warehouse` strip with tier, used/capacity, capacity bar, warnings, next tier and upgrade;
- dynamic category tabs in `#inventory-tabs`;
- visual cards in `#inventory-grid`;
- `#inventory-empty`.

`renderInventory()` and `renderWarehouse()` in `apps/web/src/main.ts` bind the surface to server-validated state. `apps/web/src/items/card.ts` owns normal, selected, empty, and locked card states. `items/visuals.ts` maps real catalogue items to GLB thumbnails or honest fallbacks, and `items/thumbnails.ts`/`render/thumbnail.ts` provide the shared cached image pipeline.

The reference is compatible with a card-grid inventory, but its four visible categories must not replace HappyFarm's real category set. Current categories include All, Produce, Fish, Materials, Seeds, and Saplings; only categories containing real data should render.

### Data and economy boundary

No visual asset may become a source of truth for gold, inventory quantity, Warehouse capacity, prices, progression, production, or rewards. API validation and server-authoritative mutation paths remain unchanged. The HUD/Inventory slice is presentation-only.

## 6. Fictional or unverified reference elements

The reference includes sample content that must not be copied into production as live data:

| Reference element | HappyFarm status | First-slice decision |
| --- | --- | --- |
| `Happy Farm` title | A production brand exists, but the exact display treatment is an art decision | Use live brand text; do not bake the title into a bitmap until approved |
| Player portrait and player name | No matching production HUD data field was identified | Exclude or use only an approved non-player decorative emblem |
| Level 6 and `344/1176` | Progression/level exists, but the shown values are illustrative | Bind to current progression DTO only |
| `2.000` gold | Gold wallet exists; the number is illustrative | Bind to `/wallet`; do not use the sample value |
| Purple gem `150` | No confirmed matching currency in the current client contract/catalogue | Exclude from first slice |
| Backpack `48/100` | Could resemble Warehouse used/capacity, but the reference icon/semantics are not authoritative | Use the existing Warehouse values and label; do not introduce a second capacity system |
| `Quảng Trị` location chip | No verified location feature in the current UI contract | Exclude |
| Map, mail and settings badges | Current controls are language, refresh, camera and recenter; no unread-state source was identified | Do not add buttons/badges |
| Daily quest panel and reward `500` | No verified daily-quest API/state in the audited client | Exclude from HUD + Inventory slice |
| Reference item quantities | Illustrative sample values | Use only server inventory quantities |
| Empty-slot plus buttons | Current inventory cards are read-only; no add-slot mutation exists | Use a neutral empty state unless a real action is separately approved |

## 7. First implementation slice: HUD + Inventory

This is the implementation plan, not permission to edit production code yet.

### Slice A — live HUD shell

1. Add the approved frame/icon asset manifest and source files after artwork delivery.
2. Restyle the existing top HUD around the current DOM IDs.
3. Replace line-only decorative icons with approved illustrations for gold, progression, and the five existing module launchers.
4. Keep language, refresh, camera mode, and recenter as the actual controls; visually map them only where the reference has a valid equivalent.
5. Do not add the reference's gem, map, mail, settings, location, quest, notification, or player-portrait features without a separate data/feature approval.

### Slice B — inventory frame and live data

1. Apply the wood header, barn/warehouse emblem, close treatment, parchment content surface, and card grid around `#inventory-panel`.
2. Keep `#warehouse` as the authoritative capacity strip, visually restyled to match the reference.
3. Use the current dynamic category list and translated labels; do not hard-code the reference's four tabs.
4. Apply approved slot states to `item-card` without changing `ItemCardState`, item quantity handling, or action semantics.
5. Keep real GLB thumbnails and honest fallbacks. Commission 2D item art only for items whose current visual fallback is not acceptable after review.
6. Preserve empty, locked, selected, full, over-capacity, upgrade-pending, and error states.

### Slice C — responsive behavior and QA

1. Obtain separate approved tablet/mobile layouts before setting final breakpoints or panel proportions.
2. Preserve current safe-area handling, bounded scrolling, keyboard focus, and 44px touch targets.
3. Test 1440 × 900, 768 × 1024, and 390 × 844 with real API state, both empty and populated inventory states.
4. Confirm that the world remains visible, the Inventory panel does not clip, and the HUD never intercepts world input outside its actual controls.

## 8. Implementation file mapping

| Concern | Existing file(s) | Planned first-slice responsibility |
| --- | --- | --- |
| DOM structure and stable hooks | `apps/web/index.html` | Keep IDs/ARIA and add only minimal presentational hooks if required by approved assets |
| HUD/inventory styling | `apps/web/src/styles.css` | Add approved tokens, frame layers, slot states, responsive rules, and focus styling |
| HUD and inventory render | `apps/web/src/main.ts` | Keep live rendering and event wiring; no data-flow or mutation redesign |
| Module state | `apps/web/src/panels.ts` | No change; launcher behavior remains the same |
| Utility icons | `apps/web/src/icons.ts` | Retain functional fallback; add a separate approved illustrated asset registry rather than replacing logic |
| Item card state | `apps/web/src/items/card.ts` | Reuse existing state/accessibility model; add visual hooks only if needed |
| Item visual mapping | `apps/web/src/items/visuals.ts` | No change to semantic mapping; add assets only for real item IDs |
| Thumbnail cache/renderer | `apps/web/src/items/thumbnails.ts`, `apps/web/src/render/thumbnail.ts` | Reuse; do not create a second image/GLB pipeline |
| Authoritative data | `apps/web/src/api.ts`, `apps/web/src/farm-refresh.ts` | No changes in this visual slice |
| Existing regression coverage | `tests/web/mobile-hud.test.ts`, item/thumbnail tests, relevant client tests | Extend only after implementation; cover behavior and responsive non-clipping |

## 9. Visual acceptance criteria

### Asset fidelity

- Wood frames have independent reusable layers; the reference PNG is not used as one background.
- Illustrated icons read at their intended display size and have normal/active/disabled/focus states where applicable.
- Inventory slots share one visual system while selected, empty, locked, and unavailable states remain distinguishable.
- Text, counts, prices, and progress are live HTML and remain translatable.
- Artwork has documented license, dimensions, insets, density variants, and file size.

### Gameplay/data fidelity

- HUD gold and progression show actual server/API state.
- Warehouse used/capacity, tier, warnings, upgrade cost and pending state remain authoritative.
- Inventory categories and quantities match current real data.
- No gem balance, quest progress, location, mail/map notification, player identity, or reward is fabricated.
- No production, Warehouse, inventory, economy, authentication, or Three.js behavior changes occur in the visual slice.

### Layout and accessibility

- Desktop composition preserves the reference's strong left navigation/right Inventory hierarchy without hiding the playable world unnecessarily.
- Tablet and mobile layouts are based on separately approved compositions, not desktop image scaling.
- 1440 × 900, 768 × 1024, and 390 × 844 screenshots show no clipping or horizontal overflow.
- Panel scroll stays inside the panel; close/retry/focus paths remain usable.
- Touch targets remain at least the existing 44px target.
- Focus-visible, disabled, loading, and reduced-motion behavior remain clear.

## 10. Missing artwork and required next handoff

The reference establishes the look but does not provide production-ready layers. Before the first code change, obtain:

- layered or separately exported wood frames and parchment surfaces;
- all HUD/resource/navigation illustrations as independent assets;
- Inventory header, tab, slot, quantity-badge, empty, selected, locked, and disabled states;
- exact font files or licensed font identity;
- source colors and nine-slice/content insets;
- desktop pixel annotations and separate tablet/mobile compositions;
- confirmation of which decorative icons may be used without implementing their fictional features;
- approved 2D art or acceptance of current GLB thumbnails/fallbacks for every real item family.

Until those inputs arrive, stop after planning. No production UI implementation is authorized by this intake document.
