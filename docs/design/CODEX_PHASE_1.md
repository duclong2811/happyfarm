# CODEX PHASE 1 — First Real UI Art Slice (once approved sprites exist)

**Preconditions:** independently authored, editable source artwork present; a populated real manifest; `validate_assets.py` passes. Inspect the actual artwork visually (not only alpha/metadata).

1. Choose **Construction** as the sole pilot screen, because current reference screenshots show its category rail, product cards, details and action controls. Do not touch gameplay or Market/Inventory visuals yet.
2. Implement one complete V2 family: panel shell + title/header + primary/secondary states + item/build card states. No mixed old parchment V1 shell.
3. Dynamic content remains existing TypeScript/DOM: prices, item identity, thumbnails, labels, localization, availability, build costs and actions. No baked-in text or numbers.
4. Respect separate nine-slice capInsets in source pixels; preserve corners/ornaments and intended 2x scale. Verify seams and alpha artifacts at real rendered size.
5. Build a single source-of-truth registry and component/semantic CSS mapping; no new cascaded `styles.css` patch pile or duplicated selector overrides.
6. Responsive compositions: 1440x900 and 390x844; ensure panel scroll zones, readable inspector, 44 CSS px touch targets, world visibility and no overlap.
7. Run functional tests, typecheck, lint, build. Capture actual same-state before/after screenshots; if browser capture unavailable, request user captures before claiming success.
8. Only after user explicitly visually approves Construction, expand the component family across Market, Inventory, HUD, Workers and other panels.

Strict: no economy, backend, API, migration, state ownership or Three.js world changes. No deploy, commit, push, reset, stash or clean.

Final verdict: `V2_CONSTRUCTION_AWAITING_VISUAL_APPROVAL`, `V2_ART_NEEDS_REVISION`, or `BLOCKED`.
