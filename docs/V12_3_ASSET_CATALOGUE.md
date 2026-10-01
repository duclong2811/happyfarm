# V12.3 asset catalogue

What the project already owns, what a player may do with it, and what it still needs. This is the
hand-off between the three places a model can appear:

```text
apps/web/src/assets/models/   the art itself (self-contained GLB, curated or generated)
packages/game-data/           the catalogue: id, level, price, capability, tier, upgrade
apps/web/src/render/          how the model is resolved and drawn
```

Provenance and licences are recorded in `docs/ASSET_LICENSES.md` and must not be duplicated here. The
status column below is the one this document adds:

| Status | Meaning |
| --- | --- |
| `READY` | Ships, resolves, and is a catalogue entry a player can see. |
| `PLACEHOLDER` | Ships and resolves, but the art is a stand-in for something better. |
| `NEEDS_ASSET` | The design wants it and no model exists. Not in the catalogue. |
| `CIVIC_ONLY` | Ships and is placed by the island, not sold to the player. |
| `NOT_FOR_PLAYER` | Ships as world scenery or interface art, never in the build catalogue. |

## Road (procedural - no model file)

A road is geometry the client builds from the terrain, so it has no `.glb`. Its visual ids are declared
in `PROCEDURAL_MODEL_IDS` and the catalogue's model-id check accepts them.

| Model id | Category | Use | Level | Price | Tier | Upgrade to | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `road.dirt` | ROAD | the island's own road; the player's first road | 1 | 100 / 4 cells | `road.dirt.t1` | `road.gravel.t2` | READY |
| `road.gravel` | ROAD | intermediate infrastructure | 2 | 250 / 4 cells | `road.gravel.t2` | `road.stone.t3` | PLACEHOLDER (drawn with the dirt ribbon until a gravel material exists) |
| `road.stone` | ROAD | established town/farm road | 3 | 500 / 4 cells | `road.stone.t3` | `road.paved.t4` | READY (cobbled stone surface) |
| `road.paved` | ROAD | late-game prestige | 4 | 900 / 4 cells | `road.paved.t4` | - | PLACEHOLDER (drawn with the stone surface) |

## Vegetation (`assets/models/environment`)

| Model id | Category | Use | Level | Price | Tier | Upgrade | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tree_broad_2` | VEGETATION | a broadleaf tree | 1 | 40 | - | - | READY (3 more broadleaf variants ship: `tree_broad_1/3/4`) |
| `tree_pine_2` | VEGETATION | a conifer | 1 | 40 | - | - | READY (`tree_pine_1/3` ship) |
| `bush_leafy` | VEGETATION | shrubs | 1 | 40 | - | - | READY |
| `bush_flowering` | VEGETATION | flowering shrub | 1 | 40 | - | - | READY |
| `flower_group_1` | VEGETATION | a flower bed | 1 | 25 | - | - | READY (`flower_group_2` ships) |
| `plant_clover` | VEGETATION | ground cover | 1 | 25 | - | - | READY |
| `plant_grass_tall` | VEGETATION | ground cover | 1 | 25 | - | - | READY (`plant_grass_wispy` ships) |
| `plant_fern` | VEGETATION | shaded ground cover | 3 | 25 | - | - | READY |
| `rock_boulder_1` | VEGETATION | a small rock | 1 | 30 | - | - | READY |
| `rock_boulder_3` | VEGETATION | a large rock | 3 | 60 | - | - | READY (`rock_boulder_2` ships) |

## Decoration, fence and lighting (`assets/models/props`)

| Model id | Category | Use | Level | Price | Tier | Upgrade | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prop_fence_rail` | FENCE | a fence section | 1 | 45 | - | - | READY |
| `prop_fence_rail_long` | FENCE | a long fence run | 1 | 90 | - | - | READY |
| `prop_barrel` | DECORATION | storage clutter | 1 | 60 | - | - | READY |
| `prop_crate_wooden` | DECORATION | storage clutter | 1 | 60 | - | - | READY |
| `prop_sack` | DECORATION | storage clutter | 1 | 50 | - | - | READY |
| `prop_planter` | DECORATION | a planted box | 3 | 90 | - | - | READY |
| `prop_bench` | DECORATION | seating | 3 | 120 | - | - | READY |
| `prop_wagon` | DECORATION | a parked cart | 3 | 260 | - | - | READY |
| `prop_stall` | DECORATION | a market stall | 3 | 320 | - | - | READY |
| `prop_lantern` | LIGHTING | a standing lamp | 5 | 140 | - | - | READY |
| `civic.well.t1` | DECORATION | a well | 5 | 400 | - | - | READY (the same model the village well uses) |
| `prop_workbench` | UTILITY | a working bench | 3 | 180 | - | - | READY |
| `prop_cage_small` | WATERFRONT | a fish cage | 5 | 600 | - | - | READY (needs `AQUACULTURE` water) |

## Buildings (`assets/models/farm-buildings`)

| Model id | Category | Use | Level | Price | Tier | Upgrade to | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `farm.barn.t1` | BUILDING | the player's first storage | 1 | 900 | barn T1 | `place_barn_t2` | READY |
| `farm.barn.t2` | BUILDING | a working barn | 3 | 2 200 | barn T2 | `place_barn_t3` | READY |
| `farm.barn.t3` | BUILDING | a warehouse-scale barn | 8 | 4 800 | barn T3 | - | READY |
| `farm.coop.t1` | BUILDING | a chicken coop | 3 | 700 | coop T1 | `place_open_barn` | READY |
| `farm.openbarn.t1` | BUILDING | an open-sided barn for animals | 5 | 1 400 | - | - | READY |
| `farm.silo.t1` | BUILDING | grain storage | 5 | 1 800 | silo T1 | `place_silo_house` | READY |
| `farm.silo_house.t2` | BUILDING | a silo with a house attached | 6 | 3 200 | silo T2 | - | READY |
| `farm.windmill.t2` | UTILITY | a windmill | 5 | 2 600 | - | - | READY |

## Civic and world art (not for sale)

| Model id | Where it is used | Status |
| --- | --- | --- |
| `farm.openbarn.t1`, `farm.barn.t2`, `civic.well.t1` (village set) | the settlement's own buildings and props | CIVIC_ONLY |
| `prop_stall_cart`, `prop_wagon`, `prop_barrel_apples`, `prop_crate_produce`, `prop_crate_carrot`, `prop_crate_empty`, `prop_chest`, `prop_bucket`, `prop_rope`, `prop_axe`, `prop_anvil_log`, `prop_whetstone` | the island's authored set dressing (`COMPOSITION_PRESETS`) | NOT_FOR_PLAYER (the player has the generic crate, barrel and sack instead) |
| `farmhouse`, `barn`, `silo`, `coop`, `windmill` as *landmarks* | the standing village and countryside buildings | CIVIC_ONLY |
| `crop_carrot`, `crop_wheat`, `crop_corn`, `tree_broad_*`, `tree_pine_*` (scenery use) | the world's own scatter and the player's planted crops/trees | NOT_FOR_PLAYER as catalogue rows (planting already owns this path) |
| `character_farmer`, `building_barn` | generated placeholders | PLACEHOLDER |

## NEXT_ASSETS_NEEDED

Ordered by what unblocks gameplay next. Nothing here is downloaded in this pass; the point is to make
the next asset research a list rather than a search.

### HIGH PRIORITY

1. **Crop models at growth stages.** Today one model per crop plus a placeholder cone. A crop that
   visibly grows is the core loop, so this is the single highest-value art gap.
2. **Gravel and paved road materials.** The tiers exist and are priced; they currently draw with the
   dirt and stone surfaces.
3. **A storage/warehouse ladder beyond the barn.** `farm.barn.t1/t2/t3` is the only complete three-tier
   building ladder, and the reserved warehouse plot has no model at all.
4. **Fences and gates as real pieces.** The catalogue has a rail; a farm needs posts, corners and a
   gate.
5. **Aquaculture props.** One small cage exists; a fish farm needs a raft, a feed store and a boat.
6. **Livestock.** Animals, a trough, a hay rack - the coop is the only animal building.
7. **Forestry production props.** A logging yard, stacked timber and a saw bench once existed as
   world scenery and were removed; the player's own forestry needs them back.
8. **Signs, notices and a notice board.** The village has reserved space for one.
9. **Benches, lamps and planters in more than one style.** One of each blocks any sense of progression
   in decoration.

### MEDIUM PRIORITY

1. Monuments and statues for the late ladder.
2. Fountains and civic water features.
3. Bridges - the island has a lake and a bay and no way to cross water.
4. Waterfront decoration: moorings, buoys, a jetty beyond the harbour's own.
5. Decorative carts and seasonal props.

### LOW PRIORITY

1. Luxury decoration and rare monuments.
2. Festival assets.
3. Village upgrade art for the town hall tiers (the data ladder exists; no model does).
