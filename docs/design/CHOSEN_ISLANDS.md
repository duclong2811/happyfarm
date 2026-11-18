# Chosen home islands (island choice and generator v2)

Status: shipped on `world/island-generator`. The brief is `docs/briefs/ISLAND_V2.md`; the research notes
behind the look are `docs/design/ISLAND_V2_RESEARCH.md`.

A new player picks a home island at onboarding: an element (`THO`, `KIM`, `MOC`, `THUY`, `HOA`), an
outline (`ROUND`, `LONG`, `CRESCENT`, `TWIN`, `ATOLL`, `ARCHIPELAGO`) and a seed. The server generates the
island **once**, stores it, and never regenerates it. Farms created before island choice, or with the flag
off, stay on the composed island.

## Generation and storage

- Generators live in `packages/game-data/src/world/`. They are pure and deterministic: the same template
  is the same island on the server and in the browser, with no `Math.random` and no browser APIs.
  - v1, `island-generator.ts`: frozen. A fingerprint test (`tests/game-data/island-ground.test.ts`) pins
    its output, because stored v1 islands must keep drawing and validating unchanged.
  - v2, `island-generator-v2.ts` (`generateIslandV2`): what new farms get.
- `island-ground.ts`:
  - `generateHomeIsland` picks the current generator, and `ISLAND_GENERATOR_VERSION` says which one it is.
  - `buildIslandGround` lays the result on farm tiles: a 96x96 grid at origin (-30,-30), one character
    per cell, and sites in tile coordinates.
  - The result is stored per farm in `farm_islands` (migration 0042).
- **Changing a generator's output requires bumping `ISLAND_GENERATOR_VERSION`** once that version has been
  deployed anywhere with persistent players. Stored islands keep their cells, whatever the generator does
  later.
- Cost: v2 takes about 5.5-7 ms per island (Node, this repository's bench), and it runs once, at farm
  creation. `tests/game-data/island-generator-v2.test.ts` holds a 15 ms ceiling.

### What v2 does

1. **Outline**: a domain-warped outline from a coarse noise lattice, then majority passes. Specks and
   pinholes are removed.
2. **Coves (Thủy)**: carved into the coast, with their mouths rounded.
3. **Ponds**: tilted, wobbly ellipses, kept a few cells inland.
4. **Shelf**: a per-element band of shallows (Thủy gets the widest, with reef flats). Any water within
   1.5 cells of land is shallow, so land never meets deep water.
5. **Biomes**: quantile shares per element (`BIOME_SHARES`), on rotated and warped noise so that edges
   wander. Mộc's interior is old forest, and its edge follows the noise.
6. **Connectivity**: every land or shallow region joins the camp's, through a 3-wide shallow causeway if
   it has to. Water-only fragments and specks sink.
7. **Sites**:
   - `CAMP`: open, level and rock-free, in a round glade near the middle.
   - `DOCK`: sand beside shallows, with deep water close by, nearest the camp.
   - `ORE`: on rock for Kim, otherwise on solid land.
   - `FISH_BAY`: on shallows.
   - `FISHING`: deep water within 2.5 cells of something walkable.
   - `PASTURE`: on meadow.
   - `TREE`: kept off the ore yards.

## What a cell means

| Cell | Server (`classifyIslandTile`, `islandGroundCapabilities`) | Browser |
|---|---|---|
| `DEEP` | `WATER`: nothing is built or planted | Not walkable: the walker's edge |
| `SHALLOW` | `WATER` + shallow: aquaculture only | Walkable at wading depth (`islandWadeDepthAt`, 0.34 m); never buildable or plantable |
| `SAND` | `SHORE` | Walkable |
| `ROCK` | `BLOCKED` | Walkable relief |
| `GRASS`, `MEADOW`, `FIELD`, `FOREST` | Land | Walkable, with scenery by kind |

The server validates every placement against the stored ground. Per farm, that is
`storedIslandGeography` in `workers/api/src/runtime.ts`, which also blocks each mine slot's yard.
Walking is movement in the browser only, but it agrees with the stored cell kinds.

## Fishing on a chosen island

- The island's spots are its `FISHING` sites, as listed by `islandFishingSpots` in
  `packages/game-data/src/fishing`:
  - ids are `spot_isle_<n>` in site order;
  - each uses the coastal table;
  - the interaction radius is 3.2 tiles.
- Server:
  - `islandFishingCatalogue` in `runtime.ts` adds `spotsForPlayer` to the static catalogue.
  - `StartFishing` and `SettleFishing` find a spot only among the player's own spots (`findSpotFor`). An
    island farm cannot fish the composed island's pond or harbour. A composed farm cannot name an island
    spot.
  - Identity comes from the auth context (start) or from the stored action (settle).
- `GET /fishing` stays static game data and reads no farm row (`catalogue-read-cost`).
  - The browser derives the island's spots from the stored island it already holds, with the same
    function (`syncFishingSpots` in `apps/web/src/main.ts`).
  - Spots on deep water get a buoy and ripple rings (`afloat` on `SceneFishingSpot`).

## Rendering

- The picker preview is `islandPreviewPixels` in `apps/web/src/island-picker.ts`. It shows depth colour,
  foam, wet sand, hill shading and forest speckle, and it draws the same cells the server stores
  (`tests/web/island-picker.test.ts`).
- The 3D island:
  - `island-world.ts` builds the cell map, the scenery and the field. Colours are linearised from sRGB;
    the `walk` field puts the walker's edge at deep water; `waterColors` gives the depth tint.
  - `terrain.ts` (`addChosenIsland`) draws one ground mesh at two samples per cell, a shelf floor, and a
    tinted water surface.
  - `player/collision.ts` (`shoreDepthFor`) keeps the walker out of deep water.

## Tests

- `tests/game-data/island-generator-v2.test.ts`, for every element x outline x several seeds:
  connectivity to the camp, no land beside deep water, a deep rim, legal sites, per-element counts and
  proportions, and the CPU ceiling.
- `tests/game-data/island-ground.test.ts`: the v1 and v2 fingerprints.
- `tests/web/island-water.test.ts`: shallows are walkable and wadeable; deep water is not; colours are
  linear.
- `tests/api/island-fishing.test.ts`:
  - the derived spots match the sites, and each one starts;
  - the listing is static;
  - pond, harbour and unknown spots are refused on an island;
  - a composed farm keeps its spots.
- `tests/api/farm-mines.test.ts`: Kim's mines sit on its `ORE` sites.

## Known gaps (task 15: production sites on chosen islands)

- Auto fishery jobs validate their target against the static spot list. An island spot is refused with
  `JOB_TARGET_INVALID`, and the composed island's spots are still accepted.
- Resource nodes (forestry and legacy deposits) come from the composed island's static catalogue. On a
  chosen island, some of them stand in the sea.
- `FISH_BAY`, `PASTURE` and `DOCK` sites are generated and stored, but no production uses them yet.
- Sea reclamation, livestock, NPC workers and building tiers are out of scope here. They should read the
  stored ground rather than regenerate it.
