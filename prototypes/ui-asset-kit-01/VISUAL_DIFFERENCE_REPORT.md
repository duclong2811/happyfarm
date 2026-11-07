# UI Kit 01 Visual Difference Report

Comparison target: `docs/design/references/HAPPYFARM_APPROVED_HUD_INVENTORY_REFERENCE.png`.

Status: static comparison against the genuine 1040 × 823 staging scene. A final browser screenshot could not be captured because no browser target is exposed in this environment.

## Corrected preview changes

- The approved reference is copied to `assets/approved-reference.png`, so the comparison path is local and no longer points outside the Vite root.
- The concept image is not used as a gameplay background.
- Desktop Inventory is now a realistic 352 × 700 px panel on the supplied 1040 × 823 real-gameplay scene, matching the reference scale instead of a miniature showcase.
- Mobile Inventory is an independent 390 × 844 composition with a bounded sheet and two-column item grid.
- Frame and slot states use scalable CSS/SVG layers; live labels and quantities remain DOM text.
- Contaminated raster crops are removed from the visual panel and documented in `ASSET_AUDIT.md`.

## Known differences from the approved reference

| Area | Difference | Reason/next action |
| --- | --- | --- |
| World background | Genuine `01_world_hud.png` is now loaded at its native 1040 × 823 aspect ratio | Use it only as a scene reference; do not call it a 1440 × 900 capture |
| Title decoration | Current panel shows an `ART SLOT` placeholder rather than the barn ornament | Supply a clean standalone ornament with no baked title/tab pixels |
| Close button | Current panel shows a DOM `×` in an artwork slot | Supply a clean standalone close asset |
| Panel frame | Current frame is a scalable wood/parchment equivalent, not the final painted frame | Approve and deliver layered or genuine 9-slice source art |
| Inventory slots | Current normal/selected/disabled surfaces are clean preview SVGs derived from the reference language, not final painted slot exports | Replace with approved slot artwork and state variants |
| Apple icon | Current PNG is a contaminated preview derivative and is now marked REJECTED | Re-export a clean transparent Apple illustration |
| Typography | Current preview uses a licensed system-style fallback | Provide the approved font identity/license and calibrate wrapping |
| Mobile composition | No real mobile gameplay screenshot exists in the supplied reference set | Provide a real 390 × 844 gameplay capture before mobile approval |
| Real data | Preview uses fixture text `Apple`, `48`, and `48 / 100` | Replace only when integrated with authoritative Inventory/Warehouse state |

## Acceptance status

The preview is structurally ready for visual review, but it is not visually approved. Browser screenshots, a real mobile scene, and clean independent artwork are still required before any production UI integration.
