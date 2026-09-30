# 0024 - V9: world composition rebuild

Status: accepted (V9, on top of `10c81e8`)

## Context

V6 to V8.1 rebuilt the island district by district and never changed its *composition*: the reserve
stayed a 36-tile square in the middle, every other function was packed into the ring around it, and
the agricultural heartland was drawn as a handful of test rectangles and a field of bare-earth ovals.
From the estate camera the result was a green plate with a small farm on it.

V9 is the pass that changes the composition itself, and it found three defects that were not style
choices:

1. **The ring was too narrow.** At 89 tiles across, the island left about seventeen tiles between the
   reserve and the shoreline. Three districts were sharing it, so the orchard, the pasture, and the
   managed wood all ran into the coast and had most of their trees and rows rejected as sea.
2. **The camera could not look at a district.** The island framing engaged as soon as the zoom passed
   the follow distance, so zooming out anywhere other than the field centred the camera on the island
   and a player standing in the orchard could never see it. Worse, the camera looked at *sea level*:
   on a hill eleven metres high, the orchard was above the top of the frame.
3. **The ground was painted, not built.** District tints and per-plot ovals were read as debug
   overlays from above, and the terrain's own vertex colours blended to sand by *height*, which
   turned every hill into a dune.

## Decisions

### The island is 105 tiles across, and the ring is twenty-four tiles

`VISUAL_BOUNDS` is `[-34, 70]^2`. The reserve, the fence, the starter land, the plot catalogue, and
the tile grid are untouched: the island grew around them. The three western and northern districts
were re-planned inside the new ring, with each centre at 50-65 per cent of the way to the shore so its
own radius still lands on land.

### Every district has a middle, and they are 24 tiles apart

`DISTRICTS` was re-laid: two natural forest masses (north and north-east), the orchard on the
north-western shoulder, the pasture west, the managed wood south-west with a logging yard, the lake
and its wetland in the southern basin, the town on the eastern flank, the bay and its harbour in the
south-east, and the wilderness between the lake and the coast.

### Roads are a ring, and their clearance is a distance

The primary road is one ring around the agricultural heartland connecting the harbour, the town, the
wood's edge, the orchard, the pasture, the managed wood, the meadow, the field's own south gate, and
the spawn. Secondary roads branch to the orchard, the pasture, the lake, both woods, the logging yard,
and the field's east and west gates. Widths are 2.6 / 1.5 / 0.9 tiles.

`PlacementWorld.roadTiles` (a tile set plus a Chebyshev neighbourhood) became
`PlacementWorld.roads` (centreline samples plus each road's own half-width), so "on a road" is a
distance to the road rather than a tile lookup that has to round a path and a primary to the same
grid. The previous pair of clearances cleared roughly seven tiles each side of every road, which is
what had been deleting the managed wood's rows.

### The reserve is drawn as fields, and nothing grows on them

Eight parcels of three sizes and two ploughing directions, each with a grass headland and instanced
furrow ridges; the fallow parcels and the machine yard have no ploughing, which is what makes them
read as *not being worked this season*. The per-plot bare-earth ovals and the wild scrub that used to
cover the reserve are gone; the remaining wild growth is now placed on the plot margins - the
headland - and never on a parcel.

### Orchards and managed woods are lattices with beds

A district may declare `rowSpacingTiles`, `rowBedWidthTiles`, and (in the renderer) a column spacing:
the orchard is four tiles between rows and about three along them, the managed wood tighter and
mixed. The beds under the rows follow the terrain as ribbons rather than lying as flat slabs, and
they are mown lanes in the orchard and bare earth in the working stand.

### The harbour is geometry, and the fish farm is a farm

`HARBOUR` gives the quay a root on the beach, a bearing, and a length; `terrain.ts` builds the deck,
the piles, the head, the ramp, a boat, and the yard from it, so the pier always crosses the waterline
wherever the coastline is. The cages are six frames in two rows of three, placed from the island
outline at distances that put them in water by construction.

### No district paints its ground

`addDistrictGround` is deleted. `District.ground` remains (the crop district's test pins it) and every
district is `NONE`; identity comes from rows, beds, paths, buildings, trees, and water. This is the
second time the project has reached that conclusion and the reason it is written down here.

### The camera follows the character until the island itself is in frame

`cameraFrameExtent` now takes the zoom: the follow distance is the *near end* of one range and gives
way to the world's own frame as the camera pulls back. `scene.ts` centres on the island only once
`followExtent * zoom >= worldExtent`, so a district can be walked to and looked at. The camera also
looks at the *ground* at the point it frames (`terrainHeightAt`), not at sea level. `zoomRangeFor`
keeps an 18 per cent margin over the exact ratio so the coast and the pier stay inside the frame.

### The planting grid

`setInteraction("PLANT" | "NONE")` on the scene draws one instanced outline per tile the *server*
reported plantable, aligned to the same placement the tile slabs use. `main.ts` sets it from the same
`selection.canPlant` the dock's planting control uses. It names no tile, sends nothing, and is off
whenever the planting control is.

### Scenery has per-section budgets

One global budget spent in list order meant the first districts took every placement. Each section -
each wood, the orchard, the managed wood, the district scatter, the wilderness, the shore, the
hedgerow - now has its own allowance, and the scatter has a per-district quota rather than a share of
one pool.

## Consequences

* `WORLD_CONFIG_VERSION` is 5.
* The island is bigger; the estate camera is the only thing that reads the island's size, and it
  derives its zoom range from it, so nothing else changed scale.
* Farming, land, plots, prices, levels, persistence, contracts, and authority are untouched. The
  authoritative tile grid never samples terrain, and the reserve is still dead flat.
* The visual invariants - nothing in the sea, no large tree at the waterline, buildings in their
  districts, roads off the reserve, cages in water, deterministic placement - are unchanged and still
  tested.
