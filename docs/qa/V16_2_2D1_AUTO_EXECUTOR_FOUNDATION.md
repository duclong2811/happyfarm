# V16.2.2D1 - Auto executor foundation

Date: 2026-10-04. Verdict: **V16_2_2D1_AUTO_EXECUTOR_FOUNDATION_COMPLETE**.

D1 gives Auto a brain and a switch. It does **not** give it hands:

```text
D1 CAN PLAN.     the actor's control mode, a pure resolver, a typed next action, a panel that explains it
D1 CANNOT ACT.   no planting, no harvesting, no travel, no unload, no purchase, no resource mutation
```

That distinction is not a footnote. It is enforced by construction (the resolver is a pure function of
a snapshot; no use case on the Auto path calls a settlement), by the API surface (three routes, none of
which mutates the world except one column on `actors` and one boolean on `actor_jobs`), and by a
regression test that reads eight tables before and after a START AUTO plus a resolver evaluation.

Design authority: `docs/design/WORK_SKILLS_AND_AUTO.md`. Foundations:
`docs/qa/V16_2_2B_ACTOR_JOB_SPINE.md` (actors and assignments),
`docs/qa/V16_2_2C_ACTOR_CARGO_FOUNDATION.md` (cargo),
`docs/qa/V16_2_2C_6_BIDIRECTIONAL_CARGO.md` (LOAD and supply purchase).

## 1. Actor Auto control model

`actors.control_mode` already existed (`PLAYER_CONTROLLED` / `AUTO_CONTROLLED`). D1 is the first slice
that writes it. The transition is on the **same actor**: no second actor, no second cargo, no
re-identified assignments. Cargo and assignments are keyed by `actor_id` and neither is touched.

An `AUTO_CONTROLLED` actor is not the same thing as an enabled assignment:

```text
Auto ON  + assignment disabled   -> not eligible
Auto OFF + three enabled         -> nothing is planned as work
```

`actors.control_mode`, `actor_jobs.enabled` and the derived plan are three separate things, and the
panel shows them separately.

## 2. Control API and use case

```text
POST /farms/:id/workers/control   { requestId, startAuto, expectedVersion } -> { actor }
```

`SetActorControl` (`packages/application/src/auto.ts`): authenticate -> require the OWNER of the farm ->
resolve (creating on first use) the owner's Main Character -> refuse a stale `expectedVersion` -> write
the new mode under it.

The client sends **intent** (`startAuto`) and the version it read. It never sends a control mode, an
actor id, an owner, a cargo version, a price or an assignment change.

**Convergence, not just a guard.** Asking for the mode the actor is already in succeeds with no write,
and losing a race re-reads the actor and agrees when the winner asked for the same thing - so a replay,
two tabs clicking START together, and a retried request all end in one mode with one version bump. A
genuine *change* built on a stale version is still refused with `CONFLICT_STALE_STATE`.

## 3. Assignment policy and migration 0025

The one policy the C.5 supply ladder needs is a boolean, so it is one additive column:

```sql
ALTER TABLE actor_jobs ADD COLUMN auto_purchase_supplies INTEGER NOT NULL DEFAULT 0
  CHECK (auto_purchase_supplies IN (0, 1));
```

Default `0` is the safe direction: an existing assignment never starts spending gold because a build
shipped. `tests/integration/assignment-policy-migration.test.ts` builds a live-shaped save without the
column, applies the migration, and asserts the existing assignment still reads its place, order,
enabled flag and version - and now reads "never buy".

```text
POST /farms/:id/assignments/:jobId/policy  { requestId, autoPurchaseSupplies, expectedVersion } -> { job }
```

`SetAssignmentPolicy` mirrors the control use case: convergent on a no-op, guarded by the assignment's
own version, authorized on the farm, and touching exactly one boolean.

## 4. Work Skill registry

A Work Skill is the *interpretation* of an assignment, not a third entity:

```text
skillId = <kind, lowercased>.<target short name>
farm.carrot        <- FARM     + crop_carrot
orchard.apple      <- ORCHARD  + tree_apple
mining.iron        <- MINING   + resource_iron
forestry.wildwood  <- FORESTRY + resource_wildwood
```

`packages/domain/src/work-skill.ts` owns `familyForKind`, `skillIdFor`, `WorkSkillDefinition`, the
action vocabulary, the wait vocabulary and the pure resolver. The application layer derives the
definition from the assignment and the catalogues the world already ships: the crop's seed and harvest
item, the tree's sapling and fruit, the resource's drop table. No execution code lives in game data,
and no display label is ever an identity.

## 5. Lifecycle families

```text
REPLANT_CROP             FARM      seed -> plant -> grow -> harvest -> warehouse -> repeat
PERENNIAL_PRODUCTION     ORCHARD   sapling -> plant once -> grow -> harvest -> warehouse -> repeat
RESOURCE_NODE_GATHERING  MINING/FORESTRY   travel -> gather -> wait for renewal -> repeat
FISHING                  reserved  vocabulary only (no assignment kind can name a target yet)
LIVESTOCK                reserved  vocabulary only (no livestock system exists)
```

Families without a system answer `UNSUPPORTED_SKILL` rather than pretending, and a job of those kinds
cannot be created at all (the actor/job spine refuses an unknown target shape).

## 6. Resolver architecture

```text
ResolveAutoPlan (application)                 resolvePass (domain, pure)
  bounded reads -> snapshot  ----------------->  plan + per-assignment explanation
```

`ResolveAutoPlan` performs a fixed read set, builds `AutoPlanContext`, and hands it to
`resolvePass`. The resolver has no database, no clock, no inventory, no cargo and no world: it is a
function of the values it was given, it sorts a copy of the assignment list, and it returns a value. It
cannot mutate anything, and a test asserts the snapshot is unchanged after both entry points run.

`resolvePass` returns the actor-level plan **and** a per-assignment list. The per-assignment list is
computed even while the player is driving, which is what lets the panel show what Auto *would* do
before the character is handed over.

## 7. Next-action vocabulary

```text
LOAD_INPUT { itemDefinitionId, quantity }      PURCHASE_INPUT { itemDefinitionId, quantity }
TRAVEL_TO_AREA                                  PLANT { cells }        HARVEST { cells }
MINE                                            CHOP
TRAVEL_TO_STORAGE                               UNLOAD
```

plus, when there is no action, a `WaitReason`:

```text
NOT_AUTO_CONTROLLED  NO_ASSIGNMENT  ALL_DISABLED  DISABLED
WAITING_FOR_GROWTH   WAITING_FOR_RESOURCE  WAITING_FOR_SUPPLY  WAITING_FOR_FUNDS
WAITING_FOR_STORAGE  CARGO_FULL  NO_ELIGIBLE_TARGETS  UNSUPPORTED_SKILL
```

Derived, never persisted: a wait reason is recomputed from state on the next read, so there is no
stored label to go stale. `TRAVEL_TO_AREA` and `UNLOAD` are in the vocabulary for D2; D1 has no actor
position model, so it plans the work step itself (`PLANT`, `HARVEST`) and the delivery step
(`TRAVEL_TO_STORAGE`) rather than inventing a position.

## 8. Actionability, not priority order

Assignments are walked in priority order, and the first **actionable** one wins:

```text
#1 Rice Field  - every crop growing        -> waits
#2 Apple Grove - fruit ready                -> chosen
```

Waiting is not blocking. Only when every enabled assignment waits does the plan report a reason, and it
reports the highest-priority one. This is the C.5 decision 15, and `tests/domain/work-skill.test.ts`
pins it directly.

## 9. Global blockers and delivery

`CARGO_FULL` and `WAITING_FOR_STORAGE` change what is actionable:

- a harvest or gather whose yield cannot fit is refused, and the assignment reports the reason;
- a full pair of hands holding goods becomes the **delivery** (`TRAVEL_TO_STORAGE`) when nothing else
  is actionable;
- a full cargo over a full Warehouse is `WAITING_FOR_STORAGE` - the one state nothing can fix;
- planting from seed already in hand is *not* blocked by a full cargo, because planting consumes it.

## 10. The empty-field resolution (the canonical D1 case)

The brief's example is `farm.rice`; this deployment ships no rice crop, so the shipped equivalent
(`farm.carrot`) is what the API test drives end to end. The rule is the same:

```text
auto, empty area, no seed in cargo, seed in warehouse          -> LOAD_INPUT
auto, empty area, seed in cargo                                -> PLANT
auto, empty area, no seed anywhere, purchase ON, gold enough    -> PURCHASE_INPUT
auto, empty area, no seed anywhere, purchase OFF                -> WAITING_FOR_SUPPLY
auto, empty area, purchase ON, gold short                       -> WAITING_FOR_FUNDS
```

The supply ladder is carried -> stored -> bought -> wait, in that order, and the batch is one unit.
Nothing is planted without its input, and none of those steps is performed.

## 11. Apple planning (PERENNIAL_PRODUCTION)

- ready tree in the area -> `HARVEST` (and never a purchase);
- standing but regrowing -> `WAITING_FOR_GROWTH`;
- empty valid cells -> the sapling ladder (`PLANT` / `LOAD_INPUT` / `PURCHASE_INPUT` / wait);
- cells holding something else -> skipped; Auto never clears what it did not plant.

## 12. Mining and forestry planning (RESOURCE_NODE_GATHERING)

The island's own node placements are read with the actor's zone and the area's cells:

```text
available node in the area                 -> MINE / CHOP
every node depleted                        -> WAITING_FOR_RESOURCE
no node of the target inside the area      -> NO_ELIGIBLE_TARGETS (a configuration problem, said plainly)
```

Auto creates no node, resets none and mutates none.

## 13. Overlap

A target belongs to one assignment per pass. `resolvePass` claims the ids the chosen step would touch
and marks a lower-priority assignment `claimed` when its targets intersect - so a shared field is
worked by the higher priority, and the loser still uses its own remaining cells. Nothing about this is
persisted and there is no schema constraint: it is a rule over the two assignments and the cells they
already have.

## 14. Manual takeover

```text
AUTO_CONTROLLED --[STOP AUTO]--> PLAYER_CONTROLLED
```

Same actor, same cargo, same assignments, same world. No teleport, no cargo flush, no assignment
deletion, no fake action completion. Because the resolver is pure, re-enabling Auto resumes from the
world as it is rather than from a remembered step, and every settlement in the game was already atomic,
so there is no half-done action to unwind.

## 15. Zero economic effect (the required regression)

`tests/api/auto-executor.test.ts` reads eight tables before and after START AUTO plus a resolver
evaluation, and asserts:

```text
0 crops planted      0 harvests        0 cargo rows moved      0 warehouse/inventory rows moved
0 gold spent         0 XP awarded      0 ledger rows           0 resource-node rows changed
```

It also asserts the control change itself moves none of them, and that STOP AUTO is the same kind of
no-op.

## 16. API surface and security

```text
POST /farms/:id/workers/control                START_AUTO / STOP_AUTO on the owner's Main Character
POST /farms/:id/assignments/:jobId/policy      one assignment's Auto Purchase policy
GET  /farms/:id/auto-plan                      the plan, and why, for every assignment
```

Every route is owner-only (`NOT_AUTHORIZED`), authenticated (`NOT_AUTHENTICATED`), schema-validated
(`INVALID_INPUT`), version-guarded (`CONFLICT_STALE_STATE`) and scoped by the route's farm - a foreign
job answers like a missing one (`JOB_NOT_FOUND`). The plan is a read that answers even while the player
is driving; it exposes a derived skill id, a typed action and a wait reason, and no cost, reward,
capacity, owner or position. Client intent is never authority: `expectedVersion` and the derived
targets are the server's.

## 17. D1 read set for one resolver pass

Bounded, named, and never a scan:

```text
farm (authorized) + membership            actors (Main Character, created on first ask)
actor cargo rows (by actor)               wallet (gold)      warehouse row (capacity + used)
assignments (by actor, priority order)    work area cells (per distinct area, not per assignment)
crops / trees / construction bounds (by farm)   resource-node states (by the actor's zone)
inventory.find(owner, input) - one read per distinct input the assignments need
```

Catalogues (crops, trees, resources, shops) are game data held in memory, not D1. `WorkAreaRepository`
serves the area list with its cell count so a card never opens every area's cells, and
`WarehouseRepository.find` gives capacity and used in one row. The plan runs on panel open and after an
Auto action - there is no poll, no cron, no per-actor timer and no Durable Object on the Auto path.

## 18. The Auto panel

The Workers panel became the Auto sheet, keeping the underlying APIs and the durable `job` names:

- **actor header** - portrait, "Main Character", the control chip, and a cargo meter with used/capacity;
- **one control** - START AUTO / STOP AUTO, and the plan it would run above it;
- **assignment cards** - the skill's real art (the crop, tree or deposit model through the shared
  thumbnail cache, with a sized fallback where no asset exists), the area and its cell count, the
  priority, the production-cycle strip, the policy toggle, the status line and the actions;
- **the editor** - profession chips, a skill card grid, area cards, and one policy toggle. The player
  never configures buy / load / plant / harvest / unload as separate steps;
- **honesty** - statuses read "Ready: load Carrot seeds", "Waiting: waiting for crops to grow",
  "Blocked: the Warehouse is full", and never claim work that has not happened. The list carries one
  line saying this is a plan.

- Mobile: one column, at least 44px on every control, no horizontal scrolling, and reordering behind a
  **Reorder** mode with full-size controls rather than tiny arrows.
- The panel reads on open and after its own actions. The plan read is one more bounded read on the same
  path, and source tests fail if a growth poll, a frame, a pointer or a movement loop ever names it.

## 19. Tests

```text
tests/domain/work-skill.test.ts          30 cases: the 22-case resolver matrix + purity + identity
tests/api/auto-executor.test.ts          9 handler cases: control, races, policy, plan, zero-effect,
                                         malformed body, unknown assignment, stale policy version
tests/integration/assignment-policy-migration.test.ts   additive migration against a live-shaped save
tests/web/workers-panel.test.ts          the pure panel logic, the cycle strips, the status mapping,
                                         and the source guards that keep the plan off the hot paths
```

Covered explicitly: no assignments; all disabled; player-controlled; empty field with a carried seed /
a stored seed / neither; purchase on and off; insufficient gold; all growing; mature; partial; apple
ready, regrowing and empty; mining available and depleted; forestry; a waiting priority-1 assignment
making way for an actionable priority-2 one; overlapping targets; cargo full; warehouse full; a full
cargo becoming a delivery; unsupported skills. Plus START replay, two simultaneous STARTs, START vs
STOP, a stale version, a foreign farm, an unauthenticated caller, and the zero-economic-effect guard.

## 20. Gates

```text
npm run typecheck            clean
npm run lint                 clean (--max-warnings=0)
npm test                     170 files / 1682 tests
npm run build                web client builds; Worker dry-run builds
npm run build:worker:staging staging Worker dry-run builds
npm run assets:validate      27/27 models match their specs
git diff --check             clean
```

## 20a. Security review (AGENTS.md gate: permissions, persistent state, progression-adjacent)

Checked against `.agents/skills/security-review/SKILL.md`:

- **Trust boundaries** - three routes. Two take bodies validated by `SetActorControlRequestSchema` /
  `SetAssignmentPolicyRequestSchema` (a bounded request id, a boolean, a positive integer version);
  the third is a read. Path params are `FarmIdSchema`/`JobIdSchema`-checked, then parsed with the
  domain's own `parseFarmId`/`parseJobId`. Nothing else is accepted, and a malformed body is
  `INVALID_INPUT` (tested).
- **Authentication** - identity comes from `authenticator.authenticate(request)` only; the use cases
  throw `NOT_AUTHENTICATED` when it is null. No body field ever names a player, an actor or an owner.
- **Authorization** - `requireOwnedFarm` (OWNER only, like the rest of Home Island editing) runs before
  any read or write, and the actor is the farm owner's Main Character, derived server-side. A foreign
  farm answers `NOT_AUTHORIZED` on both routes, and a foreign job answers like a missing one
  (`JOB_NOT_FOUND`) - verified in the API tests and remotely against staging.
- **Races and replay** - control and policy are convergent (the same intent succeeds with no write) and
  version-guarded on a real change, so two tabs, a replay and a retried request converge on one
  outcome. Tested: simultaneous STARTS, START replay, stale STOP, stale policy, unknown job.
- **Economy and inventory** - D1 writes neither. The only price it reads is the catalogue's own buy
  price, held in memory; `PURCHASE_INPUT` is a plan value, not a mutation, and there is no ledger row,
  no wallet write, no inventory write and no cargo write anywhere on the Auto path. The zero-effect
  test and the remote smoke both assert it.
- **Database** - the migration is additive with a default and a boolean CHECK; both writes are
  parameterised and scoped by id **and** version (`UPDATE ... WHERE id = ? AND version = ?`), so no
  full-table write and no lost update.
- **Secrets and logging** - no secret, token or credential is added, read, logged or bundled; the
  staging smoke's guest cookie lived only in the smoke's memory. No new logging.
- **Errors** - stable codes from `ApplicationError` through the handler's `failure(code)`; no SQL,
  stack or internal id leaks. The plan exposes only what the owner's own Workers read already exposes.
- **Known limitations, stated rather than implied** - (1) control and policy are convergent, not
  receipt-backed; a replay is safe by construction rather than by an idempotency row, which is the
  deliberate choice for a non-economic single-column effect. (2) `expectedVersion` is the only guard
  against a stale writer, exactly as the rest of the assignment spine. (3) The plan's wait reasoning is
  a snapshot: between the read and any future executor's action the world can move, which is why D2
  must re-resolve inside the action's own transaction rather than trusting a plan it was handed.

## 21. Migration

`database/migrations/0025_assignment_auto_purchase.sql` - one additive column with a default and a
boolean CHECK. Applied to staging only; production is not authorized for this slice.

## 22. Staging

Staging only; production is not authorized for this slice.

```text
Worker:      happy-farm-staging
Migration:   0025_assignment_auto_purchase.sql   applied 2026-10-04 (remote)
Version ID:  7a4f41c6-a2e8-456d-8c6b-1eb1737050ab   deployed 2026-10-04T05:41:11Z
Rollback:    2c9ac70a-d68b-43c9-bad3-a3670404fc20   (V16.2.2C.6)
```

Remote smoke, on a fresh guest with its real starter state (100 gold, 10 carrot seeds) and no debug
grants:

```text
GET  /api/session                              200  guest player established
POST /api/farms                                201  farm created
GET  /api/farms/:id/workers                    200  actor PLAYER_CONTROLLED v1, 0 assignments
GET  /api/farms/:id/tiles                      200  picked an IDLE SOIL cell
POST /api/farms/:id/work-areas                 201  FARM area, 1 cell
POST /api/farms/:id/jobs                       201  FARM / crop_carrot, priority 1, policy false, v1
GET  /api/farms/:id/auto-plan                  200  PLAYER_CONTROLLED, NOT_AUTO_CONTROLLED,
                                                    per-assignment LOAD_INPUT, skill farm.carrot
POST /api/farms/:id/workers/control (START)    200  AUTO_CONTROLLED v2
GET  /api/farms/:id/auto-plan                  200  AUTO_CONTROLLED, LOAD_INPUT item_carrot_seed qty 1
POST /api/farms/:id/assignments/:jobId/policy  200  autoPurchaseSupplies true, v2, gold still 100
POST /api/farms/:id/workers/control (STOP)     200  PLAYER_CONTROLLED v3, plan NOT_AUTO_CONTROLLED
GET  /api/farms/:id/cargo/grant                404  there is still no grant route
GET  /api/farms/:id/auto-plan (no cookie)      401
GET  /api/farms/:id/auto-plan (other player)   403  and the same for the control route
```

Control concurrency, on a second fresh guest:

```text
two simultaneous STARTs      200 / 200   one mode, actor version 1 -> 2
START replay (same request)  200         mode unchanged, version unchanged (no second bump)
STOP on the pre-START version 409        CONFLICT_STALE_STATE, actor still AUTO_CONTROLLED
```

Zero economic effect held across the whole run: `inventory` still 10 carrot seeds, `wallet` still 100
gold, `cargo` still `0/30` at version 1, and `GET /farms/:id/crops` still empty - before the plan
read, after START AUTO, after the plan read, and after STOP AUTO.

## 23. What D2 must add

D2 makes `farm.carrot` (the design's `farm.rice`) the first executable skill. It needs:

- the executor that turns a planned `LOAD_INPUT` / `PURCHASE_INPUT` / `PLANT` / `HARVEST` /
  `TRAVEL_TO_STORAGE` into the existing authoritative settlements, in order, one at a time;
- cargo as the destination of a harvest (the transitional bridge to the Warehouse is removed there);
- a position/travel model, which is why `TRAVEL_TO_AREA` exists in the vocabulary and is not planned
  yet;
- the in-flight action safety on STOP AUTO that D1 deliberately did not need (there is nothing in
  flight).

Everything D2 consumes already exists: `LoadCargo`, `PurchaseSupplyIntoCargo`, `UnloadCargo`,
`PlantCrop`, `HarvestCrop`, `resolveNextAction` and the control switch.

## 24. Non-goals, stated plainly

- No execution of any kind: no planting, harvesting, travel, unload, purchase or node mutation.
- No polling resolver, no cron, no Durable Object, no timer, no offline simulation.
- No `simulation_at`, no activity log, no event queue, no NPC table.
- No route that grants cargo or items, and no client-supplied control mode, price or reward.
