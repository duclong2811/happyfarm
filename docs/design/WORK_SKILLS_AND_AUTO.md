# Work Skills and Auto: design

Status: **design, with D1 and D2 now built.** The **LOAD** direction (Warehouse -> Cargo) and the
**supply purchase** (Shop -> Cargo) exist as of V16.2.2C.6 - see
`docs/qa/V16_2_2C_6_BIDIRECTIONAL_CARGO.md`. The **control switch, the pure resolver, the assignment
policy and the Auto panel** exist as of V16.2.2D1 - see
`docs/qa/V16_2_2D1_AUTO_EXECUTOR_FOUNDATION.md`. **D2 executes the `REPLANT_CROP` family end to end** -
travel, load, plant from cargo, authoritative growth, harvest into cargo, return and unload - see
`docs/qa/V16_2_2D2_RICE_AUTO_VERTICAL.md`. The orchard, mining, forestry, fishing and livestock still
plan and do not execute, and there is still no offline simulation. This document remains the contract
the remaining slices build against.

Foundations it builds on: `docs/qa/V16_2_2A_WORK_AREA_FOUNDATION.md` (work areas),
`docs/qa/V16_2_2B_ACTOR_JOB_SPINE.md` (actor + assignment configuration),
`docs/qa/V16_2_2C_ACTOR_CARGO_FOUNDATION.md` (cargo and the transfer into the warehouse), and the
architecture of record in `docs/design/AUTOMATION_LOGISTICS.md`.

## 1. The product goal

Happy Farm Auto follows the usability shape of classic MMORPG automation: **the player states intent;
the engine owns the steps.**

```text
Main Character  ->  East Rice Field  ->  Rice Farming  ->  Auto ON
```

The player never configures *buy seed, load seed, walk, plant, wait, harvest, walk back, unload,
repeat*. Those are internal steps of a **Work Skill lifecycle**. The panel exposes an actor, an area,
a skill, a couple of policies and a big START AUTO button; everything else is the engine's.

One thing Auto must not require: **bootstrapping by hand**. A completely empty 144-cell rice field
with no seeds anywhere and enough gold is a *valid* starting state, and Auto's first act is to buy and
plant.

## 2. Audited current model

| Piece | What exists today | Bearing on this design |
| --- | --- | --- |
| `work_areas` / `work_area_cells` | player-named explicit cell sets, six kinds, no ownership | the WHERE; membership is already explicit and bounded |
| `actors` | one Main Character per player, `control_mode`, `cargo_capacity`, `cargo_version`, `cargo_transfer_id` | the WHO; `control_mode` is the Auto switch's column and `cargo_version` guards transfers |
| `actor_jobs` | `actor_id`, `work_area_id`, `kind`, `target_definition_id`, dense `priority`, `enabled`, `version` | **already a work-skill identity** (section 3) |
| `actor_cargo_items` | carried goods, capacity guard in the database | the hands |
| `home_island_warehouses` + `inventory_items` | the Home Warehouse and its capacity guard | the destination of UNLOAD and the source of LOAD |
| shop | `POST /shop/buy` priced from the catalogue, wallet + ledger + receipt, `maxQuantityPerRequest` | the source of purchased supplies |
| crops | `growthDurationSeconds`, seed item, harvest item/quantity/xp | `REPLANT_CROP` |
| production trees | `firstReadySeconds`, `regrowSeconds`, sapling + fruit | `PERENNIAL_PRODUCTION` |
| resource nodes | `verb` (MINE/CHOP), `actionSeconds`, `regenerationSeconds`, per-zone `available_at` | `RESOURCE_NODE_GATHERING` |
| fishing | spots + tables + start/settle/cancel, `ready_at` | `FISHING` |
| authority | server derives player -> farm -> actor; versions and receipts everywhere | the executor inherits it and adds no new trust |

Two audited facts decide much of the rest:

1. **`actor_jobs` already stores exactly what a Work Skill names.** A `FARM` assignment whose target
   is `crop_rice` *is* rice farming. No new column is needed to introduce skills, and no migration
   should be written purely to rename anything.
2. **Cargo only flows one way today** (Cargo -> Warehouse). The design needs LOAD (Warehouse ->
   Cargo) and it does not exist (section 14).
## 3. Decision 1 - terminology, with no destructive migration

| Layer | Name | Notes |
| --- | --- | --- |
| Database / repositories | `actor_jobs`, `job_*`, `JobId`, `ActorJobRepository` | **unchanged.** A migration that renamed tables and columns would risk real player configuration for a vocabulary change, and would buy nothing a reader cannot get from a comment |
| Domain / application / docs | **Work Assignment** | the same rows, renamed in prose and in new type aliases where it reads better |
| Player-facing text | **Assignment**, or the skill's own name ("Rice Farming") | "Job" is retired from the UI |

The word *Job* stays in the code as the durable name; the word *Assignment* is what the product calls
it. Both are recorded here so a future reader does not think two concepts exist.

`WorkSkill` is **not** a third entity. It is the *interpretation* of an assignment's `(kind, target)`
pair (section 4).

## 4. Decision 2 - Work Skill identity

A skill id is stable, lowercase, dot-separated, and **derived** from the assignment:

```text
skillId            = <kind, lowercased>.<target short name>
farm.carrot        <- kind FARM     + target crop_carrot
farm.rice          <- kind FARM     + target crop_rice
orchard.apple      <- kind ORCHARD  + target tree_apple
mining.iron        <- kind MINING   + target resource_iron
forestry.wildwood  <- kind FORESTRY + target resource_wildwood
fishing.basic      <- reserved (no assignment kind exists yet)
livestock.cattle   <- reserved (no livestock system exists yet)
```

The short name is the target id with its namespace stripped (`crop_rice` -> `rice`,
`tree_apple` -> `apple`, `resource_iron` -> `iron`). That mapping is a pure function, so the id is
never stored, never sent by a client, and cannot drift from the pair it describes.

**When a skill id would need to be stored:** the moment two skills share a `(kind, target)` pair - a
"plant-only" variant beside "full cycle", or a fishing skill distinguished by ground rather than by
fish. That is a real product change and earns a real migration (`actor_jobs.skill_id`); a renaming
does not.

## 5. Decision 3 - where each layer lives

| Layer | Owns | Example |
| --- | --- | --- |
| `packages/game-data` | the **definition**: which skills exist, their family, target, inputs, outputs, timings | `{ id: "farm.rice", family: "REPLANT_CROP", kind: "FARM", targetDefinitionId: "crop_rice", inputItemId: "item_rice_seed", outputItemId: "item_rice" }` |
| `packages/domain` | the **semantics**: family rules, the action vocabulary, the legality of a transition, capacity arithmetic | "a REPLANT_CROP plan is not actionable while the actor carries no seed" |
| `packages/application` | the **use cases**: resolve-next-action, and the commands an action turns into | `ResolveNextAction`, `LoadCargo`, `UnloadCargo`, `BuyItem` |
| `workers/*` | the **executor**: read state, ask the resolver, perform the action, persist | not in this phase |

A skill definition is data and must not contain execution code. If a family rule differs per crop, the
difference is a **field** on the definition (duration, stages, seeds per cell) or a new *family* - not
a branch inside the executor.

## 6. Decision 4 - lifecycle families

```text
REPLANT_CROP            farm.*                acquire input -> plant -> wait -> harvest -> haul -> repeat
PERENNIAL_PRODUCTION    orchard.*             plant once -> wait -> harvest -> haul -> wait again
RESOURCE_NODE_GATHERING mining.* forestry.*   travel -> gather -> wait for regeneration -> repeat
FISHING                 fishing.*             travel to ground -> fish -> haul -> repeat
LIVESTOCK               livestock.*           feed -> wait -> collect -> haul -> repeat
```

A family is the reusable state machine; a definition is its parameters. Adding `farm.corn` is a
definition, not a new machine. A crop that genuinely behaves differently gets a new family or an
explicit exception hook - and the design keeps that door open by making the family a definition field
rather than a class hierarchy.
## 7. Decision 5 - the rice lifecycle (`REPLANT_CROP`)

```text
        +-------------------< ACQUIRE_INPUT >--------------------+
        |  carried seed? else warehouse seed? else BUY (policy)   |
        v                                                         |
     LOAD_INPUT  (Warehouse -> Cargo, or bought straight in)      |
        |                                                         |
        v                                                         |
   TRAVEL_TO_AREA                                                 |
        |                                                         |
        v                                                         |
     PLANT (valid empty cells, one seed each)                     |
        |                                                         |
        v                                                         |
   WAIT_GROWTH  (server timestamps only; the actor is free)       |
        |                                                         |
        v                                                         |
     HARVEST (mature cells) -> reward enters Cargo                 |
        |                                                         |
        v                                                         |
    CARGO_FULL? --- no ---> back to PLANT (replant the freed cells)
        | yes
        v
   TRAVEL_TO_STORAGE -> UNLOAD -> ACQUIRE_INPUT (replanting needs seed again)
```

Rules the machine must keep:

- **An empty area is the normal first state**, not an error.
- Planting consumes exactly one seed per cell through the existing inventory/cargo boundary; the
  harvest reward is the existing crop settlement, re-pointed at cargo in a later slice.
- `WAIT_GROWTH` writes nothing and polls nothing: maturity is a comparison against
  `planted_at + growthDurationSeconds` on the server's clock.
- The harvest frees the cell, so the next pass plants it again - which is why the family is
  `REPLANT_CROP` rather than "harvest".
- Output never teleports: it lands in cargo and reaches the warehouse only through UNLOAD.

## 8. Decision 6 - the apple lifecycle (`PERENNIAL_PRODUCTION`)

```text
no apple trees in the area?
   yes -> ACQUIRE_INPUT (sapling) -> LOAD -> TRAVEL -> PLANT ONCE
        |
        v
   WAIT_PRODUCTION (firstReadySeconds, then regrowSeconds per cycle)
        |
        v
   HARVEST -> Cargo
        |
        v
   CARGO_FULL? -> TRAVEL_TO_STORAGE -> UNLOAD -> return
        |
        +--> WAIT_PRODUCTION again  (never buy another sapling)
```

**The tree is not re-bought.** An apple tree is standing capital; the harvest settlement already
models the repeating cycle (`last_harvested_at` + `regrowSeconds`), and the skill's job is to be there
when a cycle is ready.

Mixed areas are the interesting case, and the product semantics are:

| Area state | Skill behaviour |
| --- | --- |
| every valid cell holds a matching tree | straight to `WAIT_PRODUCTION` / `HARVEST`; **no purchase** |
| some cells hold matching trees, some are empty and valid | harvest the trees; plant saplings only in the empty *valid* cells, and only if the supply policy allows |
| cells hold other trees, crops, buildings or decorations | **skipped.** Auto never replaces what it did not plant |
| no valid cells at all | not actionable: `NO_CAPACITY_FOR_TARGET`, surfaced as a configuration problem |

## 9. Decision 7 - mining (`RESOURCE_NODE_GATHERING`)

```text
eligible node available in the area?  (definition kind MINING, verb MINE, target matches)
   no  -> WAITING_FOR_RESOURCE (nodes deplete and regenerate on their own clock)
   yes -> TRAVEL_TO_NODE -> MINE (the existing start/settle action)
             -> reward enters Cargo -> repeat while cargo has room and nodes are available
             -> CARGO_FULL -> TRAVEL_TO_STORAGE -> UNLOAD -> return
```

Auto creates no resource: the node's own `available_at` and the existing settlement decide
everything. Depleted nodes are waited on, never reset and never duplicated.

## 10. Decision 8 - forestry (`RESOURCE_NODE_GATHERING`)

Identical to mining with `verb = CHOP` and a wood-family target. The family is shared on purpose: the
two differ in their definition (verb, timings, drops, level) and in nothing structural, which is the
whole point of a family.

## 11. Decision 9 - fishing (`FISHING`, future)

```text
prepare supplies if a ground requires them (later: bait)
  -> harbour / shore
  -> TRAVEL_TO_GROUND (a spot today; a water area later)
  -> FISH (start / settle)
  -> catch enters Cargo
  -> CARGO_FULL or a completed session -> return -> UNLOAD -> repeat
```

Design constraint, not implementation: the same shapes must serve a **Ship** actor - a different
capacity, the same cargo, the same assignment, the same waiting states. The Skill abstraction is what
makes that true: where the fishing happens is a property of the target, not of the machine.

## 12. Decision 10 - livestock (`LIVESTOCK`, future)

```text
ACQUIRE_FEED -> LOAD -> TRAVEL -> FEED -> WAIT_PRODUCTION
   -> COLLECT (eggs, milk, meat by lifecycle) -> Cargo
   -> CARGO_FULL -> TRAVEL_TO_STORAGE -> UNLOAD -> return -> replenish feed -> repeat
```

No livestock system exists, so this family is **vocabulary only**. Its shapes are deliberately close
to `PERENNIAL_PRODUCTION` so the slice that builds livestock is data plus a family rule rather than a
new architecture.
## 13. Decision 11 - supply resolution

```text
1. seed/feed/material already in Actor Cargo        (no state change)
2. else in the Home Warehouse                      -> LOAD (atomic transfer, section 14)
3. else, if the assignment's Auto Purchase is ON   -> BUY (section 14), straight into Cargo
4. else                                            -> WAITING_FOR_SUPPLY
```

Every step is physical: nothing appears in the actor's hands without a transfer or a purchase that
actually moved it. Gold never turns into a planted field.

## 14. Decision 12 - Warehouse -> Cargo LOAD, and Decision 13 - Auto Purchase

**LOAD is the exact mirror of the UNLOAD that already exists**, with the same properties:

| Property | How |
| --- | --- |
| atomic | one transaction: subtract the warehouse rows, add the cargo rows |
| all-or-nothing | if cargo cannot take it all, nothing moves (`CARGO_FULL`) and the warehouse is untouched |
| conserving | `warehouse[item] + cargo[item]` is identical across success, failure and replay |
| capacity-safe | the **cargo capacity trigger** is the authority; the warehouse side only shrinks |
| idempotent | a receipt in the same transaction, `(actor, LOAD_CARGO, requestId)` |
| bounded | a requested stack list, capped per request and by what the container can hold |
| authority | the client sends a request id, a cargo version and *which items*; never an owner, never a capacity, never a quantity it cannot ask for |

Guard shape: reuse the UNLOAD marker pattern (`actors.cargo_transfer_id = requestId`) so a losing
concurrent LOAD cannot pay out twice. **Not implemented in this phase.**

### Auto Purchase: A (shop -> Cargo), not B (shop -> Warehouse, then LOAD)

| Criterion | A: shop -> Cargo | B: shop -> Warehouse, then LOAD |
| --- | --- | --- |
| physical semantics | the actor is *at* the shop; it pays and takes the goods | goods appear in a warehouse the actor may be nowhere near |
| economy integrity | identical: catalogue price, wallet debit, ledger row, receipt, item validation | identical |
| atomicity | one settlement, one destination | two settlements, or one settlement plus a transfer that can fail |
| reuse | the existing shop settlement gains a *destination*: one field with two legal values | reuses `BuyItem` unchanged, then needs LOAD anyway |
| D1 cost | one batch | two batches |
| failure modes | `CARGO_FULL` before gold moves | gold moves, then LOAD fails: the goods sit in the warehouse while the actor waits |
| manual players | unaffected - their purchase still goes to the warehouse | unaffected |

The decisive argument is the failure mode: with B, gold is spent and the seed is somewhere the actor
cannot use it, which the executor then has to represent as a waiting state it did not need. A keeps
"I paid and I am holding it" true in one transaction.

This is a **narrow extension** of the existing settlement, not a parallel economy: same price, same
wallet, same ledger reason, same receipt, same item validation - only the destination row differs, and
the cargo capacity trigger replaces the warehouse trigger as the limit.

## 15. Decision 14 - actionable priority (no starvation)

```text
for each enabled assignment, in priority order:
    if resolveNextAction(assignment, actor, world) is not WAIT/PAUSE:
        run it, and stop looking
otherwise the actor is idle, with the reason from the highest-priority assignment
```

The executor asks for the highest-priority **actionable** assignment, not for assignment #1. Rice
that is still growing must not block an apple orchard that is ready - which is exactly the brief's
example.

## 16. Decision 15 - overlapping work areas

Work areas stay allowed to overlap (V16.2.2A: membership is orchestration metadata, not occupancy).
Conflicts are resolved **at execution time**, deterministically:

1. A target (a cell, a node, a fishing spot) may be worked by at most one assignment *in a pass*.
2. If two enabled assignments can act on the same target, the **lower `priority` number wins**; the
   loser skips that target and considers its own next one.
3. If that leaves the loser with nothing, it is not actionable this pass - no error, no mutation.
4. Nothing is required in the schema: the rule reads the two assignments that already exist, and
   removing the conflict is a UI suggestion ("this cell is claimed by *Apple Orchard*"), not a
   database constraint.

## 17. Decision 16 - Actor Auto vs Assignment enabled

| Field | Meaning | Where |
| --- | --- | --- |
| `actors.control_mode` | who decides what the actor does *next*: the player, or the executor | actor row (exists) |
| `actor_jobs.enabled` | this assignment is eligible for Auto at all | assignment row (exists) |
| derived status | what the actor is doing, or why it is not | computed per read (section 19) |

All three are needed for work to happen: **Auto ON + at least one enabled, actionable assignment.**
Three enabled assignments under a `PLAYER_CONTROLLED` actor execute nothing; an `AUTO_CONTROLLED` actor
with every assignment disabled is idle. Neither field substitutes for the other, and the panel shows
them separately.

## 18. Decision 17 - manual takeover

```text
AUTO_CONTROLLED --[player input]--> PLAYER_CONTROLLED
PLAYER_CONTROLLED --[START AUTO]--> AUTO_CONTROLLED
```

- The takeover is a **control-mode change on the same actor**. No second actor, no second cargo, no
  re-created assignment.
- An in-flight action is *abandoned*, not half-done: every settlement in the game is already atomic,
  so an action either completed before the takeover or did not happen at all. There is no partial
  write to unwind.
- Cargo stays exactly where it is; the player may spend it, load it or ignore it.
- Assignments, their order and their enabled flags are untouched - takeover is not a pause button on
  configuration.
- Re-enabling Auto resumes from the world as it is, not from a remembered step: the resolver is a pure
  function of current state, so there is no stale plan to reconcile.

## 19. Decision 18 - waiting states

The **executor's** vocabulary (authoritative, derived, never a UI label):

```text
IDLE  TRAVELLING  WORKING
WAITING_FOR_GROWTH  WAITING_FOR_RESOURCE  WAITING_FOR_SUPPLY
WAITING_FOR_FUNDS  WAITING_FOR_STORAGE  CARGO_FULL  PAUSED
```

- **Derived, not persisted.** A waiting reason is a function of the assignment, the actor and the
  world (crop timestamps, node `available_at`, wallet, cargo, warehouse). Storing it would add a write
  per transition for information the next read can compute, and a stale stored reason is worse than
  none. The one thing that *will* be persisted is an offline watermark (`actors.simulation_at`), in
  the offline slice, because it is history rather than a label.
- The **UI presentation** is a thinner, translated vocabulary ("Waiting for the rice to grow",
  "Buying 20 rice seed"). Internal names such as `WAITING_FOR_STORAGE` are never shown to players.
- `CARGO_FULL` and `WAITING_FOR_STORAGE` change what is *actionable*: while cargo is full, work whose
  reward cannot fit is skipped, and the next actionable thing is usually `TRAVEL_TO_STORAGE`.
## 20. The next-action contract (for the executor slice)

```ts
type WorkAction =
  | { kind: "BUY_INPUT"; itemDefinitionId: string; quantity: number }
  | { kind: "LOAD_INPUT"; itemDefinitionId: string; quantity: number }
  | { kind: "TRAVEL_TO_AREA"; workAreaId: string }
  | { kind: "TRAVEL_TO_STORAGE" }
  | { kind: "PLANT"; cells: readonly TileCoordinate[] }
  | { kind: "HARVEST"; targets: readonly string[] }
  | { kind: "GATHER"; nodeId: string }
  | { kind: "WAIT"; reason: WaitReason; until?: string }
  | { kind: "UNLOAD" }
  | { kind: "PAUSE"; reason: WaitReason };

resolveNextAction(assignment, actor, world): WorkAction
```

Responsibilities, in the order the design cares about:

- **Pure.** No reads, no writes, no clock of its own: the caller hands in everything it read, so a
  transition is unit-testable without a database and a future offline reconciliation is the same
  function over a different clock.
- **Server-only.** It never ships to the client. The client shows what the server reported; it never
  decides the next step.
- **Bounded.** It looks at one assignment and the world facts that assignment can see - its area's
  cells, its target's instances or nodes, the actor's cargo and the wallet - never the whole island.
- **Total.** Every state maps to an action, a wait with a reason, or a pause with a reason. "Nothing
  to do" is never an exception.

## 21. Decision 19 - UI architecture

The panel is a **game-native Auto management sheet**, not a table editor: one actor, one assignment,
one skill, a few policies, one big button, with advanced policy behind disclosure.

```text
+---------------------------------------------------------------+
| [portrait] Main Character            Player control  [AUTO off]|
| Cargo 12 / 30                                                  |
+---------------------------------------------------------------+
| WORK AREA                                                      |
| [thumbnail] East Rice Field - Field - 144 cells - 120 usable   |
+---------------------------------------------------------------+
| WORK SKILL                                                     |
| [icon] Rice Farming                                            |
| Maintain rice in this field.                                   |
| [seed] -> Plant -> Grow -> Harvest -> Warehouse -> (repeat)     |
+---------------------------------------------------------------+
| SUPPLY      Use what I carry, then my Warehouse  [x] Buy seed  |
| DELIVERY    Home Warehouse                                     |
| PRIORITY    1 of 3                     [Move up] [Move down]   |
+---------------------------------------------------------------+
| Status: Waiting for the rice to grow (4:12)                    |
|                        [   START AUTO   ]                      |
+---------------------------------------------------------------+
```

Cards and thumbnails over dropdowns - a dropdown appears only where the choice is long and unordered,
such as picking a skill. The production-cycle strip is the *only* place internal steps appear, and it
is a picture rather than a list. Advanced policy (gold reserve, budget, maximum unit price) lives in a
second sheet that does not exist until it has a rule to hold.

## 22. Decision 20 - the nine states the panel must handle

| State | What the panel shows |
| --- | --- |
| No assignment | one invitation card - "Put your character to work" - with the skill chooser open |
| Configured, Auto off | the card above, `START AUTO` prominent, status "Ready" |
| Auto running | status-first: the current action in plain language, progress where it is known |
| Waiting for growth | "Waiting for the rice to grow - 4:12" (server-provided), nothing pressed |
| Waiting for supplies | "No rice seed: buy or load some", and "Buy 20" when purchases are allowed |
| Not enough gold | "Needs 40 gold, you have 12" - the purchase is disabled and the reason is stated |
| Cargo full / returning | "Cargo 30/30 - returning to the Warehouse" |
| Warehouse full | "The Warehouse is full - nothing is being sold or destroyed" |
| Player controlling | "You are driving", with `START AUTO` to hand back; assignments stay listed |

Every one is a *presentation* of facts the server already owns; none asks the client to infer a rule.

## 23. Decision 21 - mobile architecture

The panel is a **bottom sheet** on a phone: one sheet, one column, 44px minimum touch targets, no
horizontal scrolling, no dense tables and no tiny reorder arrows - reordering is a drag handle on a
full-width row (over the transactional reorder that already exists) or two large buttons in a reorder
mode. The skill chooser and the advanced policy are their own stacked sheets rather than nested inside
the first. Desktop is the same component with the sheet laid out as a floating card.

## 24. Decisions 22-23 - future actors, and offline

| Future shape | What it needs from this design |
| --- | --- |
| **NPC worker** | nothing new: cargo is keyed by `actor_id`, assignments by `actor_id`, and the panel already takes an actor. Hiring is deferred; nothing assumes one actor |
| **Ship / vehicle** | a different capacity from the same `CargoCapacityLookup`, and skills whose definitions name a water target. The executor is actor-agnostic; the only new thing is travel on water |
| **Offline (<= 24 h)** | `actors.simulation_at` as a derived watermark, a bounded transition budget per pass, no event log, no cron, no per-actor timer. Because the resolver is pure, catch-up is the same function run with the watermark as its floor - the design must not require a tick to be correct |
## 25. Test plan (designed before implementation)

The scenarios the brief lists, mapped to the slice that must prove them. Rows marked *pure* are
resolver tests over a hand-built world; the rest run through the real handler.

| Scenario | Slice | Kind |
| --- | --- | --- |
| empty rice work area, no seed anywhere, enough gold | D2 | pure + API |
| partially planted rice area | D2 | pure |
| area with occupied and invalid cells | D2 | pure |
| existing apple orchard (trees present) | D3 | pure + API |
| empty apple orchard | D3 | pure + API |
| insufficient seed in the warehouse, none carried | C.6 | API |
| seed already in the warehouse (the LOAD path) | C.6 | API |
| seed purchase required | D1/D2 | API |
| not enough gold | D1/D2 | API |
| cargo nearly full / full while harvesting | D1/D2 | API |
| warehouse nearly full / full on return | D1 | API (UNLOAD already covers it) |
| multiple enabled assignments at different priorities | D1 | pure |
| higher priority waiting, lower priority actionable | D1 | pure |
| two overlapping assignments claiming one target | D1 | pure |
| manual takeover mid-route | D1 | API + integration |
| manual takeover with cargo on board | D1 | API |
| re-enable Auto with cargo still on board | D1 | API |
| two browser tabs | C.6/D1 | API (versions and receipts) |
| request replay | C.6/D1 | API |
| server restart | D1 | integration (all state is in the database) |
| 24 h offline cap | offline slice | integration |

Two suites already exist and must stay green as the executor lands: the UNLOAD conservation
regression (`tests/api/cargo-transfer.test.ts`) and the "no job or cargo query from the poll, the
frame, the pointer or the movement loop" source guards.

## 26. Performance and D1 analysis

Non-negotiable for every slice here:

```text
no frame DB writes            no movement DB write per step
no Job polling                no Cargo polling
no global actor tick          no per-crop or per-actor timer
no cron                       Auto is event- and timestamp-driven
```

- **Idle actor:** near-zero. Nothing is written while nothing happens; a waiting state is a
  comparison of timestamps.
- **Growing crops:** the actor does not sit in a loop. A pass ends in a wait that knows *when* it
  ends, and the next pass is triggered by the player's own action set (or, later, by opening the
  game) - not by a server tick.
- **A pass costs a bounded read set:** the assignment, its area's cells, the target's instances or
  nodes inside that area, the actor's cargo, and the destination warehouse total. Each already has an
  index (work areas by farm, cells by area, jobs by actor and priority, cargo by actor, inventory by
  player).
- **The panel** reads on open and after its own actions - the same two-or-three bounded reads the
  Workers panel already makes. A running Auto with the panel *open* is a real product question (it
  wants a push channel, not a poll); the answer is the future realtime slice, and the interim rule is
  that the panel refreshes when opened and after an action, never on a timer.

## 27. Recommended implementation slices

Each is independently shippable and leaves the game playable if the next never lands.

| Slice | Content | Why it is separate |
| --- | --- | --- |
| **C.6** | **built** - LOAD (Warehouse -> Cargo) and the supply acquisition (Shop -> Cargo through the ordinary settlement), with no migration needed | it was the missing half of the physical model and needed no executor |
| **D1** | **built** - the **resolver** (`resolveNextAction`/`resolvePass`) as a pure function, the action vocabulary, the per-assignment supply policy (`actor_jobs.auto_purchase_supplies`), `control_mode` switching, and the panel's status states. Planning only: no action is performed | the hard, testable brain lands before anything can move; everything after is wiring |
| **D2** | **built** - the rice (replanting crop) vertical slice: empty field -> load/buy seed -> walk -> plant from cargo -> wait -> harvest into cargo -> return -> unload -> replant, Main Character only, driven by `POST /farms/:id/auto/step` with `actor_auto_state` as the only new persistence | one profession, end to end, proves the whole pipeline |
| **D3** | **Apple (perennial)**: plant once, harvest cycles, existing-orchard recognition, mixed-area semantics | a different family, deliberately after the first one works |
| **D4** | **Mining + forestry**: the shared `RESOURCE_NODE_GATHERING` family over the existing node lifecycle | reuses the family once D1/D2 have proven the loop |
| **D5** | **Fishing** integration, then livestock (a new system), then NPC workers | each is its own product decision |
| after | offline <= 24 h reconciliation (the watermark), then NPCs, then livestock | offline is a *widening* of a spine that already exists, never the first step |

The rule that must survive this ordering: **never implement Auto as one giant phase.** Each slice is
small enough to review, and each leaves the manual game exactly as it was.

## 28. Open questions and risks

- **Panel updates while Auto runs.** Without a push channel the panel is stale between actions. The
  interim answer (refresh on open and after actions) is honest but not delightful; the realtime slice
  should be designed before Auto is public.
- **Travel time.** There is no travel model yet. If travel is instant, `TRAVELLING` is decorative and
  Auto reads as teleporting; if it is real, it needs the route/cargo slice and its own cost model. D2
  should decide, because the answer changes how much the waiting vocabulary carries.
- **Purchase policy.** MVP is one boolean. A player with a full warehouse and no gold could still see
  "Buy seed" offered; the second policy sheet (gold reserve, budget cap) is the fix, deliberately not
  built now.
- **A target with no eligible cells or nodes** ("a mining area whose nodes are all outside it") is a
  configuration error the panel should show, not a silent idle: the resolver returns `PAUSE` with that
  reason and the UI must say it.
- **Two skills on one target** is the trigger for a stored `skill_id` (section 4); until then,
  deriving is strictly better.
- **Overlap is resolved per pass**, so two assignments can trade a target between passes if their
  priorities change; the rule is deterministic per pass, not a lock. If that proves confusing in
  practice, the fix is a UI warning, not a schema constraint.

## 29. Required decisions, in one table

| # | Decision |
| --- | --- |
| 1 | Database keeps `actor_jobs`; the product calls it a **Work Assignment**; "Job" leaves the UI. No rename migration |
| 2 | Skill identity is **derived** from `(kind, target)` as `<kind>.<target short name>`; stored only if two skills ever share a pair |
| 3 | Definitions in `game-data`, semantics in `domain`, use cases in `application`, the executor in `workers` |
| 4 | Families: `REPLANT_CROP`, `PERENNIAL_PRODUCTION`, `RESOURCE_NODE_GATHERING`, `FISHING`, `LIVESTOCK` |
| 5 | Rice: ACQUIRE -> LOAD -> TRAVEL -> PLANT -> WAIT -> HARVEST -> (cargo full ? UNLOAD) -> replant |
| 6 | Apple: plant once, then wait/harvest/haul cycles; existing trees recognised; never replaces what it did not plant |
| 7 | Mining: eligible node -> travel -> mine -> cargo -> repeat; depleted means wait |
| 8 | Forestry: the same family with `verb = CHOP` |
| 9 | Fishing: supplies -> ground -> fish -> cargo -> return; the same shapes serve a ship |
| 10 | Livestock: feed -> maintain -> wait -> collect -> haul; vocabulary now, system later |
| 11 | Supply: carried -> warehouse (LOAD) -> purchase (policy) -> otherwise wait |
| 12 | Auto Purchase: **A**, straight into the actor's cargo, through the existing authoritative settlement |
| 13 | LOAD: the mirror of UNLOAD - atomic, all-or-nothing, conserving, capacity-safe, idempotent, marker-guarded |
| 14 | UNLOAD: already implemented in V16.2.2C; reused unchanged |
| 15 | Priority: highest-priority **actionable** assignment, never simply #1 |
| 16 | Overlap: resolved at execution time by priority; no schema constraint |
| 17 | Control mode is the actor's; `enabled` is the assignment's; both are needed for work |
| 18 | Manual takeover: a mode change on the same actor; abandonment is safe because settlements are atomic |
| 19 | Waiting states: derived, never persisted; one watermark later, for offline |
| 20 | UI: a game-native Auto sheet - actor, area, skill, supply, delivery, priority, one button |
| 21 | Mobile: one bottom sheet, 44px targets, no tiny arrows, advanced policy in its own sheet |
| 22 | NPCs need nothing new: cargo and assignments are already actor-keyed |
| 23 | Offline <= 24 h: a watermark and a bounded, pure catch-up - no cron, no tick, no log |

## 30. Verdict

**V16_2_2C_5_WORK_SKILL_AUTO_DESIGN_READY.**

Slice status as of V16.2.2D1: C.6 (LOAD + supply purchase) **built**, D1 (control, policy, the pure
resolver, the Auto panel) **built and planning-only**. D2 onwards are unbuilt. The record for D1 is
`docs/qa/V16_2_2D1_AUTO_EXECUTOR_FOUNDATION.md`, and the line that must survive every following slice
is the one at the top of it: **the engine can plan; D1 does not execute.**

Slice status as of V16.2.2D2: C.6 and D1 **built**, and **D2 built** - the `REPLANT_CROP` family runs
end to end (walk, load, plant from cargo, grow, harvest into cargo, return, unload, replant), driven by
the browser asking the server to advance one bounded step at a time. The record is
`docs/qa/V16_2_2D2_RICE_AUTO_VERTICAL.md`. The orchard, mining, forestry, fishing and livestock still
resolve-and-wait, and offline production is still unbuilt: **D3 onwards execute nothing yet.**
