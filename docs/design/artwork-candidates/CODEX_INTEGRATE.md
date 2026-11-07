# Task for Codex — integrate candidate illustrated artwork into HappyFarm

User-approved style image: `docs/design/references/HAPPYFARM_FINAL_STYLE.png` (reference ONLY).
New candidate PNG kit lives at `docs/design/artwork-candidates/HAPPYFARM_PREMIUM_ART_KIT_V1/assets/` after extraction.

## Goal
Implement a small, reversible visual trial **inside the real Inventory** with the new blank panel frame, title bar, item slot candidates and carrot/corn seed icons. Do not copy any sample text/numbers from either generated atlas.

## Steps
1. Inspect dirty working tree, current UI component refs, CSS art source and existing inventories; do not reset/stash/clean.
2. Review `ASSET_CONTACT_SHEET.png`, `manifest.json`, `README.md`, both generated art atlases and `QA_FRAME_MOBILE.png`. The atlas is NOT a valid production sprite sheet by itself.
3. Manually inspect each candidate PNG on light/dark backgrounds at 1x and 2x, especially edges/halos and whether labels were actually removed. Reject poor candidates explicitly.
4. Preserve existing current style behind a **local non-production-only feature flag**, or make a clean reversible presentation-only change. Do not create another standalone prototype as deliverable.
5. Use the new blank `inventory_panel_blank.png` with 9-slice, adjusting source slicing to avoid stretching leaf corners (candidate source top 160/right 82/bottom 180/left 84). DO NOT stretch entire image as background. Avoid distorted texture.
6. Integrate blank wooden header and blank button. Keep title, upgrade labels, amounts, costs, category text and item quantities in existing DOM/state; no baked text.
7. For carrot and corn, map only if they correctly match current stable catalog IDs; use existing fallback for all other items. Never change server data.
8. Verify Inventory open/close, scrolling, tab/category behavior, capacity updates, empty/long item names, disabled state, language selection, touch and keyboard.
9. No changes to Shop or Work Areas in this initial approval trial. No backend, D1, auth, economy, Cloudflare deploy, commit or push.
10. Run focused tests, typecheck, lint, build, git diff --check. Capture REAL localhost screenshot at 1440x900 and 390x844 manually if automation unavailable; do NOT count the included QA mock images as real game screenshots.

## Stop conditions
- Missing or malformed source art: reject, don't fill with cropped approved concept.
- Alpha halo, art edge clipping, poor 9-slice at mobile portrait, font contrast, or quality clearly below reference: report `CANDIDATE_ART_REQUIRES_MANUAL_RETOUCH`.
- User has not approved live screenshot: do not expand to HUD/Shop/Work Areas.

## Final verdict
`ARTWORK_CANDIDATE_INTEGRATED_LOCALLY_PENDING_VISUAL_QA`, `CANDIDATE_ART_REQUIRES_MANUAL_RETOUCH` or `BLOCKED`.
