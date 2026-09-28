# AGENTS.md

## Mission
Build a web-native 3D farming game inspired by Farm Together-style gameplay loops, without cloning proprietary code, assets, UI, names, maps, progression tables, or copyrighted content.

Primary stack:
- Client: React + Three.js / React Three Fiber
- API: Cloudflare Workers
- Realtime multiplayer: Cloudflare Durable Objects + WebSocket
- Persistent data: Cloudflare D1
- Large assets: Cloudflare R2

Game logic, data, economy, security, and persistence must be implemented before final 3D polish.

## Non-negotiable architecture rules
1. Server authoritative for economy, inventory, XP, level, crop maturity, rewards, ownership, permissions, unlocks, production, and shop prices.
2. Frontend sends intent, never authoritative state.
3. Runtime-validate every HTTP/WebSocket payload.
4. Keep domain logic independent from React, Three.js, Workers APIs, D1, Durable Objects, and browser APIs.
5. Use one centralized inventory mutation path and one centralized economy mutation path.
6. Use migrations for every schema change. Never silently rewrite an applied migration.
7. High-value mutations must consider authentication, authorization, idempotency, replay, race conditions, and auditability.
8. Never expose secrets to the client. Never commit real credentials.
9. Prefer small reviewable diffs. Do not perform unrelated refactors.
10. Do not scan the whole repo unless necessary. Follow `docs/CONTEXT_INDEX.md`.

## Dependency direction

```text
apps/web -> packages/contracts

workers/* -> packages/contracts
workers/* -> packages/application
workers/* -> infrastructure adapters where required

packages/application -> packages/domain
infrastructure adapters -> ports/interfaces owned by application/domain
```

The browser communicates with Workers and Durable Objects through HTTPS/WebSocket contracts. Frontend code must never import server application services or repositories.
One deliberate exception exists outside the browser bundle: `apps/web/vite.config.ts` (Node-side
development tooling, never shipped) may reference the development-only Worker host in
`workers/api/dev/` in order to forward same-origin `/api/*` requests during local development. This
is a `devDependency`-style edge and must not grow into runtime browser imports of server code.

`packages/domain` must not depend on React, Three.js, Cloudflare APIs, D1, Durable Objects, browser APIs, transport code, or frontend code. `packages/contracts` must not depend on application or infrastructure.

`packages/game-data` contains definitions and configuration, never player state. It must not depend on frontend or infrastructure and should avoid depending on application. Domain/application code may consume validated game data through explicit interfaces or loaders. Dependency cycles are forbidden.

## Repository boundaries

```text
apps/web/                  # browser client and renderer
apps/admin/                # admin UI
packages/domain/           # pure game rules
packages/application/      # use cases/orchestration
packages/contracts/        # REST/WebSocket DTOs + stable errors
packages/game-data/        # crops/trees/animals/fish/items/buildings/etc.
workers/api/               # HTTP edge API
workers/farm-room/         # Durable Object realtime coordination
database/migrations/       # D1 migrations
tests/                     # unit/integration/security/economy
docs/                      # architecture/spec/protocol/data docs
references/                # read-only reference notes; never production imports
```

## Server-authoritative command pattern
Client may request:

```text
HarvestCrop(farmId, tileId, requestId)
```

Server must:

```text
authenticate actor
-> validate payload
-> authorize farm action
-> load state
-> check crop maturity using server time
-> execute domain rule
-> update inventory/economy atomically
-> write ledger/audit/idempotency record where applicable
-> persist
-> broadcast validated result
```

Never accept client commands such as `AddGold`, `SetXP`, `SetInventory`, `SetCropReady`, `SetPrice`, or `SetReward`.

## Data-driven gameplay
Do not create separate logic classes for crops with identical behavior. Store definitions in `packages/game-data/` and keep instances in persistent state.

Stable IDs use lowercase snake-like namespaces, for example:
- `crop_carrot`
- `item_carrot_seed`
- `building_barn_basic`
- `currency_gold`

Display names are not primary identifiers.

## Time and offline progression
Server time is authoritative. Prefer timestamps such as `planted_at` and calculate elapsed time. Do not maintain one timer/process per crop/tree/animal/machine.

## Economy
All currency mutations use the centralized economy service and produce a ledger record with transaction ID, player ID, currency, delta, reason, reference ID, before/after balances, request ID when relevant, and timestamp.

Client never supplies authoritative price or reward.

## Inventory
All inventory mutations use one service. Validate item existence, ownership, quantity, range, duplicate request, and transaction integrity.

## Authentication and authorization
Authentication proves identity. Authorization proves permission.
- Never trust `playerId`, `userId`, or `ownerId` from a request body as identity.
- Derive actor identity from verified auth context.
- Check resource ownership or explicit farm role/permission for every protected mutation.

Farm roles initially:
- OWNER
- EDITOR
- HELPER
- VISITOR

## Durable Objects
Recommended routing key: `farmId`.
One active farm may map to one `FarmRoom` Durable Object for presence, realtime ordering, permission checks, broadcasts, and temporary session state.

Important account/economy records must still follow the persistent storage rules in `docs/architecture.md`.

## Security gate
For changes affecting auth, permissions, database, economy, inventory, multiplayer, admin, rewards, trading, purchases, progression, or persistent player state, read and apply:

`.agents/skills/security-review/SKILL.md`

## Reference code policy
Before copying code, verify an explicit compatible license. If licensing is missing/unclear, study behavior and architecture, then reimplement cleanly. Production code must not import from `references/`.

## Task workflow
Before coding:
1. Read this file.
2. Use `docs/CONTEXT_INDEX.md` to identify the minimum additional context.
3. State internally: goal, in-scope, out-of-scope, affected files, security risk, migration impact, contract impact.
4. Inspect only the target module, direct dependencies, and relevant tests.
5. Make the smallest coherent change.
6. Run relevant tests.
7. Apply security review when required.
8. Inspect final `git diff`.
9. Report: what changed, why, tests, migrations/contracts changed, remaining risks.

## Definition of done
A task is done only when behavior works, architecture boundaries remain valid, inputs are validated, authorization is enforced, data stays consistent, race/replay risks were considered, tests pass, no secrets were introduced, diff is reviewed, and docs/contracts are updated where needed.

## Priority order
1. Security
2. Data integrity
3. Correctness
4. Architecture boundaries
5. Maintainability
6. Performance
7. Developer convenience
8. Visual polish
