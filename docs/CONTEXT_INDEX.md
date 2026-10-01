# Context Index for AI Agents

Purpose: reduce token use and prevent agents from reading unrelated code.

Always read:
1. `/AGENTS.md`
2. This file

For "what should we build next" planning, read `docs/ROADMAP.md`. It lists the ordered phases after
the current build, each written to be handed to an implementation agent as one prompt. It is
planning input only: it does not authorize a change, and every phase still follows the task template
and the execution protocol.

Then read only what matches the task:

## Phase 1 foundation task
- `AGENTS.md`
- `docs/architecture.md`
- Phase 1 section of `docs/PROJECT_SPEC.md`
- Player, Farm, FarmMember, and Tile sections of `docs/DATA_MODEL.md`
- `docs/protocols.md` only if contracts are created
- `.agents/skills/security-review/SKILL.md` if D1 repositories, authentication boundaries, authorization, or persistent mutations are introduced
- only relevant packages, migrations, and tests

Do not automatically inspect the renderer, assets, unrelated domains, economy, animals, trees, fish, or final multiplayer gameplay.

## Phase 2 crop simulation task
- `docs/architecture.md` offline simulation and boundaries
- crop/tile/idempotency sections of `docs/DATA_MODEL.md`
- crop/time sections of `docs/PROJECT_SPEC.md`
- relevant contracts in `docs/protocols.md`
- `.agents/skills/security-review/SKILL.md`
- only crop domain/application/game-data, D1 adapters, current crop migration, and related tests

Do not inspect economy, inventory settlement, renderer, multiplayer, or unrelated content domains unless a concrete contract requires it.

## Farming/domain task
- `docs/architecture.md`
- `docs/PROJECT_SPEC.md` relevant section
- target files under `packages/domain/farming`, `packages/application`, `packages/game-data`
- related unit tests

## Economy/inventory/shop task
- `docs/architecture.md`
- `docs/DATA_MODEL.md` wallet/inventory/ledger/idempotency sections
- `docs/protocols.md` if public contract changes
- `.agents/skills/security-review/SKILL.md`
- only affected services/repositories/tests

For Phase 2B harvest settlement, also read `docs/decisions/0003-crop-simulation-and-idempotency.md` and `docs/decisions/0004-inventory-and-harvest-settlement.md`; do not inspect wallet/shop/economy implementation unless explicitly requested.

For Phase 3 economy work, read `docs/decisions/0005-phase-3-economy-architecture.md` before editing types, ports, game data, contracts, settlement, or persistence.

## Progression / levelling task (Phase 4A)

Read `docs/decisions/0008-player-progression-and-levelling.md` before editing experience, levels,
the curve, the harvest settlement, or the `player_progression` table.

- Curve values: `packages/game-data/src/progression/index.ts`. Curve arithmetic:
  `packages/domain/src/progression.ts` and `tests/domain/progression.test.ts`.
- Award amounts: `CropDefinition.harvest.xp` in `packages/domain/src/crop.ts`,
  `packages/game-data/src/crops/index.ts`, and `tests/game-data/schema.test.ts`.
- The only write path: `packages/application/src/harvest.ts` and
  `D1HarvestSettlementRepository` in `workers/api/src/d1-repositories.ts`.
- Persistence: `database/migrations/0005_player_progression.sql` and
  `tests/integration/progression-migration.test.ts`.
- Reads and display: `packages/application/src/progression.ts`, the `Phase 4A` section of
  `docs/protocols.md`, and `apps/web/src/progression.ts`.

Experience is never accepted from a client, and a level is never computed outside
`packages/domain/src/progression.ts`. Do not add a second way to award experience: the award belongs
to the harvest settlement so that a replay cannot pay it twice.

## Crop unlocks by level (Phase 4B)

Read `docs/decisions/0009-crop-unlocks-by-level.md` before editing crop definitions, the planting
gate, the crop catalogue, or the client's planting control.

- The requirement and its only rule: `requiredLevel` on `CropDefinition`, plus `requiredLevelFor` and
  `isCropUnlocked`, in `packages/domain/src/crop.ts`; `tests/domain/crop-unlock.test.ts`.
- Values: `packages/game-data/src/crops/index.ts`. Translation to the domain shape:
  `GameDataCropDefinitions.list()` / `findById()` in `workers/api/src/runtime.ts`.
- Enforcement: `PlantCrop` in `packages/application/src/crops.ts`. The read-only catalogue is
  `ListCropDefinitions` in the same file, served as `GET /crop-definitions` in
  `workers/api/src/handler.ts`.
- The client: `apps/web/src/{api,main,i18n}.ts`. The planting control is built from the catalogue
  and holds no crop list of its own; `tests/web/farm-assets.test.ts` ties the model manifest to game
  data rather than to a client constant.

Never gate a read: `CropStateProjector` and `GetFarmCrops` keep reporting crops a player could not
plant today, and no route accepts a level, an experience total, or a crop requirement from a client.

## Farm expansion (Phase 4C)

## Trees and repeating harvests (Phase 6)

## Farm world and map foundation (Phase 7)

Read `docs/decisions/0015-fixed-world-coordinates-and-static-farm-regions.md` before editing world
layout, world coordinates, regions, paths, the spawn, or walkability, and
`docs/decisions/0021-larger-farm-and-world-composition.md` before changing the starter square, the
plot cohort size, the island bounds, or the composition of the scenery.

- The canonical mapping: `apps/web/src/render/layout.ts` (`worldFrame`, `tileToWorld`, `worldToTile`,
  fixed origin at the starter land's centre, currently tile `5.5,5.5` for a 12 x 12 starter square).
  Every module must use it; do not reintroduce a formula that depends on the currently unlocked land.
- Static world definitions: `apps/web/src/render/world-config.ts` (visual bounds, reserved regions,
  tree bands, the rim tree line, terrain patches, fence and gates, paths, pond, farmhouse yard,
  spawn, static obstacles, the framed farm extent, walkability queries).
- Static geometry: `apps/web/src/render/world.ts` and `apps/web/src/render/terrain.ts`. Static layers
  are a function of the config alone; locked land is a progression overlay and is rebuilt with the
  dynamic layer.
- Tests: `tests/web/farm-world-config.test.ts` (coordinates, round-trip, config validity,
  walkability) and `tests/web/farm-world.test.ts` (the world does not move when the farm grows).

Read `docs/decisions/0022-world-visual-foundation-v2.md` before changing the island's outline, its
elevation, the cultivated apron, the treatment of locked land, the scenery distribution, the
landmark set, or the renderer's lighting, sky, shadows, and instancing.

- Shape and elevation, pure and tested: `apps/web/src/render/terrain-height.ts`
  (`islandRadiusAt`, `islandRimPoint`, `terrainHeightAt`, `GROUND_SURFACE_Y`), its config in
  `world-config.ts` (`ISLAND_SHAPE`, `TERRAIN_SHAPE`, `TERRAIN_RELIEF_WORLD`, `terrainLevelAreas`),
  and `tests/web/farm-terrain.test.ts`.
- The cultivated apron and the bed follow the land the farm *owns* (`FarmWorld.apron`/`.bed`,
  `APRON_MARGIN_TILES`); locked land is ground, scrub, a stake line, and a sign
  (`FarmWorld.lockedScenery`/`.lockedBoundary`). Both are rebuilt with the overlay, never with the
  static layer.
- Landmarks: `LANDMARKS`/`LANDMARKS_WORLD`/`STATIC_OBSTACLES` in `world-config.ts` and the builders
  in `apps/web/src/render/landmarks.ts`. A landmark is scenery with a collision circle; it unlocks,
  stores, and prices nothing.
- Scenery is clustered and deterministically seeded in `world.ts`, and drawn instanced by kind in
  `apps/web/src/render/scenery.ts`. Tile slabs are one `InstancedMesh` built in `scene.ts`.

Read `docs/ASSET_LICENSES.md` before adding, replacing, or removing any third-party asset, and before
touching the import pipeline.

- Scenery assets are third-party CC0 models, curated by hand. The curation - which model, which
  category, which tier, and the scale that turns "one world unit" into metres - is
  `apps/web/src/render/environment-model-urls.ts`, and the model files are
  `apps/web/src/assets/models/{environment,props}/`. Nothing else may name a `.glb`.
- The world model names a *kind*, a *tier* and a variant roll; `scenery.ts` resolves those to a
  model. Every placement today is `HERO` (the curated set); `FILLER` is the empty hook a real
  distance-based level of detail will use. `HERO_SCENERY_BUDGET` in `world.ts` bounds the triangle
  cost of the island, and a placement past the budget is *skipped* rather than downgraded.

Read `apps/web/src/render/placement.ts` before adding, moving, or re-shaping any placement system.

- Every decorative placement - open-country scenery, the wild growth on locked land, the shoreline
  band, the hedgerow - is validated by `placementRejection` against one `PlacementWorld`: the
  authoritative coastline (`islandRadiusAt`, the same curve the terrain mesh and collision use), the
  map bounds, the road tile set, standing water, and building clearings. A placement names its
  `ShorelineClass`, which is how a tree stays 10% inland while grass may reach the water.
- Buildings are data: `apps/web/src/render/buildings.ts` (`BuildingDefinition`, `BuildingVariant`,
  `ReservedBuilding`). A building declares its district, footprint, collision circle, visual tier,
  and the model each tier will use. Tier 1 is the primitive geometry drawn today; nothing here reads
  the player's level, and nothing may until a contract explicitly says so.
- District functions and their vegetation profile live in `DISTRICTS` in `world-config.ts`: one row
  per function (crops, civic, orchard, pasture, water, woodland, managed woodland, coast), with the
  density and tree share that make the districts read differently from the estate camera.
- The plan itself: nine functions with explicit adjacency and a reserved **`FUTURE`** district that
  is deliberately undeveloped land - see the V6 section of `docs/ROADMAP.md`. Districts carry **no
  ground tint**: identity comes from vegetation, rows, paths, and buildings, because painted ellipses
  read as a debug overlay from the estate camera.
- Roads follow the plan rather than the terrain's convenience: one primary from the harbour through
  the civic core past the field's gate, secondaries to orchard, forestry, freshwater, and pasture.
  The primary and its secondaries stay outside the reserve, and a test proves the route.
- `tests/web/farm-placement.test.ts` holds the invariants: nothing outside the island, no large tree
  near the water, buildings inside their own district, no scenery in the crop reserve, and one
  primary road reaching the settlement, the fields' gate, and the harbour.

Buildings and production land:

- `apps/web/src/render/buildings.ts` is the building model: `BuildingDefinition` (district, footprint,
  collision circle, visual tier, variants), `BuildingVariant` (tier, asset id, label), and
  `ReservedBuilding` for ground held for a building that does not exist yet. Tier 1 is what the world
  draws; nothing here reads the player's level.
- `apps/web/src/render/building-model-urls.ts` resolves a deterministic asset id (`farm.barn.t2`) to a
  file and a size in metres. The world definition never names a `.glb`; the models are in
  `apps/web/src/assets/models/farm-buildings/`, and `docs/ASSET_LICENSES.md` records where they came
  from. Importing more is `tools/asset-pipeline/node/import-fbx.mjs`.
- `apps/web/src/render/production.ts` is the production-land vocabulary: `ProductionCellType`
  (CROP / ORCHARD / AQUACULTURE, with LIVESTOCK / FORESTRY / PROCESSING named for later),
  `ProductionZone`, and `buildProductionZones`. Crop cells *are* authoritative farm tiles, orchard
  cells sit on the orchard's row lattice, and aquaculture basins sit in the fishery's district - three
  shapes, three rules, one vocabulary, and no gameplay attached to any of them yet.
- `tests/web/farm-production.test.ts` holds the invariants: crop cells are owned tiles, orchard and
  basin cells live in their own district, basins keep off the quay, building ids are unique, every
  building stands in its district, a reserved plot has room for the building that will replace it, and
  every shipped model is named by something.
- Importing a new model is `tools/asset-pipeline/node/import-cc0.mjs` (glTF → self-contained GLB,
  base-colour textures downscaled, normalized to one world unit across its largest dimension with its
  base on `y = 0`). Its output is recorded in `tools/asset-pipeline/node/import-report.json`.
- `tests/integration/environment-model-assets.test.ts` holds the contract: the curated set is exactly
  what ships, every model is self-contained and normalized, and no unpacked source pack is committed.

Read `docs/decisions/0023-island-master-plan.md` before changing what the island *is*: its outline,
its districts, its roads, its landmarks, or the assumption that one player owns one persistent
island rather than one map.

Read `docs/decisions/0024-v9-world-composition-rebuild.md` before changing the island's *size*, the
layout of its districts, the road network's clearance rule, the field parcels, the orchard and
managed-wood lattices, the harbour and fish-farm geometry, the camera's framing rule, or the planting
grid.

Read `docs/decisions/0025-v10-asset-library-and-set-dressing.md` before changing the estate's set
dressing, the prop manifest, the importer, or the plantation latices again. Read
`docs/V10_ASSET_CATALOG.md` before adding, replacing or removing any third-party model.

Read `docs/decisions/0026-unified-world-cell-system.md` before touching coordinates, selection,
navigation, land use, occupancy, or the visibility of any grid.

- One coordinate system: `apps/web/src/render/world-cell.ts` (`WorldCell`, `worldToCell`,
  `cellToWorld`, the capability rule). A cell *is* a farm tile, so the conversion is the existing
  tile mapping and nothing else may divide by a pitch.
- The map: `apps/web/src/render/world-cell-map.ts` (`buildWorldCellMap`, terrain from
  `islandRadiusAt`, zones from the districts plus the aquaculture and mining reserves, occupancy from
  buildings, planted rows and large scenery). `FarmSceneInput.cells` is the one map every reader uses.
- Selection and movement: `apps/web/src/render/world-cell-selection.ts`; actions:
  `apps/web/src/render/world-cell-actions.ts`; the overlay and the debug lattice:
  `apps/web/src/render/world-cell-overlay.ts`.
- Compatibility: `apps/web/src/render/legacy-farm-cell-adapter.ts`. Never add a second conversion.
- The island's grid is invisible in normal play and the full lattice only exists behind `?debug=1`.
  Selection draws one cell and at most its eight neighbours.

- Set dressing is data: `apps/web/src/render/composition.ts` (types and the pure builder) and
  `COMPOSITION_PRESETS` in `world-config.ts` (the authored places). Props are resolved by
  `apps/web/src/render/prop-model-urls.ts` and drawn by `apps/web/src/render/dressing.ts`; the
  scenery pass keeps out of every preset's clearing.
- A planted district names the model it plants (`SceneryInstance.modelId`): an orchard row is one
  cultivar, a natural forest is a family.
- Import a pack with `tools/asset-pipeline/node/import-cc0.mjs --nature|--village|--fantasy <dir>`.
  A dropped texture slot must be deleted where it actually lives, and a model whose ORM map is
  dropped must not keep glTF's default metallic factor.

- `VISUAL_BOUNDS` is `[-34, 70]^2`; the reserve, the fence, the starter square, and the tile mapping
  are unchanged, and every district's centre sits at 50-65 per cent of the way to the shore.
- Placement rules: `placementRejection` takes the road network as centreline samples plus each road's
  own half-width, so a clearance is a distance and not a tile lookup.
- The camera follows the character until `followExtent * zoom >= worldExtent`, and looks at
  `terrainHeightAt` under whatever it frames. The planting grid is
  `apps/web/src/render/interaction-grid.ts`, driven by `setInteraction` from `selection.canPlant`.

- The single semantic world definition is `apps/web/src/render/world-config.ts`: `VISUAL_BOUNDS`,
  `ISLAND_LOBES`, `DISTRICTS`, `ROADS`/`ROAD_WIDTH_TILES`, `POND`, `FARMSTEAD`, `LANDMARKS`,
  `FENCE`, `SPAWN_TILE`, `terrainFlatAreas`, `ISLAND_UPLANDS`, and `TERRAIN_SHAPE`. No other module
  may hold a world coordinate of its own.
- Island outline and elevation: `terrain-height.ts` (`islandRadiusAt`, `islandRimPoint`,
  `islandOutlineScale`, `terrainHeightAt`, `flatMask`, `uplandOffset`). The playable tile grid never
  samples it.
- Roads: `apps/web/src/render/roads.ts` (waypoints to a terrain-following centreline) and
  `roadGeometry` in `terrain.ts` (the ribbon).
- Districts are landscape, not ownership: `FarmWorld.districts` tints ground, `FarmWorld.roads`
  carries the network, and the *only* thing that decides where farming is allowed is still
  `farm_tiles` plus the plot catalogue.
- The camera's maximum zoom is derived, not constant: `zoomRangeFor` in `camera.ts`, applied by
  `scene.ts` from the island and field extents.

Regions are client/static and visual only: they are not domain concepts, not D1 rows, and never gate
gameplay. Land authority stays `farm_tiles` plus the plot catalogue.

## World V12: the player-built island (current direction)

Read `docs/design/WORLD_V12_PLAYER_BUILT_ISLAND.md` before changing terrain, districts, roads, land
use, ownership, expansion, or the build catalogue. It records the direction change itself: **OLD** -
developer-defined production districts; **NEW** - player-developed land using WorldCell capabilities
plus ownership plus placed objects.

- Capabilities and the land-use rule: `apps/web/src/render/world-cell.ts` (`CellCapability`,
  `cellCapabilitiesFor`, `cellHasCapability`), filled by `world-cell-map.ts`, with
  `tests/web/world-cell-capabilities.test.ts`. A district never appears in that rule.
- The volcano: `VOLCANO`/`VOLCANO_SHAPE` in `apps/web/src/render/world-config.ts` and
  `volcanoHeightAt`/`volcanoZoneAt`/`volcanoRadiusFraction` in `terrain-height.ts`. The cell map turns
  the same fractions into `VOLCANO_CORE` / `VOLCANO_SLOPE` / `VOLCANO_FOOTHILL`, which is what makes
  "nothing may be built in the crater" a property of the ground. `ISLAND_RINGS` and
  `ISLAND_SECTORS` in `terrain.ts` are the resolution of the static ground mesh, and a crater needs
  them: 14 rings flattened the landmark into a dome.
- Roads are **dirt**: the island authors one, from the harbour to the village, and paving exists only
  in the village plaza. Widening, shoulders and the tier data are `ROAD_WIDTH_TILES` /
  `ROAD_SHOULDER_WORLD` in `world-config.ts` and `packages/game-data/src/roads/index.ts`; the shoulder
  table lives there rather than in `terrain.ts` because scenery clearance is measured from the
  rendered edge. `ROAD_CLEARANCE_WORLD` in `placement.ts` is the corridor, scaled per scenery class.
- `WOODLANDS` in `world-config.ts` is the island's two tree masses. They are landscape, not districts:
  a player clears them like any other tree, and `CellCapability` is still the only thing that decides
  what a cell may become.
- The ground mesh's colour is part of the height function, not a separate material. The volcanic tint
  is gated by *height* as well as by footprint - a footprint alone painted rock on the flat north
  shore and read as a cliff.
- Starter land and expansion: `apps/web/src/render/land-ownership.ts`
  (`EXPANSION_PARCEL_CELLS`, `buildLandOwnership`, `ownedShare`) with `tests/web/land-ownership.test.ts`.
  It projects the *server's* land; nothing here may grant, price, or sell anything.
- Road tier data (the one price table): `packages/game-data/src/roads/index.ts`. The build catalogue
  foundation, which is *not* the market: `packages/game-data/src/placement/index.ts`.
- Road network and its required destinations: `apps/web/src/render/road-network.ts`. The V12 recovery
  removed the authored spurs across the future player land; do not re-add a road to a production
  district.
- Performance of the client: `docs/decisions/V12_PERFORMANCE_RECOVERY.md` before touching the poll,
  the render loop, pointer handling, shadows, or the renderer's quality switch.

## Player character (Phase 7B.7)

Read `docs/decisions/0016-player-character-and-follow-camera.md` before editing movement, collision,
the spawn, the avatar, or the camera while a character is drawn.

- Movement: `apps/web/src/player/controller.ts` (the only function that advances the character),
  `apps/web/src/player/input.ts` (keys to one intent vector),
  `apps/web/src/player/collision.ts` (the static world plus the farm's own rows), and
  `apps/web/src/player/runtime.ts` (start/stop/respawn, the collision world, one frame at a time).
- The fence: `fenceGeometry()` in `apps/web/src/render/world-config.ts` is the only derivation of
  `FENCE.bounds` + `FENCE.gates`. `apps/web/src/render/terrain.ts` draws its segments and
  `apps/web/src/player/collision.ts` blocks them; neither may hold a gate number of its own.
- The camera: `apps/web/src/render/camera.ts` owns the target (`character + pan offset`, clamped to
  the farm) and the zoom; `apps/web/src/render/drag-gesture.ts` decides whether a press is a click or
  a pan. The camera reads a character position and never writes one.
- The view: `apps/web/src/render/scene.ts` (`FarmScenePlayer`, `setPlayer`, the avatar placeholder,
  the follow camera) and the colour entries it uses in `apps/web/src/render/materials.ts`.
- The wiring: `apps/web/src/main.ts` supplies the platform - the keyboard, `requestAnimationFrame`,
  the renderer to publish a pose to - and rebuilds the collision world on every farm refresh.
- Tests: `tests/web/player-controller.test.ts`, `tests/web/player-input.test.ts`,
  `tests/web/player-collision.test.ts`, `tests/web/player-runtime.test.ts`,
  `tests/web/farm-camera.test.ts`, `tests/web/drag-gesture.test.ts`.

The character is client-local and non-authoritative. Never send a position, never read one as game
state, and never let a client-side position gate planting, harvesting, or land. The server owns
those, and multiplayer positions belong to the FarmRoom phase, not here.

## Responsive HUD and touch interaction (player UX)

Read `docs/decisions/0017-responsive-touch-interaction.md` before editing the canvas pointer
handling, the action dock, the side panels, or any responsive style.

- Gestures: `apps/web/src/render/pointer-gesture.ts` (tap / pan / pinch arbitration, pure) and the
  canvas wiring in `apps/web/src/render/scene.ts`.
- Camera: `apps/web/src/render/camera.ts` is the only camera rig; touch feeds it a pinch scale and
  nothing else. `tests/web/farm-camera.test.ts`.
- Walking: `apps/web/src/player/intent.ts` (the `MovementIntent` boundary: directional or
  destination) and `apps/web/src/player/runtime.ts` (destination lifecycle, stall, arrival). The
  dock's `👣 Go` button lives in `apps/web/src/main.ts` with `apps/web/src/render/layout.ts` doing
  the tile-to-world conversion.
- Panels and breakpoints: `apps/web/src/panels.ts` owns the open/folded defaults (mirroring the
  900 px breakpoint) and `apps/web/src/responsive.css` owns every responsive rule; it is imported
  after `styles.css` on purpose. `--hud-height` and `--dock-height` are measured in `main.ts` by
  `syncLayoutMetrics()`.
- Tests: `tests/web/pointer-gesture.test.ts`, `tests/web/farm-panels.test.ts`,
  `tests/web/movement-intent.test.ts`, `tests/web/player-runtime.test.ts`.

Responsive layout is CSS, never user-agent sniffing, and panel state is UI-only: never store it,
never send it, never let it gate a game rule.

Read `docs/decisions/0014-trees-and-repeating-harvests.md` before editing tree definitions, the
repeating cycle, cross-occupancy, or either tree settlement.

- Domain rules and the derived cycle: `packages/domain/src/tree.ts`; identifiers are
  `TreeDefinitionId` (`tree_*`) and `TreeInstanceId` (`treeinst_*`) in `packages/domain/src/ids.ts`.
- Values: `packages/game-data/src/trees/index.ts`, with the sapling and fruit items in
  `packages/game-data/src/items/index.ts` and their market rows in `packages/game-data/src/shops/index.ts`.
- Persistence: `database/migrations/0008_tree_instances.sql` (both tables, the two settlements, and
  the two cross-occupancy triggers) and `tests/integration/tree-migration.test.ts`.
- Use cases: `packages/application/src/trees.ts` (plant, harvest, remove, both catalogue reads, and
  the projector), with routes in `workers/api/src/handler.ts` and wiring in
  `workers/api/src/runtime.ts`.
- Client: `apps/web/src/api.ts`, `apps/web/src/selection.ts`, `apps/web/src/render/view-model.ts`
  (`SceneTree` and the `plantable = SOIL && crop === null && tree === null` rule), and
  `apps/web/src/render/scene.ts`. Tests: `tests/web/tree-ui.test.ts`.

Never let a client name a tree's reward, its sapling, or its readiness: the cycle is derived from
server timestamps, and one cycle settles at most once.

Read `docs/decisions/0010-farm-expansion.md` before editing plot geometry, land prices, expansion
settlement, or the plot API. The domain rule is `packages/domain/src/plot.ts`, values are in
`packages/game-data/src/plots`, the use cases are in `packages/application/src/plot.ts`, and the
atomic D1 write is `D1FarmExpansionRepository`. A client command may carry only a request ID.

## Seed economy, uproot, and i18n (Phase 5)

Read `docs/decisions/0013-phase-5-seed-economy.md` before editing seed definitions, shop pricing,
the planting settlement, the starter grant, uprooting, or the client's translation layer, and
`docs/decisions/0020-starter-package-and-alpha-repair.md` before editing the starter package itself.

- Seed mapping and item categories: `packages/game-data/src/items/index.ts` and
  `packages/game-data/src/crops/index.ts`; shop directions and prices:
  `packages/game-data/src/shops/index.ts`. Domain shapes: `ItemCategory` in
  `packages/domain/src/inventory.ts`, `CropDefinition.seedItemDefinitionId` in
  `packages/domain/src/crop.ts`, `ShopEntry`/`calculateShopTotal` in `packages/domain/src/economy.ts`.
- The planting settlement: `PlantCrop` in `packages/application/src/crops.ts` and
  `D1CropRepository.plantAtomically` in `workers/api/src/d1-repositories.ts`. Uprooting is
  `UprootCrop` in the same file with `D1CropRepository.removeAtomically`.
- The one-time starter package: `packages/game-data/src/starter/index.ts`,
  `GrantStarterPackage` in `packages/application/src/starter.ts`, `D1StarterGrantRepository`, and
  `database/migrations/0009_starter_package.sql`. The deployed onboarding step
  (`workers/api/src/player-onboarding.ts`, wired in `workers/api/src/index.ts`) calls it, and so does
  the development host (`workers/api/src/dev-index.ts`); there is no grant route and none may be
  added. `STARTER_GRANT_POLICY` decides whether it is offered to new players only (the default) or to
  any player without a receipt (staging).
- Repairing players who predate the package: `scripts/repair/starter-package-backfill.mjs`
  (dry run by default, staging-only, `--apply` to write).
- Contracts and routes: `packages/contracts/src/index.ts`, `workers/api/src/handler.ts` (including
  the uproot route), `apps/web/src/api.ts`.
- The client's language layer is `apps/web/src/i18n.ts`; the dock's planting rules are
  `apps/web/src/selection.ts`; the level readout is `apps/web/src/progression.ts`. Tests:
  `tests/web/i18n.test.ts`, `tests/web/farm-selection.test.ts`,
  `tests/application/starter-seed.test.ts`, `tests/application/uproot-crop.test.ts`,
  `tests/integration/seed-economy-migration.test.ts`.

Never let a client name a seed item, a price, or a refund, and never add a second inventory mutation
path: planting spends a seed through `InventoryService` inside the crop-insert transaction.

## Local development / playable UI task

Read `docs/development.md` first, then `docs/decisions/0006-starter-land-and-node-dev-host.md`.

- UI only: `apps/web` (`api.ts`, `main.ts`, `i18n.ts`, `vite.config.ts`) and the contracts it consumes.
- Development backend: `workers/api/dev/` plus `workers/api/src/dev-index.ts` and `dev-auth.ts`.
- Farm land: starter-land section of `docs/DATA_MODEL.md` and the Phase 3.5B section of `docs/protocols.md`.
- Tests: `tests/api/dev-auth.test.ts`, `tests/integration/dev-host.test.ts`, `tests/integration/d1-starter-land.test.ts`.

Do not read economy settlement internals unless the task changes shop behaviour, and never weaken
`workers/api/src/index.ts` fail-closed production authentication to make local development easier.

## Database/migration task
- `docs/DATA_MODEL.md`
- affected repository interfaces/implementations
- current latest migrations only as needed
- `.agents/skills/security-review/SKILL.md`

## Multiplayer/Durable Object task
- `docs/architecture.md`
- `docs/protocols.md`
- permission section in `docs/PROJECT_SPEC.md`
- `.agents/skills/security-review/SKILL.md`
- affected FarmRoom/contracts/tests

## Frontend/rendering task
- `docs/architecture.md` rendering boundary
- relevant contracts
- only target `apps/web` modules
Do not inspect backend internals unless the contract is insufficient.

### 3D renderer work (Phase 3.6A and later)

Read `docs/decisions/0007-renderer-foundation-and-plain-typescript-client.md`, then
`apps/web/src/render/layout.ts`, then `apps/web/src/render/view-model.ts`, before
`apps/web/src/render/scene.ts`.

- Pure geometry and its tests: `apps/web/src/render/layout.ts`, `tests/web/farm-layout.test.ts`.
- Pure state-to-descriptor mapping and its tests: `apps/web/src/render/view-model.ts`,
  `tests/web/farm-view-model.test.ts`.
- World map and camera: read `docs/decisions/0012-farm-world-map-and-camera.md`. Pure world
  geometry (island, apron, path, locked ring, deterministic scenery) and its tests:
  `apps/web/src/render/world.ts`, `tests/web/farm-world.test.ts`. Shared geometry and materials:
  `apps/web/src/render/materials.ts`; static ground, water, fence, pond, barn, and locked squares:
  `apps/web/src/render/terrain.ts`; decorations: `apps/web/src/render/scenery.ts`.
- Crop model manifest and its tests: `apps/web/src/render/assets.ts`,
  `tests/web/farm-assets.test.ts`. Model files, the generator, and the authoring contract they are
  held to: `apps/web/src/assets/models/`, `apps/web/tools/generate-placeholder-models.mjs`,
  `tests/integration/crop-model-assets.test.ts`. Bundled model URLs live in
  `apps/web/src/render/model-urls.ts`, the one client module a unit test cannot load.
- three.js, canvas, sizing, picking, disposal, the model cache: `apps/web/src/render/scene.ts`.
- Only `FarmSceneHandle` crosses into `apps/web/src/main.ts`. Do not import three anywhere else in
  the client, and do not let the renderer fetch or compute game state; new rendering rules belong in
  `view-model.ts`, where they can be tested without a WebGL context.

## Game-data/content task
- relevant schema/type in `packages/game-data`
- validation tests
Do not inspect renderer/backend unless the definition contract changes.

## Admin/security task
- `docs/DATA_MODEL.md`
- `.agents/skills/security-review/SKILL.md`
- relevant auth/authorization/audit modules

## Forbidden broad scan by default
Do not recursively inspect `node_modules`, build outputs, caches, R2 assets, 3D models, generated files, or every reference repo. Use search first, then open only relevant files.

## HUD and panel architecture (UI redesign)

Read `docs/decisions/0018-game-hud-and-panel-architecture.md` before editing the HUD, the module rail, panels, the market rows, the inventory grid or the action surface.

- State machine: `apps/web/src/panels.ts` (`MODULES` registry, `activePanel`, open/close/toggle, breakpoint).
- Presentation: `apps/web/index.html` and `apps/web/src/styles.css` (tokens, one surface hierarchy, three breakpoints); `main.ts` owns `renderPanels`/`renderShop`/`renderInventory`/`renderActionControls`.
- Tests: `tests/web/farm-panels.test.ts`, `tests/web/i18n.test.ts`.

Panels are presentation: never store, send, or gate gameplay on panel state, and never render a second copy of inventory or market data.

## Staging deployment foundation

Read `docs/deployment.md` before touching the deployed entrypoint, the Access authenticator, the staging config, or static asset routing.

- Entrypoint: `workers/api/src/index.ts` (`/api/*` ? handler, everything else ? `ASSETS`).
- Access auth: `workers/api/src/access-auth.ts` (JWKS-verified JWT, deterministic `player_<uuid>` from `(issuer, subject)`, fail-closed without config).
- Onboarding: `workers/api/src/player-onboarding.ts` (one Player row per verified visitor, plus the
  one-time starter package; the policy is `STARTER_GRANT_POLICY`, default `NEW_PLAYERS`).
- Boundary: `workers/api/src/staging-routing.ts`; config: `workers/api/wrangler.staging.toml` (staging D1 + `[assets]`).
- Tests: `tests/api/access-auth.test.ts`, `tests/api/staging-routing.test.ts` (includes an import-graph proof that the deployed entrypoint cannot reach the dev bridge).

Never add an identity path that trusts a client-supplied value, never import the dev bridge into the deployed entrypoint, and never point staging at a production database.
