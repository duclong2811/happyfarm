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

Read `docs/decisions/0010-farm-expansion.md` before editing plot geometry, land prices, expansion
settlement, or the plot API. The domain rule is `packages/domain/src/plot.ts`, values are in
`packages/game-data/src/plots`, the use cases are in `packages/application/src/plot.ts`, and the
atomic D1 write is `D1FarmExpansionRepository`. A client command may carry only a request ID.

## Seed economy, uproot, and i18n (Phase 5)

Read `docs/decisions/0013-phase-5-seed-economy.md` before editing seed definitions, shop pricing,
the planting settlement, the starter grant, uprooting, or the client's translation layer.

- Seed mapping and item categories: `packages/game-data/src/items/index.ts` and
  `packages/game-data/src/crops/index.ts`; shop directions and prices:
  `packages/game-data/src/shops/index.ts`. Domain shapes: `ItemCategory` in
  `packages/domain/src/inventory.ts`, `CropDefinition.seedItemDefinitionId` in
  `packages/domain/src/crop.ts`, `ShopEntry`/`calculateShopTotal` in `packages/domain/src/economy.ts`.
- The planting settlement: `PlantCrop` in `packages/application/src/crops.ts` and
  `D1CropRepository.plantAtomically` in `workers/api/src/d1-repositories.ts`. Uprooting is
  `UprootCrop` in the same file with `D1CropRepository.removeAtomically`.
- The one-time starter grant: `packages/game-data/src/starter/index.ts`,
  `GrantStarterSeed` in `packages/application/src/starter.ts`, `D1StarterSeedGrantRepository`, and
  `database/migrations/0007_seed_economy.sql`. It is called from the development bootstrap in
  `workers/api/src/dev-index.ts`; there is no grant route and none may be added.
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
