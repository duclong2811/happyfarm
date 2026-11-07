# HAPPYFARM — Visually faithful UI integration handoff

## Scope
These are **visual references, NOT sprite sheets or licensed drop-in UI assets**. The HappyFarm world scene remains intact for now. The approved target UI is the playful, dimensional, saturated **Farming Adventure** style shown in the two image files. Do not copy fictional/invented features, resources, amounts, levels or buttons into the game. Use only actual supported app actions and authoritative values.

- `HAPPYFARM_PLANTING_HUD_TARGET.png` — primary reference for HUD, left navigation and selected-tile planting toolbar. **This is the immediate task.**
- `HAPPYFARM_INVENTORY_TARGET.png` — matching visual language for Inventory (not necessarily exact dimensions); the existing Inventory functionality remains unchanged.
- `LATEST_LOCALHOST_BEFORE.png` — baseline screenshot of the real game before this handoff; browser/VS Code chrome is not part of the game.

## WHAT makes the target visibly different from current localhost
1. HUD: legible dimensional resource modules with coherent amber-to-caramel edges, small pictorial assets, strong controlled highlights/shadows, large contrastful text. Existing currencies and levels only.
2. Left navigation: bold carved/beveled **illustrated** icon buttons (not thin outline glyphs in flat cream squares), consistent frame and active treatment, never invent actions.
3. Planting toolbar: substantial but compact 2.5D rounded border, ivory interior and amber/gold edge with physically plausible highlight/shadow; crop tiles larger, visually elevated, item illustrations strongly prioritized. Keep the actual action order/quantity/disabled behavior and virtualized/horizontal scroll as applicable.
4. Repeated material system: golden edge, warm cream insets, controlled green accent, leaf/flower ornaments placed *outside* scalable edges, expressive Baloo 2 headings and crisp Nunito labels. No woodgrain-photo/low-poly fake-wood CSS effect.
5. Screen readability: no tiny white type on cream/yellow; maintain contrast at actual rendered sizes. UI should no longer feel like bordered cards and inputs from a dashboard.

## Actual app integration task — specific and bounded
Local repo `C:\Project\HappyFarm` has the *current working tree*. The public GitHub repo is stale and MUST NOT be substituted for the local state. Inspect `apps/web/src/styles.css`, `apps/web/src/main.ts`, `apps/web/src/ui/components.ts`, actual UI asset folders and item artwork/rendering before changing anything. Keep all existing gameplay handlers, authoritative selectors, 3D GLB thumbnails, asset licenses, localization and keyboard/touch events.

### 0. Reference intake
- Place these image files in `docs/design/references` and check real image dimensions.
- Compare baseline screenshot to target while designing.
- The reference is only a visual quality target; DO NOT slice it up for production (it contains baked text and UI state). DO NOT use it as a fullscreen UI overlay with hotspots.

### 1. Priority: real planting toolbar
- Make the selected-tile bottom toolbar the FIRST tangible slice to visually improve, using the same existing DOM, scroll, handlers and crop inventory.
- Implement a coherent 2.5D art frame: separately authored independently scalable corner/edge pieces, or a verified 9-slice from an **actual clean** art source. Do not stretch flowers or leaf ornaments.
- Use independently authored material/icon assets with real transparency and depth (rendered from Blender/Three.js or layered raster) where available. Avoid claiming simple flat SVG rectangles/gradients match painted 3D art.
- Use existing crop GLB thumbnails when visually appropriate, but avoid mapping carrot to corn or any other incorrect art; preserve real item amounts.
- Match practical 1440×900 proportions: bottom-centered toolbar roughly 720–920 CSS pixels wide if layout allows, height driven by content rather than copied pixels, visually obvious item artwork, title and CTA legible. Do not cover game-critical UI or controls.

### 2. Then HUD + left navigation
- Apply the SAME illustration family and depth cues. Replace flat icon-frame appearances only where clean authored artwork exists. Keep existing current actions and routes.
- Real-time resource displays and level values use real state. No invented plus buttons, character level badge or quests if not actually supported.
- Preserve existing selected/camera modes; show active, hover, disabled, focus-visible states.

### 3. Keep other UI coherent
- Inventory/Welcome Back use material/color tokens, not a wholesale redesign. Do not replace functional states/data flows. Popup/modal layers must not collide with the planting bar.

### 4. Responsive
- Desktop review 1440×900. Mobile 390×844 with a deliberately compact toolbar and independently usable crop scroll, world/touch controls not obscured, 44×44 CSS px interactive targets, safe areas, no horizontal page overflow. Do not just shrink the reference image.

## Strict acceptance rules
- Must provide a **real localhost screenshot** of the actual game with selected tile and toolbar visible and a screenshot without a panel; show 1440×900 and 390×844. If browser automation unavailable, request user's manual screenshots; no invented visual QA PASS.
- Contrast: text on cream/gold dark brown; light/ivory type only over sufficiently dark green/caramel. Confirm actual backgrounds, not just CSS tokens.
- Any new illustration is independent, no gameplay labels/numbers baked in; all external assets documented in license manifest; avoid oversized PNG and verify image load/perf on mobile.
- Unit/focused interaction tests, typecheck, lint, build, git diff --check. Preserve game economy, backend, API, authentication, Cloudflare D1, migrations, resource actions, server authority and offline popup semantics.
- No deploy, commit, push, reset, stash, clean. The working tree has intentional uncommitted changes.

## Stop condition: quality, not code
If clean, dimensional, independent artwork is not available, **do not fake “premium” using gradients or reuse incompatible existing PNGs and claim success**. Report precisely which named sprites need artwork; implement only safe styling improvements and leave logical behavior untouched. Successful tests are not a proxy for visual fidelity.

### Codex closing format
1. UI elements actually changed in the live game
2. New clean art source files, and license/provenance
3. Exact before/after screenshot files or request for manual captures
4. Desktop/mobile layout status and input interactions
5. Tests and risks
6. Verdict: `VISUAL_SLICE_READY_FOR_REVIEW` / `MISSING_QUALITY_ARTWORK` / `BLOCKED`
