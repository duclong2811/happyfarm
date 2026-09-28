# Context Index for AI Agents

Purpose: reduce token use and prevent agents from reading unrelated code.

Always read:
1. `/AGENTS.md`
2. This file

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

## Local development / playable UI task

Read `docs/development.md` first, then `docs/decisions/0006-starter-land-and-node-dev-host.md`.

- UI only: `apps/web` (`api.ts`, `main.ts`, `labels.ts`, `vite.config.ts`) and the contracts it consumes.
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
