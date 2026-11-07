# V16.2.3A — Legacy Auto Architecture Audit & Replacement Plan

Status: read-only architecture audit. No production behavior, schema, migration, route, UI, or
Auto code was changed by this phase.

## 1. Executive summary

Legacy Auto can be removed without rewriting the whole game, but only after a staged, additive
cutover. It is a real economic state machine today, not disposable scaffolding: `AdvanceAuto`,
`ReconcileActorAuto`, the `actor_auto_state` watermark, cargo, settlement services, receipts,
warehouse triggers, and funding policy form one atomic system. The safe pivot is therefore:

* preserve manual crop/tree/mining/forestry/fishing paths and shared storage/economy/progression;
* preserve `Actor`, `Work Area`, and most of `actor_jobs` as configuration/authorization;
* add a distinct Production Assignment/Settlement core for rate-based automation;
* keep legacy Auto available only behind an explicit, mutually exclusive mode during migration;
* retire action-state, travel, cargo-for-auto, and emergency-funding code only after no active job or
  route can use it and staging data has been reconciled.

Final verdict: **V16_2_3A_ARCHITECTURE_AUDIT_COMPLETE**.

## 2. Safety baseline

* HEAD: `e502bb4550fd1097fdc69dc1fa30d96c75b6b545`
* Node: `v22.23.3`; npm: `10.9.9`.
* Worktree: intentionally dirty, with existing B0.1–B3.1, D2.4, client, docs, and migration work.
  No existing changes were reset, stashed, cleaned, or overwritten.
* `git diff --check`: completed with line-ending warnings only; no whitespace error was reported.
* Files changed by this audit: this document only. No migration was created.

## 3. Current architecture and dependency graph

```text
browser Workers panel / farm entry / visibility resume
  -> GET /farms/:id/auto-plan
  -> POST /farms/:id/workers/control
  -> POST /farms/:id/assignments/:jobId/policy
  -> POST /farms/:id/auto/step { requestId }
  -> POST /farms/:id/auto/reconcile { requestId }
       -> authenticated farm/role checks in handler
       -> ResolveAutoPlan / SetActorControl / assignment policy
       -> AdvanceAuto
            -> actor_jobs + actors + work_areas snapshot
            -> ResolveAutoPlan / WorkSkill resolver
            -> AutoTravel / Cargo / crop/tree state
            -> AutoPlantSettlement / AutoSupplySettlement
            -> AutoHarvestSettlement / AutoUnloadSettlement
            -> AutoFundingSettlement when enabled
            -> D1 batch, guarded versions, semantic receipt, simulation_at
       -> ReconcileActorAuto
            -> bounded event-driven transitions, max 24 h and pass budgets
       -> D1: actors, actor_jobs, actor_auto_state, cargo, inventory, warehouse,
          wallets/ledger, settlement rows, idempotency/receipts, crop state
       -> response; client refreshes authoritative state and animates presentation
```

The executor performs at most one bounded transition per step. Current exact action vocabulary is
`LOAD_INPUT`, `PURCHASE_INPUT`, `FUND_AND_PURCHASE_INPUT`, `TRAVEL_TO_AREA`, `TRAVEL_TO_STORAGE`,
`PLANT`, `WAIT`, `HARVEST`, and `UNLOAD`; the resolver also returns blocked/wait explanations and
`NOT_EXECUTABLE_YET` for unsupported families. The implemented economic vertical is the replanting
crop family; orchard, mining, forestry, fishing, and livestock are resolved but not executable.

## 4. Request and client flow

`apps/web/src/api.ts` is the client boundary. `main.ts` reads the plan/panel, sends control and
policy changes, sends one `/auto/step` request per server transition, and calls `/auto/reconcile`
when entering a farm or returning after at least 60 seconds hidden. There is no server loop and the
5-second visible growth refresh is not an Auto reconciliation trigger. Hidden tabs pause client
driving; authoritative time resumes through the bounded reconcile request. Worker position and
animation are presentation only, while the server checks anchors and `travel_arrives_at`.

Future Production Rate should replace step cadence and movement requests with a settlement request
on meaningful reads/interactions. The browser may locally animate walking, mining, carrying, or
fishing from assignment state; no animation callback may grant output or choose a timestamp/rate.

## 5. Database map (0022–0028)

| Migration/table | Current ownership | Future disposition |
|---|---|---|
| 0022 `work_areas`, `work_area_cells` | farm-scoped named cell sets, explicit membership, versioned edits | KEEP/REUSE; location, never authority |
| 0023 `actors` | owner, kind, control mode, zone, version | KEEP; add future production state additively |
| 0023 `actor_jobs` | actor/farm/area/kind/target/priority/enabled/version | ADAPT or compatibility view; do not silently reinterpret active rows |
| 0024 cargo columns/table/triggers | actor transport container, capacity/version/request marker | KEEP for manual transport; REMOVE from rate settlement later |
| 0025 `auto_purchase_supplies` | assignment supply policy | LEGACY/ADAPT; not needed for output-only production |
| 0026 `actor_auto_state` and harvest destination | anchor/travel state and Auto harvest destination | REPLACE for rate jobs; KEEP during coexistence |
| 0027 `simulation_at` | server-time Auto watermark | REPLACE with per-assignment `last_settled_at` |
| 0028 funding flag/items | explicit emergency liquidation whitelist | RETIRE for production-rate jobs; preserve for legacy crop Auto if retained |

Existing players, farms, inventory, warehouse, actors, areas, assignments, and cargo must be
preserved. Active legacy Auto must be drained or explicitly paused before any row transformation.
Applied migrations must never be edited; future schema is additive in 0029+.

## 6. Classification matrix

| Component | Decision | Evidence/reason |
|---|---|---|
| Player, Farm, World, auth, ownership | KEEP | independent roots and authorization boundaries |
| Inventory/Warehouse triggers, capacity, versions | REUSE | authoritative destination and positive-growth guard |
| Wallet/Ledger/EconomyService | REUSE | manual sale, shop, future costs; production output is not gold |
| Progression and manual settlement receipts | REUSE | server rules and replay guards |
| Actor | KEEP | generic owner/kind abstraction already names Main Character, NPC Worker, Vehicle, Ship |
| Work Area | REUSE/ADAPT | explicit spatial scope fits orchard, forest, mine, water, livestock |
| `actor_jobs` Work Assignment | ADAPT | current row is configuration and can bridge, but rate semantics should be explicit |
| Work Skill definitions/resolver | REUSE/ADAPT | stable profession/target identity is useful; action plan semantics are legacy |
| Cargo | KEEP manual; REMOVE from production settlement | valuable transport system, but rate output must credit Warehouse directly |
| `actor_auto_state` travel/action cursor | REPLACE | per-action movement state conflicts with lazy rate settlement |
| `simulation_at` | REPLACE | new cursor belongs to each production assignment/source |
| Auto executor/planner | REPLACE for rate jobs; KEEP during bridge | action lifecycle is not a production-rate calculation |
| Auto plant/harvest/supply/unload/funding D1 services | DELETE_LATER | only after all legacy Auto callers are gone and data is drained |
| Emergency Funding | RETAIN only for surviving short-cycle Auto | production output has no seed purchase/cargo trip |
| client Auto step/worker travel animation | REPLACE/DELETE_LATER | visual assignment simulation must not drive economy |

## 7. Required decisions

### Actor

Actor should survive. Generic fields are `id`, owner, kind, zone, control mode, version, timestamps;
future NPC/vehicle/ship rows fit the existing vocabulary. Legacy-specific fields are cargo capacity,
cargo version/transfer marker, and action travel state. Main Character remains a valid Actor, but
production must define whether manual takeover pauses the assignment; recommendation: only NPC workers
are continuously rate-producing initially, while Main Character rate production is opt-in and pauses
on manual control.

### Work Area

Reuse as a spatial scope and authorization input for orchard, forestry, mining, aquaculture, and
livestock. It must not become ownership, land-use authority, or a resource stock by itself.

### Work Assignment vs Production Assignment

Do not give the existing row two invisible meanings. Keep `actor_jobs` as the compatibility/config
spine, but introduce an explicit Production Assignment identity (table or versioned subtype) with
source, enabled state, modifier inputs, and `last_settled_at`. A bridge may derive one production
assignment from a compatible job, but the API must expose the mode explicitly. This avoids treating
`FARM_RICE`'s repeating action plan as equivalent to an apple rate.

### Work Skill

Keep skill IDs as capability/type and data lookup (`FARM_RICE`, `ORCHARD_APPLE`, `MINING_*`,
`FORESTRY_*`, `FISHING_*`, `LIVESTOCK_*`). Adapt definitions so a skill can describe capability,
source compatibility, and modifiers; do not retain action-state instructions as the economic contract.

### Cargo

Cargo remains for manual harvesting/mining/fishing, exploration, character transport, vehicles, and
ships. It should be removed from automated rate settlement: production credits the authoritative
Warehouse through the same inventory/capacity service. Cargo-only dependencies are load, carry,
unload, travel anchors, cargo guards, transfer marker, and auto supply/funding.

### Warehouse and Wallet/Ledger

Warehouse remains the storage authority. Reuse capacity calculation, positive-growth guard, versioned
mutation, and inventory service. On a production output, no Gold is created; Wallet/Ledger remain for
manual sale, market, processing costs, and future wages/upkeep. Emergency Funding is not a natural
rate-production dependency and should remain only for legacy short-cycle Auto while that mode exists.

## 8. Resource-family fit

* Perennial orchard: existing tree definitions, planted timestamps, maturity, ownership, work-area
  membership, and persistence map naturally to a mature `ProductionSource` with rate/hour.
* Mining: existing resource definitions, mineable state, manual action, and persistence provide the
  source identity; finite remaining stock becomes a settlement constraint.
* Forestry: reuse tree/resource state, but separate orchard repeat-output from finite/renewable forest
  stock; replant/regrowth must be source state, not actor animation.
* Fishing: existing locations, resource/reward and manual fishing foundations can supply a finite or
  regenerating source; rate settlement needs explicit stock/regeneration timestamps.
* Livestock: future-only design. The same core supports continuous milk/egg output and cycle outputs
  such as meat by representing a source state and output schedule; no current implementation is
  claimed.
* Processing: compatible only if the core supports input constraints as well as output capacity:
  effective input/output rates, bounded elapsed settlement, and atomic consumption/credit. Do not
  over-engineer the first orchard slice, but do not hard-code output-only assumptions into the core.

Short-cycle recommendation: **Option B temporarily**—retain legacy Auto only for the already
implemented replanting crop family, behind an explicit mode, while new perennial/resource families
use Production Rate. Do not convert short-cycle crops until a later comparison proves a rate model
does not create confusing seed/input semantics. Option A loses an existing tested feature; Option C
prematurely combines two distinct economic models.

## 9. Proposed Production Rate core

```text
ProductionSource(source_id, farm/zone, kind, output, rate, stock/capacity, availability)
ProductionAssignment(assignment_id, actor, source, enabled, modifiers, last_settled_at, version)
Settlement(now, assignment_id, request_id)
  authenticate -> authorize -> load snapshot -> derive effective rate server-side
  -> clamp elapsed/offline window -> calculate potential
  -> constrain by source stock, input, Warehouse free capacity, availability
  -> atomically mutate inventory/source/assignment cursor/progression/receipt
```

There is no tick, cron, per-second worker loop, or animation request. The idempotency boundary is
one `(assignment_id, request_id, settlement window/cursor)` receipt; the concurrency boundary is a
guarded assignment version/cursor plus Warehouse/source versions in one D1 batch. The offline cursor
is `ProductionAssignment.last_settled_at`, not an actor-global action watermark.

### Lazy settlement semantics

Use integer fixed-point rate units and integer elapsed milliseconds/seconds. Derive `effective_rate`
from server-known base data and modifiers; the client never supplies it. Preserve a fractional
remainder on the assignment or use a deterministic numerator/denominator accumulator.

Recommended capacity behavior is **pause at the exact productive instant**: if 10/hour would produce
50 but only 32 fit, credit 32 and advance `last_settled_at` by the equivalent 3h12m, leaving the
remaining elapsed interval unsettled. Mark blocked/full so later settlement retries only after
capacity changes. Never silently discard overflow, auto-sell it, or advance to `now` while claiming
production was credited.

For finite stock, credit the smaller of potential and remaining stock; advance the cursor by the
productive time represented by the credited amount, mark depleted at zero, and stop. A 37-stock mine
at 10/hour after 5h credits 37 and advances 3h42m, not the full five hours.

Recommend an offline cap initially bounded to 24 hours, subject to economy telemetry and player
experience review. The cap controls economic inflation and request work, while the exact cursor keeps
the result deterministic. A future per-source cap may be safer than one global cap.

## 10. Security, idempotency, concurrency

Verified server identity supplies player ownership; route bodies may contain only intent and request
IDs. Server derives rate, elapsed authoritative time, stock, capacity, XP, and modifiers. Preserve
current ownership checks, runtime validation, D1 guards, semantic receipts, optimistic versions,
ledger shape, and atomic batch composition. Test unauthenticated, cross-player, malformed, negative,
duplicate, replayed, concurrent-tab, full-Warehouse, depleted-source, and manual-versus-production
cases. Old `/auto/*` routes must not remain callable for a production assignment after cutover.

## 11. Cost and scale

Current Auto work is proportional to transitions and reads/writes per step/reconcile; B2.5 reduced
statement/read/row cost while preserving writes, and B3 bounds a pass to 24 transitions/32 steps.
Production Rate changes the steady-state shape to one bounded settlement on interaction: roughly
O(assignments settled), not O(real-world seconds × workers). Five assignments for one, 1,000, or
10,000 players require no continuous simulation; idle/offline assignments cost zero runtime until a
read or settlement request. D1 savings are expected from fewer transition receipts, travel/cargo
writes, and repeated state reads, but exact billing must be measured in staging rather than invented.

## 12. Reusable B0–B3.1 work

* B0.1: code pattern and tests for atomic composition; legacy transition identity is not the new
  model's identity.
* B1: centralized supply settlement, server price, inventory conservation, and replay tests; mostly
  legacy for output-only production.
* B2: shared manual/Auto settlement, destination guards, XP and idempotency; reuse the atomicity and
  manual parity lessons, not cargo destination semantics.
* B2.5: snapshot reuse and cost harness; directly reusable for bounded settlement measurement.
* B3: server-time, lazy/event-driven reconciliation, exact committed watermark, bounded pass; the
  strongest reusable pattern, with cursor moved from actor Auto state to assignment.
* B3.1: funding whitelist, ledger sale, and replay/concurrency tests; legacy-only unless short-cycle
  Auto survives.

## 13. API and client cutover

| Current route | Current purpose | Future status |
|---|---|---|
| `GET /farms/:id/auto-plan` | derived action plan | REPLACE for rate status; keep bridge |
| `POST /farms/:id/workers/control` | actor control mode | ADAPT to assignment enable/pause semantics |
| `POST /farms/:id/assignments/:jobId/policy` | supply/funding policy | RETAIN only for legacy mode; new modifiers validated separately |
| `POST /farms/:id/auto/step` | one action transition | DELETE_LATER after legacy jobs drain |
| `POST /farms/:id/auto/reconcile` | bounded action replay from `simulation_at` | REPLACE with bounded production settlement |
| `POST /farms/:id/cargo/load` / `purchase` | authoritative manual/container supply | KEEP for manual gameplay |

The client should show authoritative assignment/source status and last settlement, request settlement
on farm entry or meaningful interaction, and animate locally. Remove step cadence and action animation
as economic triggers only after legacy mode is impossible.

## 14. Migration, preservation, and deletion prerequisites

Use additive migrations 0029+ for production sources, assignments, source stock, settlement receipts,
cursor/version, and explicit mode. A later cutover migration may add compatibility flags; cleanup must
be a separate migration after observation. Never rewrite 0022–0028.

Preserve all player/farm/world/inventory/warehouse/wallet/ledger/progression/manual state. Transform
only active compatible jobs with an explicit, auditable mapping. Never silently discard cargo, active
Auto state, funding selections, or receipts; either drain, pause, or retain them until expiry.

Delete-later candidates: `auto-executor.ts`, `auto-reconcile.ts`, `auto-plant.ts`, `funding.ts`,
`actor_auto_state`, travel fields, Auto settlement adapters, `/auto/step`, `/auto/reconcile`, Auto
step client code, Auto movement hooks, and legacy-only tests. Preconditions: no active legacy rows,
no route callers, production assignments prove parity, replay/concurrency/full-storage tests pass,
staging data is backed up and reconciled, and rollback no longer needs the old cursor.

Keep inventory: Player/Farm/World/auth, work areas, Actor identity, manual crops/trees/resources,
manual professions and movement, Inventory/Warehouse, Wallet/Ledger, progression, transaction helpers,
ownership/role checks, runtime contracts, and D1 atomic/concurrency test infrastructure.

## 15. Risk register

| Risk | Rank | Mitigation |
|---|---|---|
| old Auto and new production both credit | HIGH | explicit mutually exclusive mode; assignment/source uniqueness and cutover guard |
| double credit/replay/concurrent tabs | HIGH | cursor/version guard plus unique settlement receipt in one batch |
| Warehouse full or fractional drift | HIGH | exact pause cursor, fixed-point arithmetic, deterministic blocked state |
| lost cargo/inventory during transform | HIGH | preserve then drain; audited idempotent conversion, no destructive migration |
| stale assignment/source ownership | HIGH | farm/actor/source authorization and foreign keys on every settlement |
| client animation becomes authority | HIGH | no economic client inputs; tests assert visual hooks have no API mutation |
| old routes/reconcile remain callable | HIGH | route mode guard, telemetry, then remove only after zero callers |
| contradictory old tests/data incompatibility | MEDIUM | dual-mode contract tests and staged backfill report |
| abandoned cargo/funding state | MEDIUM | pause/drain policy and explicit expiry, never silent deletion |
| D1 cost underestimated | MEDIUM | repeat B2.5-style local/staging read/write measurements |

## 16. Phased plan and rollback boundaries

* **V16.2.3A:** this audit only. Rollback is deleting this report; production is unchanged.
* **B:** additive Production Rate domain/contracts/schema, no callers. Rollback by disabling new
  mode; old schema remains authoritative.
* **C:** Apple Orchard economic proof with one source/actor/assignment and Warehouse settlement.
  Rollback by disabling the new assignment mode and retaining source rows.
* **D:** client/NPC visual assignment state; no economic dependency on animation. Rollback is client
  feature flag only.
* **E:** migrate one profession at a time, with per-family compatibility and reconciliation reports.
  Rollback family flag before deleting legacy state.
* **F:** legacy Auto retirement after zero active legacy assignments and route traffic.
* **G:** cleanup migrations/code/tests only after backup, staging soak, and rollback window closure.

## 17. Apple Orchard vertical slice (next prototype)

Smallest proof: one mature apple source, one authorized Actor, one explicit Production Assignment,
server-known rate, `last_settled_at`, one settlement endpoint/use case, Warehouse output, 24-hour
bounded offline settlement, fixed-point remainder, unique receipt, optimistic concurrency, and exact
full-Warehouse pause behavior. Include tests for replay, parallel settlement, manual ownership,
capacity, and finite-source-compatible constraints. Do not add NPC animation, Cargo, funding, Gold,
or broad profession support to this slice.

## 18. Final architecture recommendation

The product can support Agriculture, Fishing/Aquaculture, Forestry, Mining, and Livestock through one
Production Rate core if source stock, availability, modifiers, and input/output constraints are
first-class server concepts. Processing can share the same settlement engine only when input rates,
output rates, capacity, and atomic consumption are represented; it should not be forced into the
orchard schema. Actor and Work Area survive. Work Assignment becomes an explicit bridge, not a
silent dual-semantic row. Cargo survives for manual gameplay and leaves automated rate settlement.
Legacy Auto is conditionally removable, with additive migration and per-family cutover as the safe
sequence.

## 19. Validation record

Source inspection covered the context index, automation design, migrations 0022–0028, application
Auto/executor/reconciliation/cargo/funding modules, API route definitions, client API/main flow, and
focused Auto integration/unit tests. No production test/build command was run before this document
was created; the repository is already substantially dirty and the requested audit explicitly forbids
implementation. The next controlled gate should run the focused Auto, B3/B3.1, manual crop,
Inventory/Warehouse, Actor/Assignment suites, then full Vitest, typecheck, lint, diff-check, worker
dry-run, and production web build in an environment with the existing dirty tree recorded.

Security review note: identity, authorization, validation, parameterized D1 access, race/replay,
ledger/inventory authority, and client/server boundaries were explicitly considered. No claim of
absolute security is made; the main remaining security gate is the implementation-time test matrix
and route cutover verification.
