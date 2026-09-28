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
