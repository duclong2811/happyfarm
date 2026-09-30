# V10 asset catalogue

The production asset library, one row per shipped model. `apps/web/src/assets/models/` is the
filesystem and `tests/integration/environment-model-assets.test.ts` is the contract; this file is the
provenance record a reviewer reads before the contract.

Every third-party pack below was downloaded from the creator's own page (his site, which links to his
own itch.io page). No mirror, no re-upload, no aggregator, no asset extracted from a commercial game.
Licences were read at the source and are quoted in `docs/ASSET_LICENSES.md`.

## Provenance

| Pack | Author | Licence | Source | Retrieved |
|---|---|---|---|---|
| Stylized Nature MegaKit | Quaternius | CC0 1.0 | https://quaternius.com/packs/stylizednaturemegakit.html | 2026-09-30 |
| Medieval Village MegaKit (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/medievalvillagemegakit.html | 2026-09-30 (buildings), 2026-10-01 (props) |
| Lowpoly Farm Buildings | Quaternius | CC0 1.0 | https://quaternius.com/packs/farmbuildings.html | 2026-09-30 |
| Fantasy Props MegaKit (Standard) | Quaternius | CC0 1.0 | https://quaternius.com/packs/fantasypropsmegakit.html | 2026-10-01 |

Import: `tools/asset-pipeline/node/import-cc0.mjs --village <pack>/glTF --fantasy <pack>/Exports/glTF
--fantasy-textures <pack>/Textures`. Every output is a self-contained `.glb`: base colour only, every
kept texture box-filtered to 256 px, geometry normalized to **one world unit across its largest
dimension with its base on y = 0**, buffer and images embedded.

## Set-dressing props (V10)

All sizes are the model's largest dimension in world metres, as declared in
`apps/web/src/render/prop-model-urls.ts`. "Role" is that file's own role field.

| Internal id | Source pack | Original filename | Author | Licence | Imported | Modified | Category | Production role | World size | Triangles | Textures | Runtime | 
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `prop_barrel` | Fantasy Props | `Barrel` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | barrel, barn yard / quay / market | 0.95 m | 824 | 2 × 256 px | yes |
| `prop_barrel_apples` | Fantasy Props | `Barrel_Apples` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | produce barrel, market | 0.95 m | 2 480 | 3 × 256 px | yes |
| `prop_crate_wooden` | Fantasy Props | `Crate_Wooden` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | crate, logging yard / quay | 0.70 m | 1 576 | 2 × 256 px | yes |
| `prop_crate_produce` | Fantasy Props | `FarmCrate_Apple` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | produce crate, barn / market / orchard | 0.68 m | 4 028 | 3 × 256 px | yes |
| `prop_crate_carrot` | Fantasy Props | `FarmCrate_Carrot` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | produce crate, market / orchard | 0.68 m | 5 262 | 3 × 256 px | yes |
| `prop_crate_empty` | Fantasy Props | `FarmCrate_Empty` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | empty crate, every yard | 0.62 m | 1 928 | 2 × 256 px | yes |
| `prop_sack` | Fantasy Props | `Bag` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | sack, barn / market / orchard | 0.80 m | 858 | 2 × 256 px | yes |
| `prop_bucket` | Fantasy Props | `Bucket_Wooden_1` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | bucket, barn / logging / quay | 0.42 m | 976 | 2 × 256 px | yes |
| `prop_bench` | Fantasy Props | `Bench` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | bench, square / farmhouse | 1.50 m | 404 | 2 × 256 px | yes |
| `prop_stall` | Fantasy Props | `Stall_Empty` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | market stall | 2.60 m | 1 496 | 3 × 256 px | yes |
| `prop_stall_cart` | Fantasy Props | `Stall_Cart_Empty` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | market cart | 2.90 m | 3 936 | 3 × 256 px | yes |
| `prop_rope` | Fantasy Props | `Rope_1` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | rope coil, quay | 0.50 m | 1 748 | 1 × 256 px | yes |
| `prop_lantern` | Fantasy Props | `Lantern_Wall` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | wall lantern, farmhouse / square | 0.55 m | 2 822 | 1 × 256 px | yes |
| `prop_planter` | Fantasy Props | `Pot_1` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | planter, farmhouse / square | 0.75 m | 1 068 | 1 × 256 px | yes |
| `prop_axe` | Fantasy Props | `Axe_Bronze` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | axe, logging yard | 0.80 m | 826 | 1 × 256 px | yes |
| `prop_anvil_log` | Fantasy Props | `Anvil_Log` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | chopping block, logging yard | 1.20 m | 3 808 | 3 × 256 px | yes |
| `prop_workbench` | Fantasy Props | `Workbench` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | bench, barn / logging yard | 1.90 m | 1 368 | 2 × 256 px | yes |
| `prop_chest` | Fantasy Props | `Chest_Wood` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | chest, every yard | 0.90 m | 2 546 | 2 × 256 px | yes |
| `prop_cage_small` | Fantasy Props | `Cage_Small` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | landing cage, quay | 0.95 m | 4 588 | 1 × 256 px | yes |
| `prop_whetstone` | Fantasy Props | `Whetstone` | Quaternius | CC0 1.0 | 2026-10-01 | yes | props | sharpening stone, logging yard | 0.65 m | 1 100 | 3 × 256 px | yes |
| `prop_crate` | Medieval Village | `Prop_Crate` | Quaternius | CC0 1.0 | 2026-09-30 | yes | props | crate | 0.75 m | 230 | 1 × 256 px | yes |
| `prop_wagon` | Medieval Village | `Prop_Wagon` | Quaternius | CC0 1.0 | 2026-09-30 | yes | props | wagon, barn / orchard | 2.20 m | 1 672 | 1 × 256 px | yes |
| `prop_fence_rail` | Medieval Village | `Prop_WoodenFence_Single` | Quaternius | CC0 1.0 | 2026-09-30 | yes | props | short fence run, barn yard | 1.30 m | 40 | 1 × 256 px | yes |
| `prop_fence_rail_long` | Medieval Village | `Prop_WoodenFence_Extension1` | Quaternius | CC0 1.0 | 2026-09-30 | yes | props | fence run, barn yard | 2.10 m | 32 | 1 × 256 px | yes |

## Environment and buildings

Unchanged from V9; listed here so the catalogue is the whole library rather than the V10 delta. Sizes,
triangles and textures per model are in `tools/asset-pipeline/node/import-report.json`.

| Internal id | Pack | Role |
|---|---|---|
| `tree_broad_1..4`, `tree_pine_1..3` | Stylized Nature | forest, orchard, forestry, wild trees |
| `bush_leafy`, `bush_flowering` | Stylized Nature | undergrowth, hedgerow |
| `rock_boulder_1..3` | Stylized Nature | shoreline, upland, meadow stones |
| `plant_fern`, `plant_grass_tall`, `plant_grass_wispy`, `plant_clover` | Stylized Nature | meadow and forest floor detail |
| `flower_group_1..2` | Stylized Nature | wildflower patches |
| `farm.barn.t1..t3`, `farm.openbarn.t1`, `farm.silo.t1`, `farm.silo_house.t2`, `farm.windmill.t2`, `farm.coop.t1`, `civic.well.t1` | Lowpoly Farm Buildings | the estate's structures |

## Rejected, and why

| Model | Pack | Reason |
|---|---|---|
| `TwistedTree_*`, `DeadTree_*` | Stylized Nature | 9-10 k triangles each for a silhouette that reads as "spooky" rather than as farmland (V4). |
| `Mushroom_*`, `Pebble_*`, `RockPath_*`, `Petal_*` | Stylized Nature | first-person detail props; invisible or sub-tile at farm-camera distance (V4). |
| Medieval Village modular kit (walls, roofs, doors, stairs, balconies, towers) | Medieval Village | A building assembled from kit pieces is a modelling job with its own art direction. **Rejected for V10, and the single largest gap in this pass** - see `docs/decisions/0025-v10-asset-library-and-set-dressing.md`. |
| `Prop_Brick*`, `Prop_Chimney*`, `Prop_Vine*` | Medieval Village | Masonry that belongs to that kit's building style, not to a farm. |
| `Fence`, `Fence2`, `WaterTower`, small `Windmill` | Lowpoly Farm Buildings | No scene draws a second windmill or a water tower, and an asset with no scene is a bundle cost (V8). |
| Books, candles, potions, tableware, weapons, shields, banners, beds, cupboards (~70 models) | Fantasy Props | Interiors. An estate camera never sees them. |
| `Crate_Metal`, `Anvil`, `Cauldron`, `Chain_Coil`, `Pickaxe_Bronze`, `Vase_*`, `Scroll_*` | Fantasy Props | Two crates in one vocabulary is one too many, and the rest are dungeon props rather than farm ones. |
| KayKit Medieval Builder / Hexagon | KayKit | A different stylized dialect from Quaternius; the art-consistency gate rejects it beside this set (V4). |

## Files

- Models: `apps/web/src/assets/models/props/*.glb` (24 props), `environment/*.glb` (18), `farm-buildings/*.glb` (9), plus the generated crops and character.
- Manifests: `apps/web/src/render/prop-model-urls.ts` (set dressing), `apps/web/src/render/environment-model-urls.ts` (scenery), `apps/web/src/render/building-model-urls.ts` (buildings).
- Import tool: `tools/asset-pipeline/node/import-cc0.mjs`; report: `tools/asset-pipeline/node/import-report.json`.
- No `.zip`, `.rar`, `.7z`, `.fbx`, `.gltf` or `.bin` is committed; `tests/integration/environment-model-assets.test.ts` fails if one appears.
