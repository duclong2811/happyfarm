# ADR 0023: The island master plan, and one persistent island per player

Status: Accepted (2026-09-30)

Supersedes the world *layout* decisions of ADR 0015 and ADR 0021 without changing anything they
decided about coordinates, regions, or progression. Those ADRs sized a farm and put scenery around
it; this one says what the island *is*.

## Context

After Visual V2 the island looked better but still read as a farming board on an island: the reserved
field was a 36-tile square, a rail fence drew that square as a hard outline, everything inside the
reserve was either tilled ground or empty lawn, the roads were five axis-aligned rectangles, and the
districts the config named were invisible because they carried no ground and no rules of their own.

Meanwhile the product direction is larger than a farm: a player owns one island and grows it from a
farm into an estate, and eventually into an agricultural settlement. A world that only knows how to
draw a field cannot carry that.

## Decision

### One persistent island per player, and the world map is a layer above it

The island the player owns is their persistent home world. It is not a level, and it is not the whole
game: a future world map holds many islands - other players', NPC trading islands, event islands -
and travel, trade, and visiting connect them. Nothing in this pass implements any of that. What it
does is stop assuming `farm === entire game world`: the world model is built from a *definition* of
one island, so a second island is another definition rather than a rewrite.

### The world is a definition, not coordinates scattered through the renderer

`apps/web/src/render/world-config.ts` is the single place a world coordinate is written down, and it
now defines:

- the island's outline (a superellipse modulated by three radial lobes) and its elevation;
- **districts**: blobs with a kind, a ground treatment, and vegetation rules;
- **roads**: polylines with a class, drawn as one network;
- water, landmarks, the fence, the spawn, and what is walkable.

The renderer draws that definition, collision reads the same outline and the same fence geometry, and
the camera takes its zoom range from the same bounds. A district cannot move in one place and stay
put in another.

### The island is an estate with a plan

| District | Where | What it is |
| --- | --- | --- |
| CROPLAND | the reserved field `[0,35]^2` | the land the plot catalogue sells; the only place the tile grid is drawn |
| SETTLEMENT | east of the field | farmhouse, market, well, barn: the estate's centre of gravity |
| ORCHARD | north-west upland | rows of fruit trees on the high side |
| PASTURE | west | open grazing ground with a shed at its edge |
| WATER | around the pond | the water district: pond, wetland ground, and the road to it |
| FOREST | north-east and south-west | woodland in pockets, the densest vegetation on the island |
| COAST / PORT | the south-east bay | the harbour, where the primary road ends |

The field is the *agricultural belt* of that plan, not the world. The starter square is one cohort of
one district: a small part of a large island, with the rest visible from the first frame.

### The islands' shape is a coastline rather than a formula

`islandRadiusAt` measures the outline as a superellipse scaled by three low-frequency lobes, which
puts a bay in the south-east (the harbour), a bay in the west, and headlands to the south and the
north-east. The same curve is drawn, walked, and beached.

### Elevation has a lowland and an upland

The terrain is no longer a ring around a plateau. It is a wave field plus a directional upland bias,
multiplied by a mask that holds every working area dead flat - the whole reserved field, the pond,
the barnyard, the settlement, and the harbour quay - and by a fade to zero at the waterline. The
farm's grid never samples any of it.

### Roads are the map's explanation

One primary road runs settlement -> field's south gate -> harbour. Secondary roads reach the orchard,
the pasture, the pond, and the woodland. Paths are the last few metres into a place. They are
authored as waypoints, resampled through a spline, and drawn as terrain-following ribbons. Every road
runs *around* the reserve, so no road can ever cross a tile the farm can buy.

### Land the player has not bought is landscape

The reserve is no longer a lawn with a fence around it. Every plot the catalogue has not sold carries
rough ground and wild growth, generated from a per-plot seed and drawn in the **overlay**, because
buying a plot clears exactly that plot and nothing else. The ring currently for sale additionally
carries the stake line and a sign. Scenery in the static layer grows everywhere except the land the
farm works, so an unbought field is countryside rather than a cleared board.

### The camera's range is a property of the world

`zoomRangeFor` derives the maximum zoom from the ratio between the island's extent and the field's,
so the estate view always reaches the whole island however large it grows, and the farming view still
opens on the field.

## Consequences

- The playable island grew from 62x62 to 89x89 tiles. Nothing about that is stored: a tile row is
  still unlocked land, and the world is still a value with no repository.
- The player's walkable area grew with the island's outline, which is a *movement* change: the estate
  outside the fence is now a place to walk to, not scenery behind a wall. Server authority, planting,
  harvesting, expansion, economy, and identity are untouched.
- The reserved field, the fence, its gates, the plot geometry, and the spawn did not move, so no
  expansion or crop rule changed meaning.
- The renderer gained: district ground patches, road ribbons, one harbour, and a much larger
  scenery budget (900 instances, instanced by kind). Draw calls stayed flat.
- Determinism is unchanged in kind and extended in scope: an island's shape, elevation, districts,
  roads, landmarks, and vegetation are pure functions of the config and a fixed seed.
