# Build Shop presentation experiments

These V1/V2 source atlases and extracted PNGs are archived design inputs, not runtime assets.
They were moved out of `apps/web/public/ui/happy-farm` during the visual rescue. No browser
code imports this directory. Their provenance has not been independently verified by this pass.

The runtime uses the existing SVG icon set and `apps/web/src/build-shop/shop.css`. The raster
card skins included decorative side details which nine-slice scaling repeated around the content.
Separately, a green/tan CSS stage behind a square, opaque cream thumbnail exposed colored bands
along the sides when fitted into a rectangular container. Both presentation layers were removed.

The shared on-demand thumbnail renderer, real models, road geometry, image cache and existing
working-tree framing adjustments are retained. Cards use square stages matching the renderer's
cream background; detail previews contain the same image without a baked UI frame.

The three-column shop has one integrated timber header, a compact category rail, quiet cards and
a detail panel whose price/state/PLACE footer sits outside the scrolling metadata. Locked items
remain inspectable and retain their artwork. Search/filter labels remain visible and accessible.

Verification: 52 relevant tests passed; typecheck, lint and production client/Worker dry-run build
passed. Browser QA remains pending: the session exposed no browsers or native computer surfaces,
and both Edge and in-app browser creation returned "Browser is not available". No screenshot was
included alongside the pasted request. Roads, Buildings/Utility, selected/locked/unaffordable states
and desktop layout must still be inspected in the running game before visual approval.
