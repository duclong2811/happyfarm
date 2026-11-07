# V16.2.3C1 — Apple Orchard Domain + Production Rate Binding

## Scope

The first perennial producer reuses the existing tree lifecycle and Work Area cell membership. The
authoritative Apple item is `item_apple`, the tree is `tree_apple`, and the existing derived Work Skill
identity is `orchard.apple` (`ORCHARD_APPLE` in product terminology).

Apple Orchard jobs are marked `RATE_PRODUCTION`; existing FARM crop jobs retain the migration default
`LEGACY_ACTION_AUTO`. No HTTP, frontend, NPC, Cargo, timer, market, wallet, or ledger behavior was added.

## Domain rules

`calculateAppleOrchardCapacity` accepts authoritative tree rows, definitions, Work Area cells, and
server time. A tree is eligible only when it is active, an Apple Tree, inside a member cell, and the
existing `calculateTreeProduction` reports `READY`. Stored/deleted rows, immature trees, other species,
and trees outside the area contribute zero. An empty valid orchard is therefore a zero-rate orchard.

The development balance constant is one whole Apple per tree per hour. The source rate is one
aggregate integer rate (`eligible count * rate per tree`), not one settlement loop per tree. The source
model remains renewable and the existing Production Rate settlement writes directly to Warehouse.

`orchardProductionSegments` is the rate-change boundary proof: old rate applies up to the authoritative
change instant and the new rate applies only afterward. This prevents retroactive production on tree
maturity, addition, removal, storage, or deletion. Production Rate's existing cursor, 24-hour cap,
fixed-point remainder, and Warehouse-full blocked latch remain authoritative.

## Persistence and binding

Migration 0029 is sufficient and was not modified or applied remotely. The actor-job execution mode is
persisted in the existing column; the existing production bridge remains `actor_job -> production_assignment
-> production_source`, with its unique actor-job index providing one assignment per job. Binding should
use that existing uniqueness and initialize a new assignment cursor at its activation time; no new
Orchard-specific migration is introduced in C1.

C1.1 adds `EnsureOrchardProductionBinding` in `packages/application/src/orchard.ts` and
`D1OrchardProductionBindingRepository` in `workers/api/src/d1-repositories.ts`. The use case authenticates
and owner-authorizes the farm, loads the job/area/cells/trees server-side, requires `ORCHARD + tree_apple +
RATE_PRODUCTION`, and derives the aggregate rate. It never accepts a client tree count or rate.

The adapter uses deterministic IDs and one D1 `batch()` with `INSERT OR IGNORE`, then validates the
persisted join. Existing `UNIQUE(actor_job_id)` and deterministic source identity make exact retries and
concurrent attempts converge to one assignment and one renewable Apple source. Existing cursor,
remainder, blocked state, and version are read back and never reset. A malformed or cross-farm/wrong-kind
existing join fails closed. Empty orchards persist a valid zero-rate source. No Cargo, actor position,
wallet, market, or legacy crop state is touched.

## Proofs

`tests/domain/orchard.test.ts` proves empty orchards, maturity and area/species/activity filtering, and
rate-change segmentation. Existing Production Rate tests prove Warehouse-full behavior, fixed-point
settlement, blocked-state semantics, and atomic persistence. The focused integration command is currently
environment-blocked here by Vite/esbuild `spawn EPERM`; run locally with:

```text
npx vitest run tests/integration/apple-orchard-production-binding.test.ts
```

## Validation

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `git diff --check`: PASS (pre-existing line-ending warnings only)
- No migration, deployment, or remote database action.

## C2 prerequisites

Wire the authoritative tree/work-area repositories into an application-level Orchard binding command,
create the one renewable source and one production assignment in the same idempotent D1 batch, and
settle/rebase that assignment at each authoritative capacity-change event before persisting the new rate.
