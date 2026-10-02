# V13: the road contract and Road V2

Status: the road's geometry contract, and what V13 did - and did not - change about how roads look.

## The footprint bug, and the fix

V12.5 sold a road as `1 x 4 cells` while the renderer painted a ribbon 1.75 cells wide: a collision
rule that did not cover the thing it was protecting. V13 gives the road **one** width definition,
`ROAD_WIDTH_CELLS` in `packages/game-data/src/roads/index.ts`, and derives both sides from it:

* the renderer (`apps/web/src/render/world-config.ts` re-exports the same table) draws
  `SECONDARY 1.75`, `PRIMARY 2.9`, `PATH 1.1` cells wide;
* the catalogue's footprint is `ceil(width)` cells wide - two for a dirt or gravel segment, three for
  stone or paved - and always four cells long.

The logical area therefore *contains* the drawn ribbon, which is the only safe direction: no ground
under the paint is left unclaimed. A test pins both halves together
(`tests/game-data/placement-gameplay.test.ts`).

The committed starter road is still dirt, harbour to village - it is the same road, but V13.1
re-surveyed its alignment. See "V13.1: the alignment is surveyed, not grown" below.

## V13.1: the alignment is surveyed, not grown

V12.3 authored the starter road as eight waypoints and drew them through a Catmull-Rom spline. The
shape that came out was not the shape that was written down: a spline is C1 across every waypoint, so
it starts turning a whole segment *before* a corner and finishes a segment after it, and the one real
bend - 39 degrees at the harbour yard, because the quay faces south-east and the village is north -
was spread over the eleven metres of the first two legs. From the estate camera that read as a hook
that started at the quay, and the shuffle of points from x 49.2 down to 45 existed only to give the
spline something to do.

`roads.ts` now builds an **alignment** instead: the authored segment between two waypoints is drawn
as the straight line it is, and only an interior waypoint - a corner - is rounded, with a circular
fillet tangent to both legs whose radius is three times the road's own width. The fillet's tangent
length is capped just under half of the shorter leg, so a hairpin in a short lane cannot eat the
segment. A ring (`village_street`) is detected by its repeated last waypoint and its seam is
filleted like every other corner; it used to be the one corner that stayed sharp, at the one place
the author's eye never went.

The starter road is now **three** waypoints: the quay, the corner at the harbour yard, and the
village entrance. Its last sample sits about a metre *inside* the paved rim of the square rather than
at the square's centre - dirt that stops at the paving edge leaves a sliver of grass at the corners
of its own end cap, and dirt that reaches under the paving meets it with no seam - so the square
stays paved and one entrance reads from the estate camera. `farm_road` and `north_road` likewise
leave from the square's rim instead of drawing a lane and a footpath across the paving.

The other V13.0 defect this pass fixed is not about roads at all: `buildLandmarks` drew every
landmark at the flat ground plane, which is correct on the field, the square and the quay - all held
level - and wrong on the rolling ground, where the windmill stands two metres up a slope and was
drawn with its base and the bottom of its tower inside the hill.

## What the road looks like today (V12.4's work, kept)

* nine columns across the ribbon carrying a crown, two shallow wheel ruts, compacted dirt and dusty
  edges - vertex colours, no texture, no extra draw call;
* a deterministic edge wave of at most five per cent of the half-width, on the outermost column only,
  so the navigation width never moves;
* a shoulder of worn grass that is always darker than the field, which is what stops the road reading
  as a brown ribbon with an outline;
* `ROAD_LIFT_WORLD = 0.03` with polygon-offset materials, so the road sits *in* the terrain instead of
  on it;
* bed heights ordered by importance, so a footpath can no longer win the overlap at the village gate.

## Road V2, honestly scoped

Roads are **PREVIEW_ONLY** in V13. The tiers, their prices and their planned movement multipliers are
authoritative data, the shop describes them, and the placement preview draws a four-cell segment from
the runtime centreline - but the server does not yet store a road segment, so nothing pretends a road
has been built. `place_road_*` entries are refused with `CONSTRUCTION_NOT_ALLOWED`.

The upgrade ladder (`dirt -> gravel -> stone -> paved`) is already expressed as data (`upgradeTo` on
each tier and each catalogue entry), so a later pass can upgrade a road in place without redesigning
the catalogue.

## Road V2's remaining work

* store road segments as construction rows with a direction, and let a tier upgrade replace one;
* apply the movement multiplier to the walker;
* junction geometry between two player-built segments, beyond the authored junctions the island has.
