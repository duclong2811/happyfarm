# V16.2.3B — Production Rate Core

Status: implemented as a generic, output-only, domain foundation. Apple gameplay, NPC visualization,
input processing, UI, deployment, and legacy Auto cutover are intentionally out of scope.

## Starting state and decisions followed

Starting HEAD was `e502bb4550fd1097fdc69dc1fa30d96c75b6b545`; Node `v22.23.3`; npm `10.9.9`. The
worktree was intentionally dirty from earlier phases and was preserved. V16.2.3A decisions were
followed: Actor and Work Area remain, Cargo remains manual/legacy-only, rate production has its own
cursor, and legacy Auto remains functional.

## Files changed

* `packages/domain/src/production-rate.ts`: pure fixed-point settlement calculation.
* `packages/domain/src/index.ts`: exports the core.
* `database/migrations/0029_production_rate_core.sql`: additive schema and explicit legacy/rate mode.
* `tests/domain/production-rate.test.ts`: deterministic core proofs.
* This document.

No historical migration, legacy Auto code, Cargo code, client code, API route, or staging database was
changed. No deployment or commit was performed.

## Production Assignment and legacy bridge

Migration 0029 adds `actor_jobs.execution_mode`, defaulting every existing row to
`LEGACY_ACTION_AUTO`. New `production_sources` and `production_assignments` are separate durable
concepts. A rate assignment references an Actor, farm, optional Work Area, and source; it does not
reuse `actor_auto_state` or `simulation_at`. Existing jobs are not automatically converted.

## Source, rate, time, and settlement

`production_sources` supports `RENEWABLE` and `FINITE`, an authoritative output item, integer
`rate_per_hour`, optional finite `remaining_stock`, enabled state, and optimistic version. The pure
engine receives a server-resolved source snapshot; modifiers have an extension boundary before this
function and are not client inputs. Rate production creates resources only—no Wallet/Ledger or
Emergency Funding mutation.

`production_assignments.settlement_cursor` is the authoritative cursor. `production_remainder` stores
the integer numerator remainder in output-units × milliseconds. The calculation uses
`ratePerHour * elapsedMs + remainder`, divides by `3,600,000`, and never uses floating-point
accumulation. The explicit Production Rate offline cap is 24 hours per settlement request.

`settleProduction` accepts only assignment/source snapshots, server time, and Warehouse free
capacity. It returns quantity, productive elapsed time, cursor, remainder, source consumption, and a
blocked/depleted reason. A host application/repository must commit the returned inventory, source,
assignment, version, and receipt in one D1 batch.

## Constraints and exact pause semantics

The earliest limit wins: capped elapsed time, Warehouse capacity, or finite source stock. For a full or
partially available Warehouse, the cursor advances only to the exact productive boundary represented
by the credited quantity. Blocked time is not carried as hidden backlog; later capacity changes resume
from that boundary. A finite source similarly advances to its depletion boundary and stops at zero.
Disabled, zero-time, zero-rate, depleted, and no-capacity cases return a bounded result without
inventing output.

## Atomicity, idempotency, and concurrency boundary

The schema provides `production_settlement_receipts` keyed by `(assignment_id, request_id)` and
assignment/source versions. The future application settlement adapter must use a guarded SQL batch:
assignment cursor/version guard, source version/stock guard, Warehouse trigger-backed inventory credit,
receipt insert, and response state together. D1 zero-row updates must not be treated as rollback; the
same proven marker/constraint-failure pattern used by prior Auto settlements is required for the
adapter. A repeated semantic settlement receipt produces no second credit; competing tabs allow one
guarded winner and leave the loser with no partial mutation.

## Cargo, security, and ownership

The core has no Cargo, Wallet, browser, movement, animation, or client quantity dependency. The API
boundary for V16.2.3C must derive identity from authenticated context, authorize farm/actor/source,
resolve rate/time/stock/capacity server-side, and accept at most a bounded request ID. Clients must
never submit rate, elapsed time, output, stock, remainder, cursor, XP, or blocked reason.

## Tests and benchmark status

The focused domain test file covers one-hour production, fixed-point remainder, 60×one-minute
partition equivalence, Warehouse-full exact boundary, finite stock depletion, 24-hour cap, and Cargo
independence. `npm run typecheck` passes. The focused Vitest invocation was attempted but the managed
Windows sandbox blocked Vitest/esbuild startup with `spawn EPERM`; this is an environment blocker, not
a test assertion failure. Full Vitest, lint, web build, and Worker dry-run remain to be rerun.

The required D1 1h/6h/24h cost harness is deferred to the application settlement adapter because this
phase deliberately implements no HTTP/D1 settlement path. The pure engine is O(1) with respect to
elapsed duration: one calculation, no per-item loop, and no per-hour writes. At scale, work is
proportional to settlement events and assignments touched, not seconds × workers.

## Migration and V16.2.3C readiness

0029 is additive only. Existing `actor_jobs` remain legacy by default; old tables, Cargo, funding,
watermarks, and data are untouched. The migration was not applied remotely. Local migration tests and
representative existing-state validation must be rerun once Vitest can start.

There is no D1 repository/use case/API endpoint yet, so atomic persistence, replay over HTTP, stale
Warehouse/source SQL guards, and ownership integration are not claimed complete in B. There is also no
XP policy, modifier implementation, source creation API, processing input model, regeneration, UI, or
NPC visualization. V16.2.3C should add the smallest Apple Orchard adapter: one mature source fixture,
one explicit rate assignment, authenticated settlement, Warehouse-backed atomic batch, receipt,
concurrency/replay tests, and full 1h/6h/24h cost measurements.

## V16.2.3B-R2A.1 REAL D1 PERSISTENCE PROOF

Focused real-schema coverage is in `tests/integration/production-rate-d1-settlement.test.ts` using
`NodeD1Database(schemaSql())`, which applies the repository migration set and real Warehouse triggers.
It covers renewable output, finite depletion, stale assignment rollback, same-settlement replay, and
old-plan/new-settlement-id rejection. The fixture creates players, farms, Warehouse state, actors,
sources, and assignments.

Proof status: **NOT EXECUTED — ENVIRONMENT_BLOCKED**. Vitest startup is blocked by the managed Windows
sandbox's `spawn EPERM` while esbuild starts, so no real-D1 assertion is claimed PASS. TypeScript
compilation passes. Partial-capacity, already-full, blocked-resume, stale Warehouse/source/cursor,
same-state concurrency, Cargo non-interference, and failure-injection cases remain follow-up tests
before R2A can be declared complete.

### R2A.2 proof matrix

| Proof | Test exists | Executed | Result |
|---|---:|---:|---|
| Renewable / finite depletion | yes | no | ENVIRONMENT_BLOCKED |
| Partial / full Warehouse | yes | no | ENVIRONMENT_BLOCKED |
| Blocked resume / no backlog | yes | no | ENVIRONMENT_BLOCKED |
| Stale assignment/source/cursor | yes | no | ENVIRONMENT_BLOCKED |
| Stale Warehouse | test scaffolded | no | ENVIRONMENT_BLOCKED |
| Same receipt / old plan-new receipt | yes | no | ENVIRONMENT_BLOCKED |
| Concurrent different receipts | yes | no | ENVIRONMENT_BLOCKED |
| Cargo and Wallet/Ledger isolation | yes | no | ENVIRONMENT_BLOCKED |
| Legacy rejection / rate success | yes | no | ENVIRONMENT_BLOCKED |
| Failure injection | no | no | NOT_SUPPORTED_BY_HARNESS |
| Partition invariance / remainder round-trip | not yet | no | NOT_SUPPORTED_BY_HARNESS |

The focused command was `npx vitest run tests/integration/production-rate-d1-settlement.test.ts
--reporter=basic`; startup failed with `Error: spawn EPERM` while esbuild bundled
`vitest.config.ts`. No integration assertion is marked PASS.

## V16.2.3B-R2B.1 Application Settlement Boundary

`packages/application/src/production.ts` adds `SettleProductionAssignment`. Its input is only
authenticated player context, farm ID, assignment ID, and optional request identity. It loads the
farm and membership, validates assignment/farm ownership and `RATE_PRODUCTION` mode, derives the
source from the assignment, derives the player's Warehouse and inventory, reads `Clock.now()`, calls
the existing `settleProduction` calculator, and passes one server-created plan to the existing
`D1ProductionRateSettlementService` port. No caller economic values, source ID, Warehouse ID, time,
rate, cursor, remainder, quantity, or XP are accepted.

The application boundary is intentionally HTTP-free. R2B.2 still owns composition into the handler,
request/response contracts, authentication middleware tests, retry/two-tab API tests, and malicious
JSON rejection. No migration, API route, client polling, Cargo, Wallet, or Legacy Auto change was made.

### R2B.1A application proof matrix

`tests/application/production.test.ts` covers happy-path RATE_PRODUCTION settlement, wrong-farm
authorization, cross-farm assignment rejection, Legacy mode rejection, server-clock/source derivation,
finite-source and Warehouse-limit wiring, and disabled assignment behavior. The test input contains
only `playerId`, `farmId`, `assignmentId`, and no economic authority fields.

Status: **TEST_WRITTEN** for all listed cases; focused Vitest execution remains
**ENVIRONMENT_BLOCKED** by managed-sandbox `spawn EPERM` during esbuild startup. `npm run typecheck`
passes. R2B.2 remains responsible for HTTP composition, request validation, authentication middleware,
retry, tampering, and two-tab API proofs.

## V16.2.3B-R2A D1 Atomic Settlement

`workers/api/src/d1-production-rate-settlement.ts` now provides
`D1ProductionRateSettlementService`. It accepts an already-calculated settlement plan and prepares one
`db.batch()` containing: (1) a receipt insert whose `SELECT CASE` is a SQL-level assignment/source/
Warehouse/inventory stale guard, (2) Warehouse inventory update or first-row insert, (3) finite-source
decrement when applicable, and (4) assignment cursor/remainder/blocked-state/version update. The receipt
key is a semantic `(assignment_id, settlement_id)` boundary, not an HTTP request id. Every later write
is scoped to that receipt, and the Warehouse capacity trigger remains authoritative.

The adapter has no Cargo, Wallet, Market, Emergency Funding, legacy Auto, per-unit loop, or economic
math. Renewable settlements omit source mutation; finite settlements update stock and version in the
same batch. The guard also checks the expected Warehouse inventory total and item quantity/version.
0029 was not modified in R2A and was not applied remotely.

R2A focused persistence fixtures and cost measurements are still required before declaring the D1 path
complete. Vitest startup remains environment-blocked by the managed Windows `spawn EPERM` seen in prior
phases; typecheck passes and no API route or deployment was added. R2B should wire authenticated state
loading and the public settlement endpoint, then add the real D1 renewable/finite, stale-state,
blocked-resume, replay, and partition-invariance tests.

## V16.2.3B-R2B.1B — D1 Adapters & Production Composition

`D1ProductionAssignmentRepository` and `D1ProductionSourceRepository` now provide real read-only D1
adapters. The assignment query joins `production_assignments.actor_job_id` to `actor_jobs.id` and
requires matching farm IDs in the join, so a cross-farm bridge cannot resolve successfully. The
execution mode is mapped only from `actor_jobs.execution_mode`; there is no default or inference.
Assignment cursor, fixed-point remainder, blocked state, enabled state, source ID, and version are
returned without conversion or mutation.

The source adapter maps renewable sources with `remainingStock = NULL`, finite sources with exact
stock/version values, including depleted zero stock, and rejects malformed persisted kind/stock
combinations. Both adapters are read-only. Existing `D1FarmRepository`, `D1FarmMemberRepository`,
`D1WarehouseRepository`, and `D1InventoryRepository` are reused; `SystemClock` remains the server
clock. `createHandler` now constructs `SettleProductionAssignment` with those repositories and the
existing `D1ProductionRateSettlementService`, leaving the HTTP route for R2B.2.

Focused coverage is in `tests/integration/production-rate-d1-repositories.test.ts` for mode/source
mapping, exact state round-trips, missing rows, cross-farm rejection, renewable/finite/depleted
sources, and source lookup. Typecheck passes. Vitest remains `ENVIRONMENT_BLOCKED` by managed Windows
`spawn EPERM` during esbuild startup; overall lint retains pre-existing Production Rate errors, while
the new adapter/test files introduce no lint errors after targeted validation. No migration, economic
formula, legacy runtime, HTTP route, remote migration, or deployment was added in R2B.1B.

## V16.2.3B-S1 Schema Correction — Work Assignment Bridge

R2B.1B was blocked because `production_assignments` had no authoritative relationship to the
`actor_jobs.execution_mode` owner. Migration `0029` is local and unapplied remotely: repository QA
records staging through `0028`, and no remote migration was executed for this correction.

The corrected local `0029` adds required `production_assignments.actor_job_id`, a foreign key to
`actor_jobs(id)`, and `UNIQUE(actor_job_id)`. This locks one Work Assignment to zero or one
Production Assignment. The foreign key uses `ON DELETE RESTRICT`: deleting a job must not silently
erase production state or settlement history. Existing farm and actor foreign keys remain unchanged.

`actor_jobs.execution_mode` remains the sole persisted owner; `production_assignments` does not
duplicate it. A future D1 adapter will join through `actor_job_id` and map the mode authoritatively.
The schema does not prove that both rows have the same `farm_id`; the adapter/application boundary
must verify that invariant before settlement. The existing assignment-to-source foreign key remains
authoritative and client code does not select a source.

Legacy jobs remain `LEGACY_ACTION_AUTO` and are neither converted nor given Production Assignments.
Rate jobs remain explicitly `RATE_PRODUCTION`; no economic math, runtime behavior, HTTP route, D1
adapter, or deployment changed in S1.

Focused proof coverage is in `tests/integration/production-assignment-bridge-migration.test.ts`:
legacy and rate representation, valid bridge insertion, missing-job rejection, duplicate-job
rejection, restrictive job deletion, and preserved source-FK behavior. R2B.1B can resume with the
D1 read adapters and composition work.

## V16.2.3B-R2C.1 — Benchmark Harness Ready

Added `tests/integration/production-rate-cost.test.ts`. It reuses `CountingD1` from
`tests/support/cost-harness.ts` and measures the real application path:
`SettleProductionAssignment` → real D1 assignment/source, Warehouse, and inventory adapters → pure
calculator → `D1ProductionRateSettlementService`.

The deterministic fixture uses a renewable `RATE_PRODUCTION` source at 10 units/hour, a server-side
clock, a farm owner/member, linked actor job, assignment, and Warehouse. Cases cover 1h, 6h, 24h,
48h (24h cap), large output, finite depletion, and Warehouse blocking. Each case emits one compact
`PRODUCTION_RATE_BENCHMARK` JSON block with output, batches, statements, reads, rows read, writes,
rows written, cursor, remainder, and receipt count. No benchmark numbers were measured in this
managed environment because Vitest cannot start esbuild (`spawn EPERM`).

Production Rate lint cleanup covers the application boundary and related Production Rate tests;
targeted lint passes. No economic behavior, migration, HTTP behavior, frontend, or deployment was
changed. Run locally from `C:\Project\HappyFarm` under Node 22 with:

`npx vitest run tests/integration/production-rate-cost.test.ts --reporter=basic`

Full test command: `npm test`.

## V16.2.3B-R2B.2 — Production Rate HTTP Boundary

Added one protected endpoint: `POST /farms/:farmId/production/:assignmentId/settle`.
It reuses the existing authenticator and derives player identity exclusively from authenticated
context. `farmId` and `assignmentId` are validated from the path using the existing ID conventions.

The strict request body is exactly `{ requestId }`, with existing request-ID constraints. Unknown
fields are rejected, including identity, source, Warehouse, rate, quantity, and timestamp
substitutions. The handler performs no production calculation or direct production SQL; it delegates
to `SettleProductionAssignment`, then maps its result to a compact settlement response. Existing
application error mapping supplies stable API error codes.

Focused API coverage was added to `tests/api/handler.test.ts` for unauthenticated rejection, authority
field tampering, and invalid path identifiers. The route contains no timer, polling, frontend, retry,
or concurrency logic. Vitest remains `ENVIRONMENT_BLOCKED` because managed Windows fails esbuild
startup with `spawn EPERM`. Typecheck and targeted lint pass; overall lint retains pre-existing
Production Rate errors. No migration, remote operation, deployment, or economic path changed.
R2B.3 remains responsible for retry/replay, HTTP concurrency proofs, and the composed happy-path
authorization matrix.

## V16.2.3B-R2B.3 — Retry, Concurrency & Settlement Invariance

The existing settlement identity is semantic, not the HTTP request ID. `requestId` is accepted and
validated at the HTTP boundary, while the application derives `settlementId` from assignment ID,
assignment version, and settlement cursor. The D1 batch guards the receipt and all economic writes
against the expected assignment/source/Warehouse/inventory state; cursor/version changes prevent a
second plan from crediting the same starting interval.

HTTP proofs were added to `tests/api/handler.test.ts` for exact replay plus a new-request-ID retry,
and for two same-time requests using `Promise.all`. Both assert one authoritative inventory result
(16 units for the deterministic 24-hour capped fixture) and the final cursor, independent of request
identity. Existing D1 proofs in `tests/integration/production-rate-d1-settlement.test.ts` cover
semantic replay, different-ID stale plans, one-winner same-state plans, stale assignment/source/
Warehouse guards, partial capacity, blocked-time behavior, finite depletion, and atomicity. Domain
proofs in `tests/domain/production-rate.test.ts` cover fractional remainder partition invariance,
zero-unit accumulation, Warehouse blocking without hidden backlog, finite boundary semantics, and the
24-hour cap.

No production code, new lock, migration, client authority, polling, retry loop, or deployment was
added. Focused Vitest execution remains `ENVIRONMENT_BLOCKED` by managed Windows `spawn EPERM` at
esbuild startup; proof code is complete and targeted static validation passes. R2C remains for cost
and throughput measurement.

### R2B.2A real composed HTTP proof

The four missing proofs are now written in `tests/api/handler.test.ts` using `createHandler`,
`NodeD1Database(schemaSql())`, real D1 repositories, the real Farm/member and Warehouse/inventory
paths, and the existing settlement service:

- Happy path: a `RATE_PRODUCTION` assignment settles through HTTP and verifies inventory output,
  assignment cursor advancement, and a settlement receipt.
- Wrong Farm: an authenticated player without Farm A membership receives authorization failure and
  no settlement receipt is created.
- Cross-Farm Assignment: a Farm A request naming Farm B's assignment is rejected and no receipt is
  created.
- Legacy mode: a linked `LEGACY_ACTION_AUTO` job is rejected as invalid and produces no receipt.

All four tests are code-complete but focused Vitest execution remains blocked at esbuild startup by
managed Windows `spawn EPERM`. Typecheck and targeted lint pass; no production code, migration,
retry/concurrency behavior, frontend, or polling was added in R2B.2A.

## V16.2.3B-R2C.2 — Final Production Rate Core Closure

The benchmark was executed successfully on the developer's local Windows Node 22 environment with:

`npx vitest run tests/integration/production-rate-cost.test.ts`

Result: 1 test file passed, 1 test passed.

| Case | Output | Batches | Statements | Reads | Rows read | Writes | Rows written |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1h | 10 | 1 | 10 | 6 | 5 | 4 | 3 |
| 6h | 60 | 1 | 10 | 6 | 5 | 4 | 3 |
| 24h | 240 | 1 | 10 | 6 | 5 | 4 | 3 |
| 48h cap | 240 | 1 | 10 | 6 | 5 | 4 | 3 |
| large output | 24,000 | 1 | 10 | 6 | 5 | 4 | 3 |
| finite | 37 | 1 | 11 | 6 | 5 | 5 | 4 |
| Warehouse block | 32 | 1 | 10 | 6 | 5 | 4 | 3 |

For the measured renewable path, output grows from 10 → 60 → 240 while D1 work remains constant:
one batch, 10 statements, 6 reads, 5 rows read, 4 writes, and 3 rows written. The large-output
probe also remains constant, proving no per-unit D1 loop. Finite depletion adds one bounded source
mutation. The 48h probe credits only the existing 24h cap and performs no hourly iteration.

The idle architecture is lazy/event-driven: an absent player causes zero Production Rate HTTP,
polling, cron, NPC, or periodic D1 settlement work. Production Rate does not depend on Cargo,
Wallet/Ledger, Market, pathfinding, actor position, or NPC animation; NPC movement remains
presentation-only. Legacy Auto and short-cycle crop Auto remain unchanged.

For architectural context only, Legacy Auto B3's recorded 24h/4-cell workload was 155 reconcile
calls, 2,319 transitions, 113,260 statements, 93,480 reads, 90,923 rows read, and 992 harvests.
This is not an apples-to-apples gameplay benchmark; it demonstrates backend complexity shape only.

Static closure gates: typecheck PASS; lint PASS; no new diff-check whitespace errors. The managed
environment may still block Vitest/full regression or build startup with `spawn EPERM`; the measured
local benchmark above remains authoritative. Migration `0029` remains local/unapplied, no `0030`
exists, and no deployment was performed. Next phase: V16.2.3C Apple/Orchard work.
