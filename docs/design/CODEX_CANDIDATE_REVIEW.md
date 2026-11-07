# CODEX — V2 ARTKIT 01 CANDIDATE VALIDATION (NOT PRODUCTION OPT-IN)

Reference directory (after extracting under `docs/design/`):
`docs/design/HAPPYFARM_UI_V2_ARTKIT_01/`

1. Validate `asset-manifest.v1.json` using `python validate_assets.py asset-manifest.v1.json --min-assets 15`. Verify manifest and independently inspect source/export PNG files. Do not use the contact sheet as a sprite.
2. Inspect the actual `apps/web/src/ui/art-v2.ts` registry built in Phase 0. Adapt manifest IDs to the registry **without changing gameplay**.
3. Add format and manifest validation, including alpha, dimensions, source file presence, insets safe bounds, DOM-only text, and uniqueness. Record detailed ownership and license.
4. Build **a non-production visual QA harness** that renders the real PNG candidates (not placeholder CSS), at realistic `Build` dimensions and 390×844; test true nine-slice stretch and button/card states. The harness may be an isolated static page. Do not opt in V2 on the live Construction screen until user approval.
5. If browser capture is available, screenshot the harness and compare to the original approved design. Else ask user to open the harness and send screenshot. Do not claim approved on unit tests.
6. If candidate source looks too flat, distorted, or pale, give exact sprite IDs and deficiencies; stop instead of fake-successfully changing V1.
7. No deploy, commit, push, reset, stash, clean or gameplay/API/economy/DB changes. Respect the dirty working tree.

Once visually approved, integrate Construction via Phase 1 (`CODEX_PHASE_1.md` in the previous handoff). Static-import files through Vite; never raw filesystem runtime paths. Update registry to `approved` only for independently reviewed, complete material family, not arbitrary individual elements. Do not opt in outside Construction.
