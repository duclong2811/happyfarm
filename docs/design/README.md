# HAPPYFARM_UI_V2_ARTKIT_01 — candidate art, not production-approved

This is **real component artwork** (not a mockup): 15 editable layered SVG sources and 15 transparent RGBA PNG renders, all independently authored. **No old Golden/parchment crops or text/price/quantity baked in.**

## Direction
Vibrant Cozy Farm 3D: coral lacquer rims, honey-gold buttons, dark cocoa contours, clean cream content, green jewelry accents. The source vector layers encode face, side depth, contact shadow, specular highlights and fixed ornaments. Each item is independently editable in Inkscape. This is *vector-authored 2.5D*, **not** a genuine Blender 3D render and not guaranteed to meet the concept standard until visually approved.

## Contents
- `source/*.svg`: editable source with named layers. Open in Inkscape.
- `export/*.png`: transparent individual sprites, no baked-in text/data.
- `manifest.json`: stable candidate IDs, source paths, capInsets in **source PNG pixels**, scale 2.
- `CONTACT_SHEET.png`: review the real exports together.
- `preview.html`: view unmodified PNGs, not a replacement for live game visual QA.
- `CODEX_CANDIDATE_REVIEW.md`: instructions for the next step.

## Safety/status
All assets have `status: candidate`. Phase 0 registry MUST NOT opt these into Construction until format, seams, licensing/provenance, state and visual QA are verified. `approved` requires human review. Do NOT merge into public game's runtime just because files render or tests pass.

## Intended nine-slice method
`capInsetsSourcePx` in manifest are first candidates, not settled values; verify actual seams. For best results, exclude shadow overflow from cap intervals, keep ornaments anchored in immutable corner segments, test 0.75–1.5 CSS scale on 1x/2x devices.

## Fonts, data and behaviors
Keep existing Baloo 2 / Nunito and DOM-rendered translations, amounts, category names and real GLB thumbnails. The SVG/PNG art has no UI text. Do not change actions or game-state ownership.

## License
New project-owned vector illustration. No external images, fonts or third-party asset packs incorporated. Do not distribute source if the user wants private IP; user may use commercially within HappyFarm.

## Validator-compatible manifest / QA
- `asset-manifest.v1.json` matches the `schemaVersion: 1` validator from prior handoff.
- Validation: `python validate_assets.py asset-manifest.v1.json --min-assets 15`. PASS covers alpha, file paths, basic inset bounds only.
- `NINESLICE_TEST.png` shows a programmatic cut-and-stretch experiment for shell at desktop/mobile sizes. It is NOT a live browser test; verify actual CSS before approval.
- **Card family is `decor`, not 9-slice**: fixed-ratio independent 360×480 art with internal image/text division. Changing aspect would distort internal division; use DOM wrappers and constrain rendered ratio, or split frame/content in a later version.
- **This is still candidate artwork**, not a guaranteed commercial-grade match to the concept. If its visual style remains too flat, reject early and use a proper art-design workflow.
