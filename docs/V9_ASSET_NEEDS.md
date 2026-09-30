# V9 asset needs

The Visual V9 pass changed the island's composition first and went looking for assets second, so that
the layout decides what has to exist rather than the other way round. This is the audit that came out
of it: what the plan now asks for, what already ships, and what the next asset pass should import.

Every row is judged against the art-consistency gate in the V9 brief: silhouette, saturation,
material style, polygon density, scale, roof language, wood colour, and foliage style. An asset that
is good on its own but foreign to this set is worse than the primitive it would replace.

## Existing library

The shipped set is CC0, curated by hand, and recorded in `docs/ASSET_LICENSES.md`:

| Family | Models |
|---|---|
| Trees | `tree_broad_1..4`, `tree_pine_1..3` |
| Ground cover | `bush_leafy`, `bush_flowering`, `plant_fern`, `plant_grass_tall`, `plant_grass_wispy`, `plant_clover`, `flower_group_1..2` |
| Rock | `rock_boulder_1..3` |
| Farm buildings | `farm.barn.t1..t3`, `farm.openbarn.t1`, `farm.silo.t1`, `farm.silo_house.t2`, `farm.windmill.t2`, `farm.coop.t1`, `civic.well.t1` |
| Props | `prop_crate`, `prop_wagon`, `prop_fence_rail`, `prop_fence_rail_long` |
| Character | `character_farmer` |

## The matrix

| Category | Needed | Existing | Missing | Priority |
|---|---|---|---|---|
| Civic | farmhouse | primitive (`buildFarmhouse`) | a real model | high |
| Civic | town hall | none (reserved ground only) | whole building | later - no tier exists |
| Civic | market | primitive (`buildMarketStall`) | covered-market model | medium |
| Civic | warehouse | none (reserved ground only) | whole building | later |
| Civic | well | `civic.well.t1` | - | - |
| Civic | fence | `prop_fence_rail`, `prop_fence_rail_long`, drawn fence | - | - |
| Civic | sign | primitive (`addSignpost`) | a sign model | low |
| Civic | crate | `prop_crate` | - | - |
| Civic | wagon | `prop_wagon` | - | - |
| Farm | barn | `farm.barn.t1..t3` | - | - |
| Farm | open barn | `farm.openbarn.t1` (used by `OPEN_BARN`) | - | - |
| Farm | silo | `farm.silo.t1`, `farm.silo_house.t2` | - | - |
| Farm | hay bale | primitive (in the open barn) | a hay-bale model | medium |
| Farm | sacks | none | sacks model | low |
| Farm | field fence | fence props | - | - |
| Farm | cart | primitive (in the open barn) | a cart model | low |
| Farm | machine shed | none | a shed model | low - the yard is empty by design |
| Forestry | log pile | primitive (in the logging yard) | a log-pile model | medium |
| Forestry | timber storage | none | a plank stack | low |
| Forestry | sawmill-like structure | none | whole building | later - no rule exists |
| Fishery | dock | geometry in `terrain.ts` from `HARBOUR` | - | - |
| Fishery | fishing boat | primitive hull on the quay | a boat model | medium |
| Fishery | barrel | primitive on the quay | - | - |
| Fishery | crate | `prop_crate` | - | - |
| Fishery | fishing net | flat canvas panels on the store | a net model | low |
| Fishery | fish cage | geometry in `terrain.ts` from `FISH_FARM` | - | - |
| Landscape | bridge | none needed - no road crosses water | - | not wanted |
| Landscape | reeds | primitive cones at the lake | reed model | medium |
| Landscape | stones | `rock_boulder_1..3` | - | - |
| Landscape | hedge | `bush_leafy` rows | - | - |
| Landscape | grass | `plant_grass_tall`, `plant_grass_wispy` | - | - |
| Landscape | trees | `tree_broad_*`, `tree_pine_*` | - | - |

## What the pass did *not* do

No asset was imported. Every gap above is filled by a primitive built behind the abstraction that will
replace it (`BuildingVariant.modelId` for buildings, the harbour and fish-farm builders behind
`HARBOUR`/`FISH_FARM`, the scenery manifest for plants), so the next pass is a model import and a
manifest edit rather than a layout change.

Nothing was downloaded speculatively, nothing was kept because "there is a model", and the licensed
set is still exactly what the scene draws: `tests/web/farm-production.test.ts` fails if a shipped
building model is not named by a variant, and `tests/integration/environment-model-assets.test.ts`
fails if a model ships that nothing draws.
