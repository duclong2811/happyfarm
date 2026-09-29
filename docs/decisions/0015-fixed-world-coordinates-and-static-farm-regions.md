# 0015 - Fixed world coordinates and static farm regions

Status: implemented (client only); manual browser pass pending.
Phase: 7 (`7B.1`-`7B.6`).

## Context

The renderer used to derive its world origin from the land the player currently owns: `worldX =
(tileX - centreTileX) * pitch`, where `centreTileX` was the centre of the unlocked-plus-next-ring
bounds. Every purchase therefore moved the whole world. That is harmless for a board-style view that
recomputes every refresh, but it is fatal for the phase that follows: a player character, collision,
a spawn point, and a follow camera all need a position that means the same thing tomorrow as it did
today. Unlocking a plot must never teleport the player, a crop, or a tree.

Phase 7A compared three shapes: extend the existing grid visually (A), give the world static regions
that contain the existing plots (B), or divide the world into chunks (C). C was rejected: there is no
streaming, no per-chunk ownership, and no MMO to justify the cost. A was rejected because the next
phase needs zones, a spawn, and walkability, which a bare grid does not express.

## Decision

**B, with the authoritative grid untouched: a static, client-side world config over the existing plot
system.**

* The world origin is **fixed at the centre of the starter land**, tile `(2.5, 2.5)`, for the life of
  the farm. `layout.ts` owns the only mapping (`tileToWorld` / `worldToTile` / `worldFrame`) and every
  module uses it: tiles, crops, trees, locked plots, selection, and, later, the character.
* Camera framing is a **separate** concern. `FarmLayout.frameCenterWorldX/Z` and
  `FarmWorld.centerWorldX/Z` describe where to point a camera; they are not an origin. Zoom, pan, and
  framing cannot change a tile's world position.
* The static world - island, sand, water, fence and gates, paths, the pond, the farmhouse yard, and the
  decorative scenery - is a function of `apps/web/src/render/world-config.ts` alone. Buying land does
  not rebuild it, and scenery is placed on a lattice anchored to the fixed origin, so it never
  reshuffles under the player.
* Regions (`ORCHARD`, `RANCH`, `POND`, `FARMHOUSE`) are **reserved visual space**, declared in tile
  coordinates in that same client config. They are not domain concepts, not `farm_regions` rows, and
  not ownership. `ORCHARD` in particular does **not** make trees tree-only: a tree is still planted on
  any owned soil tile, exactly as before.
* Locked land is **not** static: it is a projection of expansion progression, so it is drawn in a
  progression overlay group that is rebuilt with the dynamic layer, while the island keeps its cache.
* The world exposes, for the character phase, a fixed spawn tile, a static walkability query, and
  static obstacle circles. Crop and tree instances stay authoritative runtime state and are deliberately
  *not* part of the config; the character phase will combine the static answer with the farm's own rows.

## Consequences

* **No migration, no API, no contract change.** Land ownership is still `farm_tiles`, prices and level
  requirements are still the plot catalogue, and occupancy is still the crop and tree rows. Phase 7 adds
  presentation only. `tests/web/farm-world.test.ts` now asserts the acceptance criterion directly: the
  island, apron, centre, pond, yard, path, and scenery are byte-identical before and after land grows.
* **The reservation is honest about its bound.** `FARM_FIELD_BOUNDS` is `[0,17]^2`, the bounding box of
  the eight plots the catalogue ships today, and a test mirrors it against
  `packages/domain/src/plot.ts`, so a catalogue that outgrew the reservation would fail loudly rather
  than silently overlapping a region or clipping land.
* **Static and dynamic layers are separated by what causes them to change.** The static signature is
  the fixed island identity; the dynamic layer carries tiles, crops, trees, selection, hover, and the
  locked-land overlay. The known "dynamic scene groups rebuild every refresh" finding is unchanged and
  still open.
* **Signed coordinates are first-class.** The zones sit at negative tiles (west/north) as well as
  positive ones, which the layout's signed-coordinate support makes free.
