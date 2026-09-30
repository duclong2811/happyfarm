# ADR 0021: A bigger farm, and a world composed around it

Status: Accepted (2026-09-30)

## Context

The alpha's starter farm was six tiles square - 36 tiles - inside an eighteen-tile reserved field,
inside a forty-four-tile island. A player owned a patch, looked at a fence that promised nine plots,
and saw a large empty green circle around all of it. The world was also drawn as one flat plane with
a scatter of props, so there was no hierarchy and the island simply stopped.

## Decision

### One cohort of land is twelve tiles

- `INITIAL_LAND_SIZE` is 12 (was 6): the starter square is 144 tiles.
- `PLOT_TILE_SIZE` is 12 (was 6): a plot is one cohort of 144 tiles, and the reserved field is three
  cohorts a side - 36 x 36 tiles, 1,296 in all.

The two constants move together on purpose. The plot geometry is a ring of cohorts around the starter
square, so scaling the cohort keeps the ring arithmetic, `plotTileCoordinates`, `unlockedPlotIndex`,
the renderer's mirror of it, and the `farm_tiles` rows agreeing about which coordinate a plot index
occupies. Nothing about *how* land is bought changes.

### The world scales with the config, not with the farm

`VISUAL_BOUNDS` is 62 x 62 tiles, centred on the field, and the fixed world origin - the middle of the
starter square - moved with the starter square to tile (5.5, 5.5). Everything static remains a
function of the config alone: buying a plot still cannot move a tile, a tree, the fence, the pond, or
the spawn.

### Composition, not scale

The island grew, and then it was furnished:

- **Regions** (`WORLD_REGIONS`) still reserve the orchard, the ranch, the pond, and the farmhouse
  yard, all outside the field.
- **Tree lines** (`TREE_BANDS`) plant the orchard rows and the ranch windbreak *from* those
  reservations, so the reserves look like the thing they reserve.
- **A rim tree line** closes the island's edge, so the world has a boundary instead of an outline.
- **Terrain patches** (`MEADOWS`) break the flat green into meadow, bare earth, and shore. They are
  colour only: no tile, no rule, no collision.
- **Paths** still branch from the gates, now to the ranch, the pond, and the farmhouse yard.

About 200 scenery instances are placed from a fixed seed on a lattice anchored to the island, denser
toward the rim and sparser toward the field. The count is capped, the generator advances once per
candidate, and nothing reads the farm's tiles, so the world is identical for two players and
unchanged when land is bought.

### None of it is persisted

A tile row *is* unlocked land. The renderer's world is a value derived from the config and the tiles
the server sent: it has no repository and cannot insert anything. Creating a farm writes 144 rows
(one 12 x 12 square); the 1,296-tile reserve and the 3,844-tile island cost nothing until land is
actually bought. `tests/integration/world-tile-budget.test.ts` holds that line.

### The camera opens on the farm

`cameraFrameExtent` decides the framed extent from three numbers: the island (how far a player may
zoom out), the farm (the fence rectangle), and the follow distance (nine metres, about eight tiles).
The smallest applies, so the default view before a character exists is the farm, a character pulls
the camera in to crop-and-avatar detail, and zooming out still reaches the whole island. The camera
still only reads a character position and never writes one.

### The shore follows the island

The collision world's island ellipse was centred on the world origin - the middle of the starter
square - while the drawn island is centred on the visual bounds. With a six-tile starter square and
an eighteen-tile field the difference was small enough to go unnoticed; with a twelve-tile square
inside a thirty-six-tile field the spawn itself would have sat past the shore. The ellipse is now
centred on `WORLD_CENTER_WORLD`, so the walkable island and the drawn island are the same shape.

## Consequences

- A farm that already bought plots under the old geometry would read its expansion depth as 0,
  because a plot's tiles would no longer be where `plotTileCoordinates` looks. No staging farm can be
  in that state: buying land costs gold, and the broken starter economy never granted any. A
  production farm in that state would need its land re-issued; there is no production deployment.
- Land is now four times larger per plot for the same price. Rebalancing the plot prices is a
  follow-up product decision, deliberately not taken here.
- The domain's `MAX_ADDRESSABLE_PLOT_INDEX` and the renderer's tile bounds both derive from
  `PLOT_TILE_SIZE`, so they followed the change without edits.
- The placeholder art is still placeholder: this is composition and scale, not the visual overhaul.
