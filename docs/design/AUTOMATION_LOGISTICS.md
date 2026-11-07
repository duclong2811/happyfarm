# Automation and logistics (V16.2.2) - design only

Status: **design, with slices A-D2 built and the remaining families still unbuilt.** The work areas (A),
the actor/job spine (B), cargo (C), the bidirectional transfer and supply purchase (C.6), the Auto
control switch plus pure resolver (D1), and the **first end-to-end executor** (D2: the replanting crop
family - travel, load, plant from cargo, grow, harvest into cargo, return, unload, replant) all exist
in the repository. The orchard, mining, forestry, fishing and livestock still resolve and wait for
their own slices, and there is no offline simulation, no cron and no per-actor tick. This document is
the architecture the remaining passes build against, written after auditing the shipped game so it
reuses what is already there instead of inventing a parallel world.

Read this before adding an actor, a job, a work area, cargo, offline progression, or **anything that
can produce goods without the player's hand on the tile**. Then read the modules it names, not the
whole repository (`docs/CONTEXT_INDEX.md`).

The locked product sentence:

```text
Resources never teleport between production and storage.

WORK AREA -> JOB -> ACTOR -> PRODUCTION / COLLECTION -> CARGO -> ROUTE / TRAVEL -> STORAGE
```

## 0. Why a document before code

Happy Farm is moving from "a farm the player clicks" to "a small simulated world". The tempting
implementation of automation is the one to refuse:

```text
crop mature -> item appears in inventory      REJECTED
```

That shape has no cargo, no travel, no actor, no storage pressure, and no place to put a worker, a
cart, a ship or an expansion island later. It would also create a second economy path that bypasses
the settlements V16.2 and V16.2.1 just hardened.

The design below is therefore a **logistics** model first and an automation model second: the
automation is what an actor does while the player is elsewhere, and it settles exactly like the
player's own hands do.

## 1. Repository audit

### 1.1 What exists and is reused

| Area | What ships today | Reuse for automation |
| --- | --- | --- |
| Identity | `players`, `player_identities`, `ActorContext { playerId }`; guest cookie + Access (`docs/design/IDENTITY.md`) | An actor's owner is a player id; identity is never derived from a client field |
| Farm and land | `farms`, `farm_tiles`, free natural land (V14.5.2, `docs/decisions/0030`) | A `farm_tiles` row is tile state, not a licence; automation must not turn ownership rows into a permission |
| Place vocabulary | `ZONE_KINDS`, `ZoneRef`, `homeIslandZoneRef`, `farmIdFromHomeIslandZone` (`packages/contracts`); `GameplayContext` (`apps/web/src/interaction/context.ts`) | Actors and storage are zone-scoped; **a location is never an authorization** (ADR 0027) |
| Place-state precedent | `resource_node_states` keyed `(zone_id, node_id)`, lazily written; `fishing_actions` keyed by zone | The exact shape an actor's zone-scoped state should follow: bounded, player- or place-owned, derived from timestamps |
| World grid | `apps/web/src/render/world-cell.ts` (`WorldCell`, `CellCapability`, `cellCapabilitiesFor`) | Work-area membership speaks cells, not districts |
| Crops and trees | `crop_instances.planted_at`, `tree_instances` timestamps, maturity derived server-side (`docs/decisions/0003`, `0014`) | Production readiness is already a pure comparison: automation plans against the same function |
| Fishing | `fishing_actions(zone, spot, status, ready_at, version)`, one ACTIVE per player | An actor's in-flight work is one row with a version, not a timer |
| Resource nodes | `resource_node_states` + `resource_actions`, verb-generic (`MINE`/`CHOP`), regeneration by comparison | Forestry already proved the node lifecycle generalises; mining/forestry/fishing are the same plan shape |
| Inventory | `inventory_items`, one centralized `InventoryService`, quantity/range validation | Cargo reuses the service's validation vocabulary; the destination transfer reuses its rules |
| Warehouse | `home_island_warehouses`, DB capacity triggers, `assertStorageDeltaFits(capacity, used, deltas)` (net delta), `WAREHOUSE_FULL` (409) | The one storage authority; automation unloads *through* it, never around it |
| Economy | `wallets`, `economy_ledger`, `EconomyService`, `EconomyReason` -> one reference type per reason | Any automation that moves currency writes the same ledger row shape |
| Idempotency | `idempotency_keys(actor_player_id, operation, request_id)`, payload fingerprint, `response_json`, DB triggers per operation | Deterministic replay protection for a cycle that settles while the tab was closed |
| Atomicity | `D1DatabaseLike.batch` used as the one write unit; guarded updates on `version`; unique partial indexes for "one active X" | Every automation settlement is one batch; every "one actor does one thing" rule is a database uniqueness rule, not a check-then-insert |
| Interaction | `apps/web/src/interaction/*` splits discovery from execution; `docs/design/INTERACTION_SYSTEM.md` | Autonomous execution should call the *same* executors, not a second command path |
| Roads | `packages/game-data/src/roads/index.ts`: four tiers, `moveMultiplier`, `ROAD_WIDTH_CELLS`; roads are `farm_constructions` today | Travel cost can read a road tier's multiplier before real pathfinding exists |
| Polling | `apps/web/src/polling.ts` (5 s, visible only, growth lists only), `docs/performance/D1_READ_AUDIT.md` | Automation adds **zero** new polls; reconciliation rides the reads that already happen |
| Platform | One Worker (`workers/api/src/index.ts`) + D1 + static assets; no Durable Object bound, no cron, no queue, no KV in any `wrangler.*.toml` | The design must work without continuous execution, because the deployment has none |

### 1.2 Findings that constrain the design

1. **`workers/farm-room` and Durable Objects do not exist yet.** `AGENTS.md` plans them; no
   `wrangler` config binds one, and no code imports one. Automation therefore cannot depend on a
   per-farm object to tick. (A Durable Object *alarm* is a possible later accelerator, never a
   requirement.)
2. **There is no cron and no background worker anywhere.** The only thing that advances state today
   is a request computing the difference between an absolute timestamp and the server clock
   (crop maturity, node regeneration, fishing `ready_at`). Automation must extend that idiom, not
   introduce a scheduler.
3. **The client poll is already the cost ceiling.** `docs/performance/D1_READ_AUDIT.md` measured a
   visible idle tab at roughly 16,000 rows/hour after the V14.3.2 fix. Automation must not add a
   second timer, a per-frame read, or an "actor status" poll.
4. **`docs/CONTEXT_INDEX.md` references `apps/web/src/render/production.ts`** ("production zones",
   `ProductionZone`, `buildProductionZones`). That file and those symbols no longer exist - the
   player-built-island direction (`docs/design/WORLD_V12_PLAYER_BUILT_ISLAND.md`) replaced
   developer-defined production districts with `CellCapability` plus the player's own placement.
   **Automation must not resurrect a district that decides what land is for.** A Work Area is a
   *player-named grouping of cells*, not a district.
5. **A location is not an authorization** (ADR 0027). No automation command may accept a zone, a
   farm, an actor kind, an elapsed time, a capacity, a reward or a price from the client.
6. **Warehouse capacity is enforced in the database**, not only in application code. A cargo
   transfer that ignores the guard is a write that cannot commit - which is the desired failure,
   but the design should refuse earlier so the actor can enter `WAITING_FOR_STORAGE` instead of
   erroring.
7. **The landed economy model already locks the boundary**:
   `docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md` - "Workers consume economic inputs and cannot
   create physical capacity", "Specialisation is a comparative advantage, never a profession
   lock". Automation inherits both.
8. **One farm per player** (`farms(owner_player_id)` unique, V13.6.1). Nothing in the actor model
   may depend on that staying true, or on `farm == island == storage`.

## 2. Locked principles

```text
1. Physical logistics: production -> cargo -> travel -> storage. No teleporting goods.
2. The Main Character is the player's first worker. Never a second, invisible bot.
3. Offline automation advances at most 24 hours per absence.
4. No work -> no simulation.  No observer -> no continuous simulation.
5. Offline output is bounded by physical storage, not by an arbitrary reward cap.
6. Automation settles through the existing settlements, warehouse guards and ledger.
7. Server time is the only clock. The client never supplies elapsed time.
8. Save compatibility: an actor without configuration behaves exactly like today's manual game.
9. Geography and the asset's own rules limit placement; element/specialisation never locks a job.
10. One actor, one place, one item. An item is in exactly one location at any instant.
```

## 3. Actors

```text
ActorType = MAIN_CHARACTER | NPC_WORKER | VEHICLE | SHIP
```

**The Main Character is the player's first worker**, and it is one actor - not "a player avatar plus
an automation ghost". Whether the human is driving it or a job is, it is the same row, the same
cargo, the same position and the same settlements.

Two independent axes, deliberately not one six-value enum:

| Axis | Values | Meaning |
| --- | --- | --- |
| **Control** | `PLAYER_CONTROLLED`, `AUTO_WORK` | Who decides the next transition |
| **Activity** | `IDLE`, `TRAVELING`, `WORKING`, `HAULING`, `WAITING_FOR_STORAGE` | What the actor is physically doing |

They are independent: an `AUTO_WORK` actor can be `IDLE` (nothing actionable), and a
`PLAYER_CONTROLLED` actor can be `WORKING` (a manual harvest in flight). Collapsing them into one
enum would make "the player grabbed a hauling actor" unrepresentable, which is the exact moment the
handoff rules (section 18) exist for.

Composition, not one giant table: an actor row carries the common identity and capabilities
(`id`, `owner_player_id`, `zone_kind`/`zone_id`, `kind`, `control_mode`, `activity`, timestamps,
`version`). A ship's hull, a cart's bed and a character's equipment are capability data resolved from
game data, not columns invented now.

## 4. Offline automation, hard rule

```text
effectiveOfflineDuration = min(authoritativeElapsedTime, 24 hours)
```

* The **only** clock is the server's (`SystemClock` in `workers/api/src/runtime.ts`). No route, DTO,
  header or cookie may carry an elapsed duration; there is no field for it to travel in.
* The durable fact is a **watermark**, not a duration: `actors.simulation_at` is the instant the
  actor's simulation has been advanced to. Everything before it is settled and immutable; everything
  after it is derived.
* A reconciliation window is `[simulation_at, min(now, simulation_at + 24h)]`. If the player was
  away longer, the excess is **not** simulated: the watermark jumps to `now` when the owner is next
  observed, and automation resumes from there. Thirty days away is one day of work, never thirty.
* The watermark only moves forward, and only under a guarded update (`WHERE version = ? AND
  simulation_at <= ?`), so a replayed or reordered request cannot widen the window.

Fresh saves are compatible by construction: an actor with no job and an unset watermark is idle, and
idle is a no-op (section 11).

## 5. No continuous server simulation

Cloudflare cost rule, locked:

```text
NO WORK                -> NO SIMULATION
NO OBSERVER            -> NO CONTINUOUS SIMULATION
```

Forbidden, explicitly:

* an NPC tick every second or every minute;
* a per-actor cron, a per-field cron, or any cron that scans players;
* a D1 write per movement step or per frame;
* server-side frame simulation;
* a heartbeat whose only purpose is to advance jobs;
* a Durable Object alarm that runs when nothing is waiting on it.

Reconciliation is **lazy and event-driven**: it runs when there is a reason to look - the owner's
authenticated read (the existing farm load / `refreshFarm`), or a command that touches the actor -
and it computes what *would* have happened rather than replaying every second of it.

```text
actor departs field at 10:00, travel 2 min -> arrive 10:02
no server invocation is required at 10:02
player returns at 10:15
  -> reconciliation sees the trip completed at 10:02, then continues from there
```

An observer who is not the owner (a future visitor in a shared zone) may trigger a **bounded**
reconciliation of that zone later; that is a presence/permission feature, not part of this pass.

## 6. Timeline simulation, and its budget

The transitions that matter are decisions and completions, not seconds:

```text
TRAVEL_STARTED
ARRIVED
WORK_STARTED
WORK_COMPLETED
CARGO_LOADED
RETURN_STARTED
WAREHOUSE_REACHED
UNLOADED
WAITING_FOR_STORAGE
IDLE
```

**No event log is persisted.** The durable record is the actor's *current* transition (what it is
doing, where, since when, and when it completes) plus the watermark. Past transitions exist only as
the effects they already committed: a harvest settlement, an inventory row, a ledger row, a node's
`available_at`. This is the same choice the repository already makes for crops (a row is
`planted_at`, not a growth log) and nodes (a row is `available_at`, not a history).

Reconciliation is bounded three ways:

```text
1. the 24 h window (section 4)
2. MAX_TRANSITIONS_PER_RECONCILIATION (a hard count, e.g. 64)
3. a per-transition cost budget: one target read, one settlement batch
```

If the budget is exhausted before the window is, the watermark is written where the work stopped and
a continuation flag is set; the next reconciliation continues. There is never:

```text
while (nextEvent <= now) { ... }        REJECTED
```

over months of history. The result is **deterministic**: the same (durable state, `now`) produces the
same transitions in the same order, so a duplicated reconciliation is a no-op rather than a second
payout. Randomness is never drawn during reconciliation; where a gather needs a roll, it uses the
pinned roll from migration `0020_action_reward_rolls.sql`, which was chosen at action start and is
immutable.

## 7. Work Area

A Work Area is a **player-named group of cells** the player wants worked. It is not a district, not
an ownership record, and not a land-use decision: `CellCapability` plus the player's own placed
objects still decide what the ground may carry.

```text
WorkArea {
  id            workarea_<uuid>       stable identity
  farm_id       owned by the farm     authorization root
  zone_kind / zone_id                 where it stands (today HOME_ISLAND)
  kind          FARMING | ORCHARD | LIVESTOCK | FORESTRY | MINING | AQUACULTURE | MIXED
  display_name  player text, 1..40    gameplay-facing label
  version, created_at, updated_at
}
WorkAreaCell { work_area_id, x, y }   membership, explicit
```

**Why explicit member cells rather than a rectangle.** A rectangle is easy to draw and easy to
validate, and it is the right *editing convenience* for a phone. It is the wrong *persistent shape*:
an orchard along a shore, a mine on the volcano's flank, or a strip between two roads is not a
rectangle, and a model that stores `x, y, w, h` forces a later migration to learn geometry it did
not need. Member rows are bounded (`MAX_WORK_AREA_CELLS`, e.g. 256) and read as one indexed range
scan of the area's own rows. A future pass may add a *derived* rect view for the editor without
changing what is stored.

**Tradeoff, stated plainly:** member rows cost one row per cell (a 144-cell field is 144 rows) and
need a cell-count cap; a rectangle costs one row but cannot describe real shapes and cannot express
"these 12 cells, not the 4 in the middle". The bounded member list is chosen because work areas are
created rarely and read as a bounded set, and because the alternative is a destructive migration
later.

**Implemented (V16.2.2A).** The tables, the five commands, the ground-capability check and the estate
editor exist; nothing works an area yet - there is no Job, Actor, Cargo or offline simulation. The
kind set landed as `FARM | ORCHARD | FORESTRY | MINING | LIVESTOCK | AQUACULTURE` (the `CellCapability`
words plus ORCHARD, which asks for FARM ground) rather than the draft's `FARMING`, and `MIXED` was not
built, because a two-purpose area gives a future Job no deterministic target. Overlap between areas is
permitted. The implementation reality and what is deferred are recorded in
`docs/qa/V16_2_2A_WORK_AREA_FOUNDATION.md`.

## 8. Player-named areas: naming rules

| Concern | Rule |
| --- | --- |
| Identity | `workarea_<uuid>`, generated server-side; the display name is **never** an identifier |
| Display name | required, trimmed, 1..40 characters, Unicode (the client already ships vi/en; names may be Vietnamese) |
| Renaming | a command with an `expectedVersion`; a raced rename returns `CONFLICT_STALE_STATE` |
| Deleting | soft concern only if a job references it - either refuse while referenced, or delete and unassign; the doc recommends **refuse while referenced** so a job never silently loses its target |
| Membership editing | add/remove cells with `expectedVersion`; cells must be on the farm's own island and inside the area's kind's capability set |
| Authorization | `OWNER` of the farm (matching the existing land routes). `EDITOR`/`HELPER` are a later product decision and must not be pre-granted |
| Duplicates | allowed (two fields may honestly be "East Field" on two islands); the UI warns, the server does not merge |
| Control characters | refused (no NUL, no bidi overrides); normalisation NFC before comparison/length |

## 9. Job model

```text
Actor -> Job -> Work Area -> target/resource -> allowed actions
```

A job is the *intent*, not the work: it says "keep this area harvested", not "harvest tile 12,7".

Generic core (one table, one lifecycle, every profession):

```text
Job {
  id, actor_id, work_area_id
  status        ACTIVE | PAUSED | BLOCKED | DONE
  priority      integer, lower runs first, unique per actor
  verb          HARVEST | PLANT | CHOP | MINE | FISH | FEED | ...   (a named action set)
  target        optional filter: crop_definition_id | tree_definition_id |
                resource_definition_id | item_definition_id
  version, created_at, updated_at
}
```

Profession-specific parts stay in the profession's own modules and game data:

* what a verb means (crop replant law, tree regrowth, node depletion, livestock feed input);
* which settlement runs (harvest settlement, resource settlement, fishing settlement, future
  livestock settlement);
* seeds/inputs consumed and their source (inventory or cargo).

**There is one automation system, not one per profession.** The generic core owns selection,
priority, travel, cargo and storage; the profession owns the rule. `docs/design/RESOURCE_NODES.md`
(verb-generic nodes) and `docs/decisions/0014` (production trees reusing the harvest shape) are the
precedent: the repository already refuses to write a second lifecycle for a second resource.

## 10. Job priority, without scanning the island

```text
Actor's jobs, ordered by priority (unique, deterministic):
  1. Harvest Orange   -> Orange Orchard
  2. Rice             -> East Field
  3. Corn             -> East Field
```

Selection is deterministic and bounded:

1. For the highest-priority job, read the work area's member cells and the target rows that live on
   them - one indexed read per job, not a farm-wide scan.
2. Filter to actionable targets (mature, available, not already claimed, reachable, and the
   warehouse can eventually accept the drop).
3. Order the survivors by stable keys (distance from the actor's current cell, then target id) and
   take the first.
4. If nothing is actionable, fall through to the next job. If none is actionable, the actor is
   `IDLE` and **no write happens**.

Actor position is a cell, not a mesh coordinate, so "distance" is a bounded integer computation over
the target list - O(cells in the area), never O(island) and never a per-frame loop.

## 11. Work only when work exists

Everything the actor might do is derived from a comparison, exactly like the existing systems:

| Situation | State | Server work |
| --- | --- | --- |
| Crop not mature | `IDLE` (job not actionable) | none |
| Node depleted | `IDLE` until `available_at` | none |
| Warehouse full | `WAITING_FOR_STORAGE` | none until storage changes |
| Ship travelling | `TRAVELING` with `arrive_at` | none until someone reconciles |
| Actor has no jobs | `IDLE` | none |
| Job paused/blocked | `BLOCKED`, with a reason code | none |

An idle actor must cost **zero rows written and zero rows read by automation** - it is a row that
already exists and a watermark that is already current.

## 12. Cargo

Location-aware cargo, mirroring `inventory_items` so the same validation shape applies:

```text
CargoItem { holder_id, item_definition_id, quantity, version }
```

Holders today: the actor. Later: a cart, a ship, a local warehouse on an expansion island. The Home
Warehouse stays where it is (`inventory_items` + `home_island_warehouses`); **V16.2 inventory is not
rewritten by this design**.

The invariant that everything else depends on:

```text
An item exists in exactly one place:
  in the source, OR in the actor's cargo, OR in the warehouse - never two, never zero.
```

Transfers are therefore one atomic boundary (the durable `batch`), with the same shape the harvest
settlement already uses:

```text
remove from source (guarded on version/quantity)
+ add to destination (guarded on capacity)
+ the idempotency receipt that makes a retry a no-op
= one commit
```

## 13. Carry capacity

Capacity is **composed**, not hard-coded per profession:

```text
capacity(actor) = base(actor kind) + equipment bonus + vehicle/ship hold
```

* It is game data, resolved by the server; the client never supplies it (same rule as price, level
  and reward).
* It belongs to the actor/vehicle, never to a job.
* "Workers consume economic inputs and cannot create physical capacity"
  (`docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md`) - a bigger cart moves goods faster, it does not
  create them.
* Balance numbers are deliberately **not** chosen here.

## 14. Warehouse integration

V16.2 remains the storage authority. Locked:

```text
Automation output is limited by available physical storage.
No unlimited offline reward buffer.
```

When a full cargo cannot be accepted:

* **never** delete, overflow, auto-sell, mint gold, silently discard or duplicate;
* the recommended MVP semantic is **all-or-nothing**: keep the whole cargo on the actor and enter
  `WAITING_FOR_STORAGE`, rather than partially unloading.

Why all-or-nothing over partial: partial unloading makes "the actor is waiting with 3 of 40 wood
delivered" a state the UI, the retry rules and the tests all have to represent, and it lets a full
warehouse nibble a cargo across many reconciliations. One transfer, one decision keeps the
invariant from section 12 literal. A partial transfer is a later, explicit product decision if
playtests show that a stalled actor is worse than a fragmented delivery.

The refusal is detected **before** the write: the same read that reconciles the actor also reads the
warehouse usage, so a full destination parks the actor without a rejected batch. The database guard
(`warehouse_capacity_guard_insert`/`_update`) remains the authority on the commit.

Unblocking is ordinary play: selling frees capacity, and a warehouse upgrade raises it. The next
reconciliation sees room and resumes the unload. No notification system is required.

## 15. Storage limit = automation limit

Offline production is constrained by the whole physical chain, not by one number:

```text
output <= f( simulation time <= 24 h,
             input resources (seeds, feed, ...),
             source availability (maturity, node regeneration, cooldown),
             actor work capacity and speed,
             travel time and route accessibility,
             actor cargo capacity,
             destination storage capacity )
```

Warehouse capacity is therefore **part of the logistics chain**, not a disguised "offline reward
cap" with a nicer name.

## 16. Roads and routing

Long-term, a better road is a better economy: `docs/design/V13_ROAD_V2.md` and
`packages/game-data/src/roads/index.ts` already define four tiers with a `moveMultiplier` per tier,
and roads are persisted as `farm_constructions` with a `ROAD` category. That table is the hook; the
multiplier is metadata today because "roads cannot be built yet".

Options, and the recommendation:

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Navigable path length | server pathfinds the walkable grid | Too early; the shipped pathfinder is client-side presentation, and per-actor pathfinding on the server is the expensive thing this design exists to avoid |
| B. Straight-line estimate | distance / speed | Simplest, but a river or the volcano would be ignored and travel would read as wrong |
| **C. Hybrid (recommended)** | tile distance between cells, corrected by a per-cell movement cost from the road tier that crosses it, computed by one pure function | Cheap, deterministic, already has the data it needs; swaps for A later without changing the stored shape |

What is stored: `from_cell`, `to_cell`, `departed_at`, `arrive_at`. **Not** a polyline, and never a
stream of coordinates. The client may draw a nicer path between the two cells while the server keeps
only the endpoints and the times, exactly as the client today interpolates a walk it did not
authoritatively perform.

## 17. Online visualisation is not simulation

| Layer | Owns | Never owns |
| --- | --- | --- |
| Server (simulation) | job, target, cargo, start/completion times, route endpoints, settlement | meshes, animation, frame timing |
| Client (presentation) | interpolation between `departed_at` and `arrive_at`, walk cycles, carrying visuals, unloading animation | resources, completion, amounts, timing authority |

The client reconstructs activity from the same actor view the farm read already returns: state,
activity, from/to cells, timestamps. No per-frame server call, no actor poll, no WebSocket required
for a single-player island.

## 18. Player control versus auto

Recommended semantics:

```text
Taking control (AUTO_WORK -> PLAYER_CONTROLLED)
  - pauses future automatic transitions at the next boundary
  - preserves physical cargo (it is already on the actor; nothing duplicating can occur)
  - preserves already-settled state (harvests, ledger, receipts)
  - an in-flight server transition (a work step with an `arrive_at` in the future) is either
    allowed to finish or cancelled; the design recommends *let it finish* for work steps, because
    cancelling would have to give back partially consumed inputs

Releasing control (PLAYER_CONTROLLED -> AUTO_WORK)
  - resumes from the watermark; the actor plans its next transition from where it actually stands
```

The anti-duplication rule is structural, not a check:

```text
manual harvest and auto harvest call the same settlement,
and the settlement is idempotent per target/version,
so the second caller finds the crop gone and pays nothing.
```

## 19. Resource reservation

Two actors must not harvest the same tile. The recommendation is **claim at execution, not at
selection**, reusing optimistic concurrency:

1. A job's plan is a hint; when the actor arrives, the settlement re-reads the target and passes the
   `version` it saw.
2. The settlement's guarded update (crop/tree/node row, exactly like today's harvest and gather)
   lets exactly one actor win.
3. The loser gets `CONFLICT_STALE_STATE` (or the domain's equivalent), re-plans the next target, and
   writes nothing about the failed one.

Long-lived locks are refused: no lock may outlive the request that took it without an explicit
expiry, because an offline actor that never returns would otherwise strand a tile forever. The Main
Character Auto timeline now has a finite `lease_until` of 180 seconds, renewed at most once per 60
seconds by successful online Auto requests. Existing 24-hour state is normalized using
`lease_issued_at`; reconciliation never renews and advances only through the current lease, so a late
reconcile cannot mint work after expiry. Worker NPCs are not implicitly covered by this player-control
lease; they need their own offline policy when implemented.

## 20. Future validation: fishing boat

```text
Harbour -> Fishing Ground -> fish -> Ship Cargo -> return -> Harbour -> Warehouse
```

* The ship is an actor of kind `SHIP`; the fishing ground is a zone; the trip is
  `TRAVEL_STARTED`/`ARRIVED`; the catch is an action with a pinned roll (`0020`); the return is
  triggered by "cargo full" or "no more actionable targets".
* Cargo full at sea is not an error: the ship returns. Warehouse full at harbour is not an error:
  the ship keeps its cargo and waits (`WAITING_FOR_STORAGE`).
* No teleport, no auto-sell, no resource loss. All three fall out of sections 12-15 without a new
  concept; this is the first real test of whether the model was drawn at the right level.

## 21. Future validation: expansion island

```text
Expansion Island Mine -> Miner -> Local Storage -> Ship -> Home Harbour -> Home Warehouse
```

This is where a design that quietly assumed `farm == island == storage` breaks. The audit found:

* the zone vocabulary already separates place from player, and place-state tables are already keyed
  by `zone_id`;
* the warehouse table already carries `zone_kind`/`zone_id` with `owner_player_id`, so a second
  island is another row with a different zone rather than a redesign;
* `local storage` is therefore "a warehouse row in another zone", and a ship transfer is the same
  cargo transfer with a different source and destination holder.

The invariant `Player -> Home Island (zone) -> Region -> World` from
`docs/design/WORLD_ARCHITECTURE.md` is preserved; nothing in this design may name a farm where it
means a zone.

## 22. Five-element compatibility

```text
Element = comparative capacity and geography.  Never job legality.
```

The Fire island is not the only island allowed livestock, and the Water island is not the only one
allowed fishing: elements change *how much* and *how efficiently*, never *whether*. The automation
boundary must contain no equivalent of `if (element === "FIRE") allowLivestock()`. The element
belongs to the island, is read as a modifier on capacity/throughput, and appears nowhere in the job
or actor model.

## 23. Future validation: livestock

```text
Livestock Area -> Rancher Job -> feed input -> server time -> product
  -> Actor Cargo -> Warehouse
```

Livestock is the first case with a **consumed input on a schedule**: feed in, product out, and the
animal's own readiness timer. It must not need a new lifecycle: the job selects actionable animals
(derived from a timestamp), the settlement consumes feed from inventory/cargo and produces the
product under the same warehouse guard, and the production time is a comparison. V16.3 is not
implemented here; this is only the check that the model has a place for it.

## 24. Cloudflare free-tier cost design

The alpha target is roughly 80 active players, and that number is a **safety gate, not a claim**
(it must be benchmarked during staging). The design's obligation is to keep automation's work
proportional to *decisions*, not to time or to population.

| Scenario | Expected persistent work (qualitatively) |
| --- | --- |
| Idle actor | **0** reads and **0** writes by automation; the row is unchanged and the watermark is current |
| Actor waiting for a crop | **0** until the owner's next read; the readiness is a comparison, not a job |
| Actor travelling | **0** until reconciliation, then one transition write |
| Login after 1 h offline | 1 reconciliation: bounded transitions, each one target read + one settlement batch |
| Login after 24 h offline | Same shape, more transitions: up to the dedicated counts in section 6 (never seconds-worth) |
| Actor at a full warehouse | parks at `WAITING_FOR_STORAGE`; **0** further automation work until storage changes |
| One plant -> grow -> harvest -> haul -> unload cycle | a bounded number of transitions; the durable effects are the ones manual play already writes (crop rows, inventory, ledger, receipt) plus the actor state row |

Design rules that keep it that way: no cron, no per-actor timer, no scan of other farms, no
per-frame or per-pointer storage query, no world rebuild on an inventory change, and no N+1 read per
item in cargo (an unload is one read of the cargo rows and one batch).

**What must be measured in staging, not assumed:** rows read/written per reconciliation, transitions
per reconciliation at the 24 h cap, the effect of 80 concurrent idle tabs (already the known
ceiling), actor-view payload size, and the tail latency of a reconciliation that settles several
transitions.

## 25. Alpha online capacity (future, not implemented)

Documented requirement for a later pass: a configurable maximum number of active players
(initial target ~80), a server-side active-session lease, inactivity expiry, **no high-frequency
heartbeat**, a clear "server is full" response, admin/monitoring visibility, and request/D1
telemetry. Registered users are not active users, and 80 concurrent players is a gate, not a promise.

## 26. Security and authority

Server-authoritative, always: elapsed offline time, work completion, resource amount, cargo amount
and contents, movement completion, warehouse capacity, production reward, experience, RNG outcome,
travel duration, and every settlement.

The client may only **request**: assign a job, reorder priority, enable/disable auto, create/edit a
work area and its name, and take/release character control. Every one of those is validated,
authorized against the farm (`OWNER`), and version-guarded.

Unchanged rules from `AGENTS.md` and `.agents/skills/security-review/SKILL.md`: identity comes from
the verified session, a location is not an authorization, every payload is runtime-validated, and no
automation command may carry a price, a reward, a capacity or an owner id.

## 27. Idempotency and concurrency invariants

| Situation | Invariant | Reuses |
| --- | --- | --- |
| Two reconciliation requests | deterministic transitions + watermark guard; the loser re-reads and finds nothing to do | guarded update on `version`/`simulation_at` |
| Two browser tabs | same as above; the second sees the first's committed state | same |
| Manual + auto on one actor | manual production starts are refused while Main Character Auto is on; Auto start also refuses a live legacy action | actor control guard + action unique indexes |
| Manual + auto on one target | one settlement, version-guarded; the second caller finds it consumed | harvest/gather settlement pattern |
| Two actors, one target | one winner at execution time | optimistic `version` |
| Unload vs shop sell | both are inventory/warehouse mutations; each is its own batch; capacity is enforced in the database | `warehouse_capacity_guard_*`, `assertStorageDeltaFits` |
| Warehouse upgrade vs unload | upgrade moves tier/version; the unload's guarded write fails and retries | `0019_warehouse_upgrade_marker` |
| Disconnect during transfer | the batch either committed or it did not; cargo/source/destination can never half-move | `batch` atomicity |
| Reconnect during a job | state is in the row and the watermark; nothing is held in the socket | place-state pattern |
| Duplicate request | `(actor, operation, request_id)` + fingerprint; a cycle uses a **deterministic** request id derived from the actor and its sequence, not a random client id | `idempotency_keys` |
| Stale job configuration | every job/area write is `expectedVersion`-guarded | existing edit commands |
| Main Character lease expiry | timeline settles only through `lease_until`; later requests stop without payout | `actor_auto_state.lease_until` + event-time guard |

## 28. Save compatibility

* All automation state is **additive**: new tables/columns, no rewrite of `farm_tiles`,
  `inventory_items`, `crop_instances`, `tree_instances`, `resource_*`, `home_island_warehouses`.
* A player who never opens the automation surface has no jobs and an idle actor: the game behaves
  exactly as it does today (manual planting, harvest, buying, selling).
* The Main Character's actor row may be created lazily; if it does not exist, the read path treats
  the player as a single idle actor rather than requiring a backfill.
* Existing migrations are immutable; any new one is applied after `0020`.

## 29. Mobile management UI (concept)

```text
Main Character            AUTO WORK: ON
  1. Rice        East Field
  2. Corn        East Field
  3. Orange      Orange Orchard
  [ + Assign Job ]
  Cargo 12 / 40   [ Unload ]
```

Assignment flow: **Choose actor -> choose product/task -> choose a compatible named work area ->
set priority.** Work-area creation is tap/drag on cells with a name field; no precise mouse, no
desktop-only affordance, no dashboard full of tables. The panel is management, not simulation: it
never needs live actor telemetry to be useful.

## 30. State machines

### 30.1 Actor

```text
control: PLAYER_CONTROLLED <-> AUTO_WORK
activity: IDLE -> TRAVELING -> WORKING -> HAULING -> WAITING_FOR_STORAGE
                 ^                                    |
                 +------------------------------------+  (storage frees)
```

Legal: `IDLE -> TRAVELING` (job chosen), `TRAVELING -> WORKING` (arrived), `WORKING -> HAULING`
(cargo loaded), `HAULING -> WAITING_FOR_STORAGE` (destination full), `WAITING_FOR_STORAGE ->
HAULING/UNLOADED -> IDLE` (storage frees), `* -> IDLE` (no actionable work), control change at any
time.
Illegal: `WORKING` without a target, `HAULING` with an empty cargo, two simultaneous activities,
any transition that grants an item without a settlement, and any transition that moves cargo without
one atomic transfer.

### 30.2 Job

```text
ACTIVE -> PAUSED -> ACTIVE
ACTIVE -> BLOCKED -> ACTIVE        (no storage / target unavailable / node depleted)
ACTIVE -> DONE                     (work area exhausted, player deletes it)
```

Illegal: `DONE -> ACTIVE`; `BLOCKED` while the reason is gone; a job that runs when its actor is
`PLAYER_CONTROLLED` (a player-driven actor only does what the player asks).

### 30.3 Cargo transfer

```text
IDLE -> LOADED -> IN_TRANSIT -> ARRIVED -> UNLOADED
                                    |
                                    +-> WAITING_FOR_STORAGE -> UNLOADED
```

Illegal: cargo existing in two holders; an unload that commits without the destination guard; a
transfer that is not one batch; a discard path of any kind.

### 30.4 Offline reconciliation

```text
CURRENT -> WINDOWED(now) -> REPLAYING(bounded) -> COMMITTED -> CURRENT
                                     |
                                     +-> CONTINUATION -> (next reconciliation)
```

Illegal: an unbounded replay; a window longer than 24 h; a second simulation of an already-committed
transition; a reconciliation that changes the past (the watermark never moves backwards).

### 30.5 Warehouse full

```text
UNLOAD_READY -> WAITING_FOR_STORAGE -> UNLOAD_READY
```

Illegal: overflow, auto-sell, discard, partial commit of a batch that the guard refused, and any
path that frees capacity by deleting goods.

### 30.6 Player control <-> auto

```text
AUTO_WORK --[player takes control]--> PLAYER_CONTROLLED
PLAYER_CONTROLLED --[player releases]--> AUTO_WORK
```

Legal: taking control while `TRAVELING`, `WORKING` or `HAULING` (cargo stays with the actor).
Illegal: duplicating the actor; losing cargo on the handoff; a manual action and an auto action
settling the same target twice.

## 31. Data model proposal

Prefer fewer durable concepts. Each row below is a *proposal*, not a commitment.

| Entity | Responsibility | Key / ownership | Versioning | Indexes | Needed now? |
| --- | --- | --- | --- | --- | --- |
| `work_areas` | player-named area | `workarea_<uuid>`; `farm_id`; `zone_kind`, `zone_id` | `version` | `(farm_id)`, `(zone_id)` | Slice A |
| `work_area_cells` | membership | `(work_area_id, x, y)` | none (replace-by-list under the area's version) | PK; `(work_area_id)` | Slice A |
| `actors` | one actor per row; Main Character exists per player | `actor_<uuid>`; `owner_player_id`, `zone_kind`, `zone_id` | `version` + `simulation_at` watermark | `(owner_player_id)`, `(zone_id)` | Slice B (columns may grow through D/E) |
| `jobs` | intent + priority + verb | `job_<uuid>`; `actor_id`, `work_area_id` | `version` | `(actor_id, priority)`, `(work_area_id)` | Slice B/D |
| `cargo_items` | what an actor/vehicle carries | `(holder_id, item_definition_id)` | `version` per row (or the holder's) | PK; `(holder_id)` | Slice C |
| `actor_transition` | the one current transition (state, from/to, times) | could be **columns on `actors`** | same as actor | derived from `actors` | Prefer columns; a separate table only if a transition log is ever wanted |
| `reservations` | a soft claim on a target | - | - | - | **Deferred**; correctness uses optimistic versions |
| `route`/polyline | travel geometry | - | - | - | **Deferred**; store endpoints + times |
| `automation_events` | a history of transitions | - | - | - | **Rejected**; effects are the record |

Roughly five durable tables, and two of them (transition state, route) are deliberately columns or
derivations rather than tables.

## 32. Implementation slices (recommended order)

**Implemented so far (V16.2.2C).** Actor cargo now exists as a **separate container** from the Home
Warehouse, with an all-or-nothing, idempotent transfer between them; the grant primitive for future
rewards exists but no production path calls it yet. Manual harvest, fishing, mining and forestry still
settle straight to the Warehouse - a deliberate temporary bridge so a regression stays isolatable, not
a reversal of `production -> cargo -> warehouse`. Nothing executes, nothing moves, and there are no
routes. See `docs/qa/V16_2_2C_ACTOR_CARGO_FOUNDATION.md` (which also records the duplication path a
concurrency test found and the marker that fixed it).

**Designed next (V16.2.2C.5).** How player intent becomes a work routine: the **Work Skill** layer,
the lifecycle families, the next-action contract, the Auto panel and the implementation slices are
`docs/design/WORK_SKILLS_AND_AUTO.md`. Two of its decisions change how this document should be read:

- The durable `actor_jobs` row is the product's **Work Assignment**, and the *skill* is derived from
  its `(kind, target)` pair - so Auto needs no new entity and no rename migration.
- The executor is a **pure `resolveNextAction(assignment, actor, world)`** plus the existing atomic
  settlements, driven by the actor's `control_mode` and the assignment's `enabled`. There is no
  per-actor tick, no cron and no persisted step list, which is what keeps section 2's findings true.

**Built next (V16.2.2C.6).** The physical supply foundation a skill needs: **LOAD** (Warehouse ->
Cargo, the mirror of UNLOAD) and a **supply purchase** whose goods are taken in hand rather than
stored - the ordinary shop settlement, the same `SHOP_BUY` ledger reason, only the destination row
differs. No migration was needed. Auto still does not execute; see
`docs/qa/V16_2_2C_6_BIDIRECTIONAL_CARGO.md`.

**Implemented so far.** Slice A (work areas, V16.2.2A) and the actor/job *spine* (V16.2.2B) exist:
`actors` and `actor_jobs`, the six commands, the compatibility/priority/enabled rules and the Workers
panel. **Nothing executes** - there is no Auto switch, cargo, route, offline simulation or NPC - which
is the whole point of splitting the spine from the executor. The reality, including the one bug the
remote smoke found (a delete that left a priority gap for the next create to fall into), is in
`docs/qa/V16_2_2B_ACTOR_JOB_SPINE.md`. The remaining slices in the table below are unchanged.

**Built after that (V16.2.2D1).** The Auto **control switch** (`actors.control_mode` written through
`POST /farms/:id/workers/control`), the pure **resolver** (`resolvePass` / `resolveNextAction` in
`packages/domain/src/work-skill.ts`) with the typed next-action and wait vocabulary, the one assignment
policy the supply ladder needs (`actor_jobs.auto_purchase_supplies`, migration 0025), and the
game-native Auto panel. **D1 can plan; it does not execute** - the same rule this document's section 2
depends on. The record is `docs/qa/V16_2_2D1_AUTO_EXECUTOR_FOUNDATION.md`.

**Built after that (V16.2.2D2).** The **executor**: the browser asks `POST /farms/:id/auto/step` to
advance one bounded transition, and the server either records a walk (a row in the new
`actor_auto_state`, with the time it lands) or performs exactly one settlement through the *existing*
use cases - `LoadCargo`, `PurchaseSupplyIntoCargo`, `UnloadCargo`, `PlantCrop` (from cargo) and
`HarvestCrop` (into cargo). There is no server loop, no cron and no per-actor timer: an Auto with
nothing to do sleeps on a timestamp the server itself computed, and a hidden tab pauses it. Only the
replanting crop family executes; the rest still stop at a plan that says `NOT_EXECUTABLE_YET`. The
record is `docs/qa/V16_2_2D2_RICE_AUTO_VERTICAL.md`.

The brief's candidate order (A work areas, B actor/job, C cargo, D auto, E offline, F visuals) is
close to correct. Two changes are recommended: build the pure reconciliation **spine** early (it is
the part that cannot be retrofitted without touching everything), and do **not** enable offline
persistence in the same slice that first introduces cargo.

| Slice | Content | Shippable because | Acceptance |
| --- | --- | --- | --- |
| **V16.2.2A - Work areas** | tables, commands, naming rules, mobile editor | pure addition; no economy effect; players get named fields | create/rename/delete/member-edit with version guards; Unicode names; cross-farm refusal |
| **V16.2.2B - Actor spine** | `actors` row for the Main Character, control mode, pure timeline/reconciliation domain (no persistence of auto work yet) | the player's manual game is unchanged; the hard domain logic lands under unit tests | state machine tests; deterministic reconciliation over a fake clock |
| **V16.2.2C - Cargo + unload** | `cargo_items`, carry capacity, warehouse transfer with `WAITING_FOR_STORAGE` | physical logistics become real for the *manual* character first | capacity guard reuse; all-or-nothing transfer; full-warehouse parking; no duplication |
| **V16.2.2D - Main Character auto (agriculture)** | jobs, priority, plan/execute against crops (plant/harvest/replant) inside one work area | one profession, one vertical slice, fully observable by the player | replay/concurrency tests; manual+auto cannot double-settle |
| **V16.2.2E - Offline <= 24 h** | persist the watermark and turn reconciliation on | the spine already exists; this slice only widens the window | 24 h cap; budget/continuation; duplicate reconciliation is a no-op |
| **V16.2.2F - Online visuals** | client interpolation, carrying/unloading presentation | polish after behaviour; not needed to prove the model | no authoritative client state; no new polls |

**Explicitly later:** NPC workers (a second actor), vehicles, ships, expansion islands, livestock,
processing, shared/contested zones, presence, and WebSocket. Each is validated by sections 20-23 and
each is a product decision, not a schema blocker.

## 33. Staging deployment point

**Recommendation: deploy the current build (V16.2.1) to staging *before* V16.2.2A, and deploy again
after V16.2.2C.**

Why now rather than after the automation slice:

1. The D1 read audit already showed the free tier failing on **manual** play alone (~5.83 M rows in
   a day from browser polling). Real usage metrics - not estimates - are what should decide how much
   automation the alpha can afford.
2. Automation is the first feature that writes while the player is absent. Its cost model is only
   credible against a measured baseline of visits, session length and idle tabs.
3. The current build is complete and playable; delaying deployment to finish a system the players
   have not asked for yet trades real feedback for speculative design.

Why again after C rather than after D: C is the first slice that changes what the player physically
does (goods ride in cargo and must be unloaded). Its reception is the cheapest possible signal about
whether physical logistics feels good before jobs and offline time are layered on top.

This document does not deploy anything.

## 34. Unresolved design questions

1. **Resume semantics at the 24 h boundary.** The model here is "simulate at most 24 h, then jump the
   watermark to now". An alternative is "queue the un-simulated remainder", which buys nothing and
   complicates the watermark. Confirm the discard-on-return rule is the product intent.
2. **Does the manual Main Character carry cargo in slice C?** This changes manual play (a harvest
   requires a trip to the warehouse). It is the honest consequence of "no teleporting", but it is a
   product decision that alters an already-played loop and needs explicit approval.
3. **Partial unload.** All-or-nothing is recommended; a playtest may show that a stalled actor is
   worse than a fragmented delivery.
4. **Work-area kinds.** The list in section 7 is a proposal; the final vocabulary should come from
   the first real profession slice rather than being frozen now.
5. **Who may edit a work area** - `OWNER` only at first; `EDITOR` is a later decision.
6. **Deleting a referenced work area** - refuse (recommended) versus cascade-unassign.
7. **Actor position authority.** The server stores a cell; the client interpolates. Whether the
   server ever needs the actor's sub-cell position for gameplay (e.g. collision on a road) is open.
8. **Cross-zone actor travel** (ship, expansion island) needs the presence model that
   `docs/design/WORLD_ARCHITECTURE.md` deliberately left unbuilt; it is not needed for V16.2.2A-F.
9. **NPC hiring and wages** interact with the economy model's "workers consume economic inputs"; the
   contract (hire cost, wage cadence, firing) is not designed here.

## Appendix A. The locked answers

| Question | Answer |
| --- | --- |
| Can offline automation require zero continuous server ticking? | YES |
| Can an idle actor require zero automation writes? | YES |
| Can Main Character and Auto be the same actor? | YES |
| Can a produced resource teleport directly to the warehouse? | NO |
| Can cargo survive a full warehouse? | YES |
| Can offline progress exceed 24 h? | NO |
| Can the client choose elapsed offline duration? | NO |
| Does the design require global cron scans? | NO |
| Can future ships reuse the same logistics principles? | YES |
| Can future expansion islands use local storage without rewriting the model? | YES |
| Can current manual gameplay remain functional with automation absent? | YES |
