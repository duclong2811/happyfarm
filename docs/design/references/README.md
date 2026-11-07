# HappyFarm Premium Art Kit — V1 CANDIDATES

This package contains **first-party AI-generated artwork candidates** extracted as separate images from two new purpose-generated art atlases. It is **not** a final production art kit. The artwork was NOT copied from a competitor game screenshot or the approved flattened concept.

## What is here
- `source_atlas_a.png` / `source_atlas_b.png` are generated originals for provenance and recutting. They contain sample text/counters; DO NOT ship the atlases directly as interfaces.
- `assets/*.png` are transparent-background extracts of blank wood frame, title bar, category tabs, item slots, seed pouches, settings/fullscreen icons.
- `ASSET_CONTACT_SHEET.png` displays all candidates on a checkerboard for review.
- `manifest.json` includes provenance, size, alpha extrema and per-file SHA256.

## Known blockers / inspect before integration
- Automated alpha matting may have dark edge halos or clipped leaves. Inspect at 200–400% zoom and against both light and dark game backgrounds.
- Blank panel has hand-painted border and corner ornaments, but 9-slice scaling MUST be manually validated for 1440×900 and 390×844; do not stretch the full panel without checking.
- Source board is a composite (artboard) created specifically for this asset extraction: isolated PNGs are NOT originally layered PSD/SVG files.
- A reconstructed blank green button candidate is included; verify its lettering-removal region and alpha edges. Pressed/disabled art states remain required.
- All item counts, prices, captions, labels, and HUD values must be dynamic DOM content.
- Icon crops need review; missing/incorrect resource icons should retain current fallback and never be substituted incorrectly.

## Slice guide (candidate, requires visual QA)
- `inventory_panel_blank.png`: source 584x394; recommended slice **top=160, right=82, bottom=180, left=84** px. CSS candidate: `border-image-slice: 160 82 180 84 fill; border-image-width: 68px 68px 75px 68px;` Experiment on mobile carefully.
- `button_primary_blank.png`: dynamic text on separate DOM layer; source alpha matting and lettering-removal may show flaws at 2x.
- `slot_{normal,hover,selected,disabled}.png` each require consistent sizing in CSS.
- `QA_FRAME_DESKTOP.png` / `QA_FRAME_MOBILE.png` are **synthetic 9-slice sizing QA** on flat green; not a screenshot from HappyFarm.
- `preview.html` is optional local-file CSS smoke test and must never be deployed as the game UI.

## Suggested integration scope
**Codex first integrate only the selected blank Inventory frame and item icon candidates behind a visual flag**, preserve existing data bindings. Evaluate actual localhost screenshots; reject any poor alpha edges or softness. No backend/API/economy/migration changes, deployment, commit or push. Do not reset/stash/clean an intentionally dirty working tree.

## Design source
The user-approved `docs/design/references/HAPPYFARM_FINAL_STYLE.png` remains the visual **reference only** and is not included here as a production sprite.

**Rejected/discarded during initial QA:** two source atlas crops mislabeled as settings/fullscreen because they did not actually depict those controls. These files are intentionally NOT shipped.
