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

## Farming progression (V14.4)

Read `docs/design/FARMING_PROGRESSION.md` before changing an experience value, the level curve, a
catalogue `requiredLevel`, the harvest settlement, or the level-up feedback. The mechanics are
ADR 0008 (experience and levels) and ADR 0009 (crop unlocks); V14.4 adds discovery, and ADR 0028
records why it is a diff over the served catalogue rather than a table or a new DTO field.

- Unlock diff (pure, presentation): `apps/web/src/unlocks.ts` (`unlockNotices`, `levelUpFeedback`,
  `LEVEL_UP_DURATION_MS`), tested by `tests/web/unlock-discovery.test.ts`.
- Feedback wiring: `showLevelUp` and the two harvest paths in `apps/web/src/main.ts`, the `#level-up`
  element in `apps/web/index.html`, and the V14.4 section of `apps/web/src/styles.css`. Strings:
  `levelUp.title`, `levelUp.unlocked`, `levelUp.separator` in `apps/web/src/i18n.ts`.
- The loop and its thresholds: the progression case in `tests/api/farming-loop.test.ts` proves
  buy-ahead -> harvest -> experience -> exact-threshold level-up -> plant the newly unlocked crop
  through the real API, and `tests/domain/progression.test.ts` covers a multi-threshold award.

Never add a hardcoded level-to-content table: a notice is a diff of the catalogue the server sent,
and the planting gate (`PlantCrop` / `PlantTree`) stays the only thing that decides eligibility.

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
  `buildLandmarks` places each one on the ground it stands on (`terrainHeightAt`, the same function
  the terrain mesh, the scenery and collision use) - a landmark on a slope must not be drawn at the
  flat ground plane. `blockingRadiusWorld` is the circle a *walker* goes around, and the optional
  `keepClearRadiusWorld` is the bigger circle a building whose parts overhang declares (the
  windmill's sails); `world.ts` sweeps the finished scenery list against the latter, dropping a
  placement whose own half-width reaches in.
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
- Roads: `apps/web/src/render/roads.ts` (waypoints to a terrain-following centreline: straight runs
  between the authored waypoints, joined by a circular fillet at each interior corner, walked at a
  fixed arc-length step) and `addRoads` in `terrain.ts` (the ribbons, cobbles, shoulders and verge
  stones). A road's shape is the author's alignment and nothing else - do not reintroduce a spline
  through the waypoints, which turns a corner over the segments on either side of it.
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
  The starter alignment itself is three waypoints in `ROADS` (`harbour_spine`: the quay, the one
  corner at the yard, the village entrance just inside the paving); its last sample sits *under* the
  plaza surface so the square reads as paved rather than painted, and every road that reaches the
  square leaves from its rim, not from its middle.
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
- The build catalogue is two modules: `placement/schema.ts` is the rules (what an entry may say, and
  what makes a catalogue valid) and `placement/catalog.ts` is the content - the rows that ship, built
  from the assets that actually exist. Read `docs/V12_3_ASSET_CATALOGUE.md` before adding, replacing
  or re-pricing a placeable asset; it records every model, its level, its price and its status.
- The catalogue reaches the client through `GET /build-catalog`
  (`workers/api/src/build-catalog.ts`), which is read-only reference data like `/crop-definitions`.
  The Build panel in `apps/web/src/main.ts` is a *catalogue*, not a shop: placing an object is a
  command the server does not accept yet, and the panel says so.
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
  A local database written before one-farm-per-player (`0014`) can hold several farms for one player,
  which the unique index cannot be created over. `workers/api/dev/repair-farm-ownership.ts` resolves
  that before the migrations run - one farm kept per owner, the rest removed with their farm-scoped
  rows - and the dev server logs what it did. Never "fix" it by deleting the local database, dropping
  the index, or letting a player keep two farms.
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

### Build shop, thumbnails, placement preview, and road presentation (V12.4)

Read `docs/design/V12_4_VISUAL_BUILD_SHOP.md` and `docs/design/V12_5_CONSTRUCTION_SHOP_UX.md` before
changing the build panel, the shop's browsing state, the thumbnail renderer, placement mode, or the
road's surface.

- Shop UI: `apps/web/src/build-shop/shop-state.ts` (categories, availability, search, rotation - pure
  and tested), `apps/web/src/build-shop/shop-view.ts` (rail, cards, inspector), and the wiring in
  `apps/web/src/main.ts` (`renderBuildPanel`, `enterPlacement`, `rotatePlacement`, `renderPlacementHud`),
  plus `apps/web/index.html`, `apps/web/src/styles.css`, `apps/web/src/icons.ts`, `apps/web/src/i18n.ts`.
- Thumbnail source for the shop: `apps/web/src/build-shop/shop-thumbnails.ts` - one renderer, one URL
  cache, so the card and the inspector share a picture. The shop renders itself when the panel opens,
  so a session that never opens it never creates the renderer.
- Thumbnails: `apps/web/src/render/thumbnail.ts` (the one offscreen renderer) and
  `apps/web/src/render/thumbnail-spec.ts` (the pure cache key, framing rule, and road tier previews).
- Shared model cache: `apps/web/src/render/model-library.ts` - one `loadModel(modelId)` for the world,
  the thumbnails, and the ghost. Do not add a second loader or a second URL table.
- Placement preview: `apps/web/src/render/placement-preview.ts` (the pure validity rule over the
  WorldCell map) and the `setPlacementPreview` half of `apps/web/src/render/scene.ts`.
- Road presentation: `apps/web/src/render/road-surface.ts` (cross-section, edge wave, shoulder
  profile), `apps/web/src/render/roads.ts` (`ROAD_LIFT_WORLD`), `apps/web/src/render/materials.ts`
  (the road's polygon offset), and the bed heights in `apps/web/src/render/terrain.ts`.
- Tests: `tests/web/build-thumbnails.test.ts`, `tests/web/build-placement-preview.test.ts`,
  `tests/web/road-visual-quality.test.ts`.

Placement is **preview only**. Price, level, footprint, tier, and unlock condition come from
`GET /build-catalog` and must never be restated in the client, and no purchase or placement command
exists yet.

### Persistent construction, economy and functional assets (V13)

Read `docs/design/V13_CONSTRUCTION_SYSTEM.md` before changing construction; `V13_ECONOMY_FOUNDATION.md`
before changing a price, a yield or a capacity; `V13_FUNCTIONAL_ASSETS.md` before adding a catalogue
entry; and `V13_ROAD_V2.md` before touching a road's width or footprint.

### Freeform island building (V13.2)

Read `docs/design/FREEFORM_ISLAND_BUILDING.md` before touching placement, ownership, footprints,
occupancy, rotation, movement, removal or refunds. Its first principle is the one to keep:
**land use is chosen by the player, not predetermined by the map.**

- An ordinary owned cell takes an ordinary asset. Placement reads *ownership* (`farm_tiles`),
  *terrain* (the asset's own `allowedTerrain`), *footprint* and *occupancy* - and nothing else. Never
  reintroduce a FARM / FORESTRY / BUILD / DECORATION district or capability requirement for a normal
  land asset, and never treat the plot reservation (`FARM_FIELD_BOUNDS`) as ownership: `owned` on a
  `WorldCell` is the server's rows, and the reservation is only which land the catalogue could sell.
- Editing: `RelocateConstruction` (move and rotate) and `RemoveConstruction` in
  `packages/application/src/construction.ts`; routes
  `POST /farms/:farmId/constructions/:id/{move,rotate,remove}`; persistence in
  `D1ConstructionRepository.relocateAtomically`/`removeAtomically`; the update-time ground triggers
  and the `CONSTRUCTION_REFUND` ledger reason in `database/migrations/0011_construction_editing.sql`.
- The asset's own policy decides: `allowedTerrain`, `rotatable`, `movable`, `removable` and
  `removalRefundRate` in `packages/game-data/src/placement/`. The refund is computed server-side from
  the definition; a client may only preview the same arithmetic.
- Client: the object panel and move ghost in `apps/web/src/main.ts` (`selectObject`, `beginMove`,
  `confirmMove`, `rotateSelectedObject`, `confirmDelete`), object picking and the editing mark in
  `apps/web/src/render/scene.ts`, and the preview rule in
  `apps/web/src/render/placement-preview.ts`.
- Interaction decisions are their own pure modules, because the first live session broke there rather
  than in the rules: `apps/web/src/render/object-picking.ts` (a raycast hit walks its ancestors to the
  node carrying `userData.constructionId`; `tapTargetFor` states that placement wins over selection)
  and `apps/web/src/object-editing.ts` (`editableActions`, `refundPreview`, `selectedRow` - the
  selection is an **id**, never a row, because every poll replaces the rows - and
  `ownedCells`/`ownershipOverlayFor`/`ownedBounds` for the ownership mark).
- The ownership mark is drawn only while placing or moving (`scene.setOwnershipOverlay`, one instanced
  quad per owned cell, one draw call) and the placement HUD carries its legend. Normal play shows no
  grid, ever. `?debug=1` adds the owned bounds and the cell in hand to the HUD.
- Tests: `tests/domain/construction.test.ts`, `tests/web/build-placement-preview.test.ts`,
  `tests/web/object-editing.test.ts` (picking through a real raycaster, tap priority, action policy,
  selection by id, the ownership mark, one placement command), `tests/web/world-cell.test.ts`
  (ownership vs reservation), and the construction describe blocks in `tests/api/handler.test.ts`
  (placement, move, rotate, removal, refunds and cross-player checks against a real database and its
  triggers).

- Construction rules (pure): `packages/domain/src/construction.ts` - rotation, bounds, collisions,
  every refusal - plus the id in `packages/domain/src/ids.ts`. The ground rule itself is
  `groundRefusal`, shared by placing, moving and turning; read the freeform section below before
  changing it.
- Use case: `packages/application/src/construction.ts` (`PlaceConstruction`,
  `ListFarmConstructions`, and - since V13.2 - `RelocateConstruction` and `RemoveConstruction`) and
  the `ConstructionRepository` port in `packages/application/src/ports.ts`.
- Persistence: `database/migrations/0010_farm_constructions.sql` (the table, its ownership and
  collision triggers, and the rebuilt ledger that admits the `CONSTRUCTION` reason) and
  `0011_construction_editing.sql` (the same rules on UPDATE, and the `CONSTRUCTION_REFUND` reason),
  with `D1ConstructionRepository` in `workers/api/src/d1-repositories.ts`.
- API: `POST` and `GET /farms/:farmId/constructions`, plus `POST .../:id/move|rotate|remove`, in
  `workers/api/src/handler.ts`; the DTOs and the strict request schemas are in
  `packages/contracts/src/index.ts`.
- Functional asset metadata: `packages/game-data/src/placement/gameplay.ts`; road width and the
  footprint contract: `packages/game-data/src/roads/index.ts`.
- Client: `apps/web/src/api.ts`, the placement confirm flow in `apps/web/src/main.ts`, the
  `setConstructions` half of `apps/web/src/render/scene.ts`, and the inspector's "What it does" in
  `apps/web/src/build-shop/shop-view.ts`.
- Tests: `tests/domain/construction.test.ts`, `tests/game-data/placement-gameplay.test.ts`, and the
  construction describe block in `tests/api/handler.test.ts`.

Construction is server-authoritative: the client sends a catalogue entry id, a cell and a rotation,
and never a price, a level, a footprint or an effect.

### Universal editable world objects (V13.3)

Read `docs/design/UNIVERSAL_WORLD_OBJECTS.md` before touching the starter layout, the object
definitions, storage, refunds, or what the renderer draws from rows. Its principle is the one to keep:
**the starter map is a starting arrangement, not a permanent map.**

- Shared world data, consumed by both the renderer and the API:
  `packages/game-data/src/world/` - `geography.ts` (`classifyTile`, `islandRadiusAt`, `volcanoZoneAt`,
  the island/volcano shapes and the plaza and harbour predicates), `objects.ts`
  (`WORLD_OBJECT_DEFINITIONS`: presentation, footprint, `allowedTerrain`, the edit policy, the refund
  rate, `system`), `starter.ts` (`STARTER_WORLD_VERSION`, `STARTER_WORLD_PLACEMENTS`). Never keep a
  second copy of these numbers in the client.
- `farm_constructions` is the one table of active world objects: `state ACTIVE|STORED`,
  `source STARTER|PLAYER_PLACED`, `owner_player_id`, `placement_key`, `paid_amount`, `stored_at`,
  `version`. `database/migrations/0012_world_objects.sql` rebuilt it and added
  `farms.starter_world_version`; the ownership, overlap and crop/tree triggers apply to `ACTIVE` rows
  only, which is what lets a stored object occupy no ground.
- Seeding: `SeedStarterWorld` (`packages/application/src/construction.ts`), version-guarded and
  idempotent, run from `ListFarmConstructions` so an existing farm is migrated by its first read.
  Seeding only ever *adds*: it must never reconcile an object the player has edited.
- Editing: `RelocateConstruction`, `StoreConstruction`, `RestoreConstruction`, `RemoveConstruction`;
  routes `POST /farms/:farmId/constructions/:id/{move,rotate,store,restore,remove}`. A refund is
  `floor(paidAmount x removalRefundRate)` - the cost basis, never the catalogue price, so a free
  starter object can never be turned into gold.
- Client: `apps/web/src/world-objects.ts` (presentation, policy, refund preview, storage stacks),
  the object panel and storage list in `apps/web/src/main.ts` (`storeSelectedObject`,
  `beginRestore`, `renderBuildStorage`), and the model size the scene now applies per instance.
- Tests: `tests/game-data/world-objects.test.ts` (the layout is dry land, outside the reservation,
  keyed and non-overlapping), `tests/web/world-objects.test.ts` (presentation, policy, cost-basis
  refunds, storage stacks) and the starter-island block in `tests/api/handler.test.ts` (seeded once,
  existing-farm migration, move/store/restore/remove, zero refund, cross-farm isolation).

Not editable yet, with reasons in the design doc: roads, the field fence, water objects, ambient
scenery, and the remaining authored landmarks and composition props.

### Complete object coverage (V13.3.1)

Human browser QA found that the architecture worked but the *coverage* did not: a pine, a broadleaf
tree, a bush or a village building still selected the ground under it. V13.3.1 promotes what a player
sees as an individual object, so read the V13.3 section above first and then these four facts.

- **Procedural scenery is persistent.** `packages/game-data/src/world/starter-v2.ts` is *generated*
  from the renderer's deterministic world model (344 placements: the forest, the buildings, the set
  dressing). `tests/codegen/starter-world-v2.test.ts` rebuilds the world and asserts the two still
  agree - change the scatter and it fails, so regenerate rather than ship a different island.
- **Anchors may be fractional.** `farm_constructions.anchor_x/anchor_y` hold a *position*; SQLite's
  INTEGER affinity stores 42.5 as REAL, and `constructionBounds` floors the anchor so the occupied
  *cells* stay whole. `rotation` is the player's quarter turn; a placement's `baseYaw` is the facing
  the island authored. See `database/migrations/0013_world_objects_v2.sql`, which also lets two
  `STARTER` rows nest (the scatter does) while a player's edit still respects everything standing.
- **Everything is drawn from rows, instanced.** The construction layer groups rows by model into
  `InstancedMesh` batches and writes an instance-to-object table under `constructionIds`
  (`apps/web/src/render/object-picking.ts`); landmark-kind rows are built by `buildLandmarkNode`. The
  renderer's static pass must not draw a landmark, the barn or a prop - `apps/web/src/render/terrain.ts`
  deliberately does not.
- **Collision comes from the definitions.** `objectObstacles(rows, frame, definitions)` uses each
  definition's `collisionRadiusWorld`; the barn and the landmarks are out of `STATIC_OBSTACLES` (they
  are rows now), and `CAMERA_BLOCKER_OBSTACLES` exists only so the camera keeps out of a building.

Still not editable, with reasons in the design doc: roads, the field fence, water objects, micro
scenery (flowers and tufts), wild growth on locked plots, and the production tree/crop lifecycle.

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

The Build module is a V12.4 card shop rather than a row list: read
`docs/design/V12_4_VISUAL_BUILD_SHOP.md` before changing `renderBuildPanel`, the thumbnail renderer, or
the placement preview.

## Dual camera and character view (V13.4)

### Mobile playtest (V13.5)

Read `docs/design/MOBILE_INPUT.md` before touching the joystick, the touch camera or anything that
decides movement, and `docs/design/MOBILE_UI.md` before touching the responsive layout. The invariant
is: **one world, one gameplay controller; mobile is another input and presentation adapter.**

- Capability, not user agents: `apps/web/src/mobile/capability.ts` separates *input* (`coarse`: the
  primary pointer is a finger - decides whether the touch controls exist) from *layout* (`compact`: the
  viewport is small - decides which CSS applies). Its numbers (900 px wide, 500 px short side) are the
  stylesheet's own breakpoints. A touchscreen laptop keeps its desktop controls.
- The joystick (`apps/web/src/mobile/joystick.ts`) is a fixed stick: a pure tracker (dead zone, analog
  magnitude, magnitude clamped to one, one owned pointer id) plus a thin DOM binder that writes one
  `translate3d`. It produces `CharacterMoveIntent` and knows nothing else. The same file provides the
  press-and-hold Run control.
- Composition: `composeCharacterInput` in `apps/web/src/player/character-input.ts` - **a deflected
  touch stick wins, otherwise the keyboard does** - so two inputs at once can never double the speed.
  Both feed the same `cameraRelativeMovement` → `stepPlayer` path; there is no mobile controller.
- Touch gestures are owned structurally: the controls are DOM elements over the canvas, the joystick
  owns one pointer id, and `apps/web/src/render/pointer-gesture.ts` still arbitrates tap / drag / pinch
  (a drag or a pinch can never end in a selection). One-finger drag orbits the active rig in both
  views; pinch zooms it; panning stays a mouse gesture.
- Quality by capability: `deviceQualityProfile` in `apps/web/src/render/render-quality.ts` gives a
  coarse-pointer touch device the `MOBILE` preset (DPR cap 1.4, half-size shadow map, no
  micro-scenery); `?quality=low` still wins.
- Tests: `tests/web/joystick.test.ts` (geometry, dead zone, analog, clamp, ownership, every kind of
  release, the DOM binder's cleanup and single binding), `tests/web/mobile-capability.test.ts`
  (desktop / phone / hybrid / tablet / narrow desktop), the composition and same-path cases in
  `tests/web/character-movement.test.ts`, and the quality-profile cases in
  `tests/web/render-quality.test.ts`. Real-device QA is still outstanding: see
  `docs/qa/MOBILE_PLAYTEST.md`.

Read `docs/design/PLAYER_CHARACTER.md` **and** `docs/design/DUAL_CAMERA_CHARACTER_MODE.md` before
touching the avatar, its animation, or the camera that follows it.

### Estate follow camera + compact selection surface (V13.6.3)

Read the "V13.6.3" section of `docs/design/DUAL_CAMERA_CHARACTER_MODE.md` and the V13.6.3 section of
`docs/design/MOBILE_UI.md` before touching the estate camera's target, the recenter control, the
selection surface, the top bar, or the mode-transition rules. Two invariants:
**the estate camera either follows the player or stays where the player put it**, and
**character view is movement/interaction while estate view is precise work** - so a precision action
asked for from character view switches the view and aims it, rather than refusing.

- Follow/free state machine (pure): `apps/web/src/render/estate-follow.ts`
  (`estateFollowAfterManualInput`, `estateFollowForMovement` with its 2 s quiet period,
  `estateFollowRecenter`, `estateFollowAfterFocus`). A manual orbit or pan enters FREE; zoom
  deliberately does not.
- Motion: `createOrbitCamera(...).followTo` / `recenterTo` in `apps/web/src/render/camera.ts`, with
  `smoothingFactor` (delta-time-independent, 250 ms frame clamp) and a distance-based `isSettling()`
  so a camera following a standing player runs no frames.
- Scene wiring: `setCameraMode(mode, focus?)`, `recenterEstateCamera()`, `estateFollowBehaviour()` and
  the `onEstateFollowChange` callback in `apps/web/src/render/scene.ts`; the host mirrors the state in
  `apps/web/src/main.ts` (`recenterCamera`, the `R` key, `beginPrecisionAction`).
- Precision rules (pure): `apps/web/src/render/precision-action.ts` (`precisionFocusFor`,
  `groundTapOpensContext`).
- Selection surface state (pure): `apps/web/src/dock.ts` (`dockPresentationFor` ->
  `HIDDEN` | `STRIP` | `SHEET` | `FULL`); markup and layout in `apps/web/index.html`
  (`#dock-expand`, `#hud-menu`, `#hud-menu-toggle`, `#camera-recenter`) and the V13.6.3 section of
  `apps/web/src/styles.css`. The status line auto-clears and moves under the top bar on a compact
  layout.
- Tests: `tests/web/estate-follow.test.ts`, `tests/web/estate-follow-camera.test.ts`,
  `tests/web/precision-action.test.ts`, `tests/web/mobile-hud.test.ts`.

### Character interaction + world contracts (V14.1)

Read `docs/design/INTERACTION_SYSTEM.md` before adding an interaction, changing what counts as "in
reach", or wiring a new kind of target into character view, and `docs/design/WORLD_ARCHITECTURE.md`
before writing anything that assumes a player owns the place they are standing in. The governing
decision is `docs/decisions/0027-zone-aware-interactions.md`. Two invariants:
**discovery looks and execution acts** (nothing that finds a target may mutate anything), and
**a location is not an authorization** (a zone reference describes where a player is; the server still
authorizes every command from the authenticated actor).

- Zone vocabulary (shared, in `packages/contracts`): `ZONE_KINDS`, `ZoneRefSchema`, `homeIslandZoneRef`,
  `farmIdFromHomeIslandZone`. One farm *is* the current `HOME_ISLAND` zone; nothing is duplicated.
- Client context: `apps/web/src/interaction/context.ts` (`GameplayContext`, `homeIslandContext`) keeps
  the player and the place apart.
- Interaction model (pure): `apps/web/src/interaction/model.ts` (actions, kinds, ranges, priorities,
  `InteractionCandidate`, `interactionPromptFor`); adapters + cell-bucketed index in
  `apps/web/src/interaction/registry.ts` (`buildInteractionIndex`, `targetsNear`,
  `worldObjectIsInteractable`); choice, revalidation and the `E` rule in
  `apps/web/src/interaction/selection.ts`.
- HUD and execution: `apps/web/src/main.ts` (`rebuildInteractionIndex`,
  `refreshInteractionCandidate`, `renderInteraction`, `runInteraction`, `inspectTarget`), markup in
  `apps/web/index.html` (`#interaction-prompt`, `#interact-button`), CSS in the V14.1 section of
  `apps/web/src/styles.css`. `E` is arbitrated by `onInteractionKeyRequested` in
  `apps/web/src/render/scene.ts`, so the host decides whether the key interacts or orbits.
- Harvest reuses the existing server-authoritative command; `INSPECT` sends nothing and reuses the
  existing selection surface. Nothing in the interaction layer is authority.
- Tests: `tests/web/interaction-context.test.ts`, `tests/web/interaction-discovery.test.ts`,
  `tests/web/interaction-input.test.ts`, plus the location-smuggling case in
  `tests/api/handler.test.ts`.

### Visual items, inventory and the planting picker (V14.2)

Read `docs/design/ITEM_PRESENTATION.md` before adding an item surface, changing what a card shows, or
drawing an item picture anywhere. Its rules: **one picture pipeline** for the whole page, **no client
item truth**, and **no surface offers an action the domain does not have**.

- The one picture cache: `apps/web/src/items/thumbnails.ts` (`createItemThumbnails`), built on the
  shop's V12.4 renderer (`apps/web/src/render/thumbnail.ts`). It is the only `createThumbnailRenderer`
  caller in the app besides its own module; `apps/web/src/build-shop/shop-thumbnails.ts` is now just
  the shop's wording of a request over the same cache.
- Item visuals and fallbacks (pure): `apps/web/src/items/visuals.ts` (`itemVisualFor`, `cropVisualFor`,
  `seedVisual`, `saplingVisual`). Produce draws the crop's model; seeds, saplings and unknown items use
  sized icon fallbacks. The fallback table is documented in the design doc.
- Inventory + planting decisions (pure): `apps/web/src/items/catalogue.ts` (`inventoryCards`,
  `inventoryCategoryOf`, `inventoryTabs`, `plantOptions`, `rememberedPlantChoice`, `storedCounts`).
- Cards (DOM): `apps/web/src/items/card.ts` (`renderItemCard`, four states, fixed-size thumb box).
  Wired in `apps/web/src/main.ts` (`renderInventory`, `renderPlantPicker`, `plantOptionCard`,
  `choosePlantOption`, `renderPlantAction`, `showRewardPop`), with markup in `apps/web/index.html`
  (`#inventory-tabs`, `#inventory-grid`, `#plant-picker`, `#reward-pop`) and the V14.2 section of
  `apps/web/src/styles.css`.
- Harvest feel (pure): `apps/web/src/interaction/feedback.ts` (`harvestGestureBend`,
  `REWARD_POP_DURATION_MS`); the bow is applied to the avatar's outer group in
  `apps/web/src/render/scene.ts` (`playHarvestGesture`), and readiness is the world's own ring and
  spark over every ripe crop and ready tree.
- Tests: `tests/web/item-presentation.test.ts`, `tests/web/plant-picker.test.ts`,
  `tests/web/harvest-feedback.test.ts`, and the `repeat` case in
  `tests/web/interaction-input.test.ts`.

### The Farm Market and the first economy loop (V14.3)

Read `docs/design/FARM_MARKET.md` before changing prices, the market's presentation, or how a character
reaches it. Its rules: **prices are catalogue data and the server settles every trade**, **one shelf
with two directions** (BUY sells what the catalogue sells, SELL lists only what the player owns), and
**exactly one transaction panel** rather than controls on every card.

- Market decisions (pure): `apps/web/src/market/market.ts` (`marketCards`, `plantingLevelFor`,
  `defaultMarketDirection`, `marketQuantityBounds`, `clampMarketQuantity`, `marketQuantityStep`,
  `marketTotal`, `marketCanSubmit`).
- Presentation: `renderMarket` / `marketCardNode` / `renderMarketTrade` / `submitMarketTrade` /
  `openFarmMarket` in `apps/web/src/main.ts`, with the shelf and the panel in `apps/web/index.html`
  (`#market-grid`, `#market-empty`, `#market-trade`) and the V14.3 section of `apps/web/src/styles.css`.
  It reuses `items/card.ts`, `items/thumbnails.ts` and `items/visuals.ts`; there is no second picture
  pipeline. The old `renderShop` / `shopRow` text rows are gone.
- The settlement path is the pre-existing one: `packages/application/src/shop.ts` and
  `/shop/buy`, `/shop/sell` (`BuyItem`, `SellItem`), ledger reasons `SHOP_BUY` and `SHOP_SELL`. The
  market adds no economy.
- Market Stall: `service: "FARM_MARKET"` on the `world.market_stall` definition
  (`packages/game-data/src/world/objects.ts`), carried in `WorldObjectDefinitionDTO.service` and read
  by the interaction adapter (`apps/web/src/interaction/registry.ts`), which turns it into the `TRADE`
  action (`interaction/model.ts`, `interaction/selection.ts`). No model name or mesh is ever matched.
- Input: while any module panel is open, movement/run/interaction are suppressed and the touch stick is
  put away (`readInput`, `readRun`, `syncTouchControls` and `setActivePanel` in `apps/web/src/main.ts`).
- Tests: `tests/web/market-presentation.test.ts`, `tests/web/market-interaction.test.ts`, and the full
  loop through the real API in `tests/api/farming-loop.test.ts`.

### Farming content and balance (V14.5)

Read `docs/design/FARMING_CONTENT.md` (the roster and each crop's role) and
`docs/design/FARMING_BALANCE.md` (the computed economy) before adding or retuning a crop, a tree, its
items, or its market prices.

- Definitions: `packages/game-data/src/crops/index.ts` (8 crops), `trees/index.ts` (3 trees),
  `items/index.ts` (produce, seeds, saplings), `shops/index.ts` (one buy row per seed/sapling, one
  sell row per produce). The derived figures are `packages/game-data/src/balance.ts`.
- The invariants: `tests/game-data/farming-balance.test.ts` - flat `0.8 xp/min` per crop, net profit
  strictly rising with growth time (so no shorter crop dominates), no pairwise dominance, trees
  below the best crop's gold/min, and no item both bought and sold. `tests/game-data/trees.test.ts`
  holds "two harvests repay the sapling".
- The journey: `tests/api/farming-journey.test.ts` plays starter loop -> threshold -> wheat -> the
  first orchard tree -> a repeated tree cycle -> a second species, through the real API.
- Models: one generated `.glb` per crop (`tools/asset-pipeline/node/specs.mjs`,
  `apps/web/src/render/assets.ts`, `model-urls.ts`); `tests/integration/crop-model-assets.test.ts`
  checks the shipped files. Trees share one canopy and differ by a species fruit colour.
- Static catalogues cost no farm rows: `tests/api/catalogue-read-cost.test.ts`.

### The player character (V13.4.1)

The avatar is presentation, and the authority is the player runtime - never the mesh.

- Asset: `apps/web/src/assets/models/player/player-farmer.glb` (Kenney Mini Characters, CC0; licence,
  measurements and replacement steps in `docs/assets/PLAYER_CHARACTER_ASSET.md`). Imported by
  `tools/asset-pipeline/node/import-kenney-character.mjs`, which embeds the pack's sibling palette and
  **does not** normalise the geometry - this model is skinned, so its size is a presentation concern.
- The one place asset values live: `PLAYER_CHARACTER_ASSET` in `apps/web/src/render/player-character.ts`
  (model id, target height, facing correction, ground offset, animation names, cross-fade). The model
  id resolves through `apps/web/src/render/character-model-urls.ts` and the shared model library.
- Drawing, scale, grounding and animation: `createPlayerCharacterView` - measured bounding box to the
  world's 1.6 m, feet on the ground, one `AnimationMixer`, lazy actions, and a cross-fade only when the
  semantic state changes. State is derived from the pose (`characterAnimationStateFor`), the clip from
  the config (`resolveCharacterClip`), and a missing clip falls back rather than failing.
- The old procedural avatar stays as the fallback, shown (with a console report) when the model cannot
  load. Gameplay must never know which file is drawn: no controller, camera, collision or scene code
  changes when the character is replaced.
- **Boot independence (hotfix):** `createPlayerCharacterView` builds only the fallback and takes no
  loader; `PlayerCharacterView.load(resources)` returns `void` and is called at the *end* of
  `createFarmScene`, after the model library exists. A cosmetic asset may never be awaited by boot -
  the placeholder is on screen from the first frame and a failed load only writes a console line.
  `tests/web/character-boot-order.test.ts` pins the ordering (the scene used to read the library while
  building the character, which threw and left the page at "Preparing 3D world…").
- Tests: `tests/web/player-character.test.ts` (pure mapping, scale, orientation, no-mutation),
  `tests/web/player-character-view.test.ts` (the view against a synthetic model, including fallback),
  and `tests/integration/player-character-asset.test.ts` (the shipped file is self-contained, skinned,
  carries the configured clips, and fits its budget).

Read `docs/design/DUAL_CAMERA_CHARACTER_MODE.md` before touching the camera, the movement input, or
the mode switch. Its invariant is the one to keep: **Estate View and Character View are two ways to
control the same world, not separate game states.**

- Mode state: owned by `apps/web/src/main.ts` (`state.cameraMode`, `setCameraMode`), with the pure
  parts in `apps/web/src/render/camera-mode.ts` (the toggle, the `F` shortcut guard, and the eased
  flight between the two poses). The HUD control is `#camera-mode` in `apps/web/index.html`.
- Two rigs, one camera: the estate rig (`apps/web/src/render/camera.ts`, unchanged) and the character
  rig (`apps/web/src/render/character-camera.ts`). `scene.setCameraMode` never writes to the rig it is
  leaving, which is what preserves the estate viewpoint exactly.
- Movement is an intent, never a keystroke: `apps/web/src/player/character-input.ts` turns the shared
  key state into `CharacterMoveIntent` and then, with the camera's bearing
  (`scene.cameraBearing()`), into a world direction. `stepPlayer` is unchanged apart from an optional
  speed; V13.5's joystick must feed the same intent.
- The ground is `terrainHeightAt`, handed to the runtime through `PlayerRuntime.setTerrain`;
  `slopeBlocks` in `apps/web/src/player/collision.ts` refuses a climb steeper than 45 degrees (a step
  rule, not a physics engine). Walking and looking both read the *rows*; the camera's occluders are
  only the geography and the multi-cell buildings, never the scatter.
- Build/edit integration: opening the Build panel, placing, moving or restoring switches to the estate
  view. Ground click-to-move is off in character view; object selection stays on.
- Tests: `tests/web/camera-mode.test.ts`, `tests/web/character-camera.test.ts`,
  `tests/web/character-movement.test.ts`, and the clear/run cases in `tests/web/player-input.test.ts`.

## Staging deployment foundation

### D1 read cost and remote safety (V14.3.2)

Read `docs/performance/D1_READ_AUDIT.md` before changing the client's refresh/polling behaviour, the
farm read endpoints, or any script that could reach a remote database. It records the incident (the
staging database read 5.83M rows/day and tripped the 5M Free limit), the read-only D1 metrics that
proved the cause, and the cost model.

- The cause was the 2 s client poll reading full lists: `farm_tiles` twice (`/tiles` + `/plots`) and
  `farm_constructions` once per tick, ~1,304 rows/tick, 91.8% of the day's rows.
- The fix: `apps/web/src/polling.ts` (`GROWTH_REFRESH_INTERVAL_MS`, `shouldRefreshGrowth`) plus the
  timer in `apps/web/src/main.ts` - the poll now refreshes only crops and trees, only while the tab
  is visible, and `refreshGrowth` replaces the full `refreshFarm` on the timer. Full reads stay on
  explicit actions.
- Guardrail test: `tests/integration/d1-local-isolation.test.ts` fails if a routine script names
  `--remote` or deploys with `wrangler deploy` without `--dry-run`.
- Policy: LOCAL is sqlite only; STAGING is manual verification only; PRODUCTION is not configured.
  `npx wrangler d1 info` / `d1 insights` are the read-only way to re-check the budget.

### Staging playtest deployment (V13.6)

Read `docs/qa/MULTI_USER_ALPHA.md` before inviting testers. Its invariant is non-negotiable:
**multiple testers does not mean shared authority** - every player-owned read and mutation is
authorized from the authenticated server-side actor, never from an id the browser supplied.

- Identity used to be Cloudflare Access only; **since V13.6.2 the public path is a guest cookie**
  (see "Public guest alpha" below). Access is kept as the stronger path and still wins when a verified
  `Cf-Access-Jwt-Assertion` is present, and neither path trusts a client-supplied identity. Note the
  direction changed: an Access application now *exists* for the canonical custom domain and is what
  the operator must bypass or remove to make it public. Access applications cannot be created or
  removed with the deployment environment's credentials (Workers scopes, not Access scopes).
- **One player owns one farm** (V13.6.1). `CreateFarm` resolves a player's existing farm before
  creating anything, and a unique index on `farms(owner_player_id)`
  (`0014_one_farm_per_player.sql`) makes that true under concurrency; a repeat request answers `200`
  instead of `201`. A phone that loses the response to "create my farm" gets the world it already has.
  A future pass that wants several farms per player drops that index in its own migration.
- Tests: the alpha's own two-tester case in `tests/api/handler.test.ts` (distinct players, farms and
  islands; A buys and only A's gold and ledger move; A edits and B's rows are compared row for row; A
  is refused B's farm with 403) plus "gives a player one farm, however many times they ask for one".

The current build is deployed for real-device testing; read `docs/deployment/STAGING.md` for the URL,
the architecture, the database state and how to deploy or roll back. Two facts to carry forward:

- **Identity on staging is Cloudflare Access**, and the API authenticates only the header Access
  injects - the browser sends no credential by design. The Zero Trust *team* exists, but an Access
  **application for the staging hostname does not yet**, so `/api/*` answers 401 and a phone cannot
  load a farm until that application is created. That step needs the Cloudflare dashboard.
- **A `;` inside a `/* */` block comment breaks Wrangler's statement splitter** ("incomplete input:
  SQLITE_ERROR [code: 7500]"), which is how the first remote migration of `0012_world_objects.sql`
  failed while the repository's own tests passed. Use `--` comments in migrations. The remote staging
  database is now at migrations `0001` - `0015` with its existing players and farms intact.

### Public guest alpha (V13.6.2)

Read `docs/design/IDENTITY.md` before touching identity, sessions, cookies, onboarding, the Access
authenticator, or anything that decides which player a request is. Its invariant:
**a player is the durable owner; an identity only ever answers which player that is.** Guest is an
authentication state, never a throwaway farm, so a later Google/email sign-in attaches a second
identity to the same player instead of founding a new farm.

- **Player vs identity**: `players` keeps its `(auth_issuer, auth_subject)` pair as the *primary*
  identity; `player_identities` (`0015_player_identities.sql`) is the resolution table and may hold
  several identities per player. Pure rules: `packages/domain/src/identity.ts` (`identityKey`,
  `attachIdentity`, `resolveIdentity`); repository: `workers/api/src/player-identities.ts`.
- **Guest session**: `workers/api/src/guest-auth.ts` (32 random bytes from `crypto.getRandomValues`,
  `hf_guest` cookie - `HttpOnly; Secure; SameSite=Lax`, 180 days - only the SHA-256 stored), the
  session port in `workers/api/src/session.ts`, and `GET /session` in `workers/api/src/handler.ts`
  as the *only* route that may create an identity. `GUEST_AUTH_ENABLED = "true"` lives in
  `wrangler.staging.toml` alone, so production stays fail-closed with no `if (staging)` anywhere.
- **Composition**: `CompositeAuthenticator` tries Access first and the guest resolver second; the
  starter package is applied through the same shared use case for both paths
  (`workers/api/src/player-onboarding.ts`).
- **CSRF**: cookies make unsafe requests cross-site-relevant, so `workers/api/src/origin-guard.ts`
  refuses an unsafe request whose `Origin` names another origin (401, before authentication).
- **Client boot**: `apps/web/src/main.ts` (`startSession`, `boot`) calls `/session` first, shows a
  retryable message instead of a stuck "Preparing 3D world…", and `apps/web/src/api.ts` sends
  `credentials: "same-origin"`.
- Tests: `tests/api/guest-alpha.test.ts` (new guest, same-cookie persistence, two guests isolated,
  edited/unknown/truncated credentials, guest-off production behaviour, Access preference,
  cross-origin refusal), `tests/domain/identity.test.ts` (attaching a second identity keeps one
  player), `tests/api/origin-guard.test.ts`.
- **Known limitation**: guest progress depends on keeping the cookie. Clearing site data makes the
  old farm unreachable until an account-linking pass exists; that future conflict/merge policy is
  described in `docs/design/IDENTITY.md` and deliberately not implemented.

Read `docs/deployment.md` before touching the deployed entrypoint, the Access authenticator, the staging config, or static asset routing.

- Entrypoint: `workers/api/src/index.ts` (`/api/*` ? handler, everything else ? `ASSETS`).
- Access auth: `workers/api/src/access-auth.ts` (JWKS-verified JWT, deterministic `player_<uuid>` from `(issuer, subject)`, fail-closed without config).
- Onboarding: `workers/api/src/player-onboarding.ts` (one Player row per verified visitor, plus the
  one-time starter package; the policy is `STARTER_GRANT_POLICY`, default `NEW_PLAYERS`).
- Guest auth: `workers/api/src/guest-auth.ts` (opaque cookie, hashed credential, `/session`), wired
  only when `GUEST_AUTH_ENABLED` is `"true"`.
- Boundary: `workers/api/src/staging-routing.ts`; config: `workers/api/wrangler.staging.toml` (staging D1 + `[assets]`).
- Tests: `tests/api/access-auth.test.ts`, `tests/api/staging-routing.test.ts` (includes an import-graph proof that the deployed entrypoint cannot reach the dev bridge).

Never add an identity path that trusts a client-supplied value, never import the dev bridge into the deployed entrypoint, and never point staging at a production database.
