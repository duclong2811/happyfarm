# V16.2.2C - Actor cargo and physical transfer foundation

Date: 2026-10-04. Verdict: **V16_2_2C_ACTOR_CARGO_FOUNDATION_COMPLETE**.

Actor cargo exists as a **separate container** from the Home Warehouse, and the one authoritative
transfer between them is all-or-nothing. Nothing is automated: no movement, no routing, no Auto, and
**manual production still settles straight to the Warehouse** - a deliberate, temporary bridge
recorded in section 18.

## 1. Cargo model

```text
actor_cargo_items { actor_id, item_definition_id, quantity, version, updated_at }
                    PRIMARY KEY (actor_id, item_definition_id)
```

Cargo belongs to an **actor**, never directly to a player. Authority still derives the actor from the
authenticated player's own farm, so a client cannot name an owner, a capacity or a destination.

## 2. Capacity model

`actors.cargo_capacity`, in cargo units, with `STARTER_CARGO_CAPACITY = 30` in
`packages/game-data/src/cargo/index.ts` and handed to the application through the
`CargoCapacityLookup` port (`gameDataCargoCapacities`). On the actor row rather than in a handler,
because a backpack, an equipment upgrade, a cart or a ship is a different number for the same code -
exactly as a warehouse tier is. **Provisional balancing**, stated as such in the source.

## 3. Item classification

`CARGO_ITEM_CATEGORIES = ["CROP", "SEED", "FISH", "MATERIAL"]` in `packages/domain/src/cargo.ts`, and
the grant primitive refuses anything else. Every shipped item is one of those four, so the whole
catalogue is carryable today - but the boundary is written down rather than assumed, so a future
non-physical category has to be added deliberately. Gold and experience are not items at all: they
live on the wallet and the progression row, and no cargo path can name them.

## 4. Grant primitive

`CargoService.prepareGrant(actorId, capacity, used, itemDefinitionId, quantity)` validates the item
exists, that its category is carryable, that the quantity is a positive whole number, and that the net
delta fits - then returns a `CargoGrant`. `CargoRepository.grantAtomically` writes it, and the
database's capacity trigger is the authority. **No production path calls it yet** (section 17/18).

## 5. Unload primitive

`UnloadCargo` (all of it, not a selection) and `CargoRepository.unloadAllAtomically`: one transaction
that bumps the container version, removes every carried stack, writes the warehouse rows through the
centralized inventory service, and files the receipt.

## 6. Warehouse integration

The destination is derived from the **farm's owner** - never sent. The write is an inventory addition,
so it inherits everything the warehouse already does: the capacity guard triggers on `inventory_items`
(`warehouse_capacity_guard_insert`/`_update`) and the inventory service. No parallel storage system, no
weaker application-only check.

## 7. All-or-nothing semantics

Every statement of the transfer is scoped to a **transfer marker** the guard writes
(`actors.cargo_transfer_id = requestId`), and the whole batch is one transaction. If the destination
refuses, the batch rolls back: the cargo is still on the actor, the warehouse is untouched, and no
receipt exists. There is no partial unload, no overflow, no auto-sell and no gold conversion.

## 8. Warehouse Full behaviour

`WAREHOUSE_FULL` (409), from the trigger rather than from the pre-check. The pre-check exists only so
the common case gets a clean error before any write; the trigger is what decides, which is the
V16.2.1 lesson applied to a second container.

## 9. Idempotency

The receipt is written in the same transaction as the transfer, keyed `(actor, UNLOAD_CARGO,
requestId)`. A replay returns the stored response and moves nothing; the same request id with a
different payload is `IDEMPOTENCY_CONFLICT` (409). An unload of an empty container is an honest no-op
and writes no receipt at all.

## 10. Concurrency

A concurrency test found a real duplication path during this slice and it is fixed: a bare version
bump was not enough, because two transfers reading the same version compute the same "next" version,
so a loser could satisfy a check written by the winner and pay out twice. The guard now writes the
**request id** as the marker, and every other statement is scoped to it, so a loser's clause can never
match. Covered by tests: two concurrent unloads (one 200, one 409, and the item total unchanged), a
warehouse that fills up *after* the pre-check (409, cargo intact, no receipt), a stale cargo version,
and a replay.

## 11. Conservation invariant

A named regression asserts `cargo[item] + warehouse[item]` is identical before and after a success, a
failure and a replay, for every transferred item - the "no duplication, no loss" the brief asks for,
as arithmetic rather than as a promise.

## 12. Authority / security

`actor → owned farm → cargo`. Reads and writes are OWNER-only, exactly like the rest of Home Island
editing. The client sends a request id and the cargo version it read; it cannot choose the cargo, the
destination owner, either capacity, or a quantity. **There is no grant endpoint**: the only way to put
something in cargo on a live deployment is the future production slice, and the staging smoke asserts
that an invented grant route answers 404.

## 13. DB schema / indexes

`database/migrations/0024_actor_cargo.sql` (additive):

```text
actors                += cargo_capacity (default 30), cargo_version (default 1), cargo_transfer_id
actor_cargo_items     PK (actor_id, item_definition_id); quantity CHECK 1..; version; updated_at;
                      FK actor_id CASCADE; idx_actor_cargo_items_actor (actor_id, item_definition_id)
cargo_capacity_guard_insert / _update   RAISE(ABORT, 'cargo_full') - the warehouse guard's twin
```

No routes, simulation events, NPC or ship tables.

## 14. Query plans (measured on staging)

```text
cargo list by actor        SEARCH actor_cargo_items USING INDEX idx_actor_cargo_items_actor (actor_id=?)
cargo capacity aggregate   SEARCH actor_cargo_items USING INDEX idx_actor_cargo_items_actor (actor_id=?)
cargo item mutation        primary-key seek/insert on (actor_id, item_definition_id)
warehouse destination      SEARCH inventory_items USING INDEX sqlite_autoindex_inventory_items_1 (player_id=? AND item_definition_id=?)
```

Every read is bounded to one actor's own rows (themselves bounded by the container), and there is no
global scan and no N+1 over the item catalogue.

## 15. UI decision

**Option B, with no invented location.** The cargo strip lives in the **Workers** panel, beside the
assignments of the same actor: `Cargo 12 / 30`, the carried items, and an **Unload at Warehouse**
button. The brief's own §21 example puts the button there. Because no travel exists, the button is
labelled as the foundation affordance it is, and the copy says plainly that these goods are *carried*
and not stored. **No Warehouse location was invented**, no proximity is claimed, and authorization
stays with the session and the farm's owner - so when a later slice adds travel, it adds *eligibility*
(near the warehouse) without touching *authorization*.

## 16. D1 behaviour

Read with the worker panel (the three bounded reads it already made, plus cargo) and again after an
unload. **0** cargo queries from boot, the growth poll, the frame loop, the pointer loop or the
movement loop; no new timer (pinned by source tests).

## 17. Existing-save behaviour

Additive: two columns with defaults and one table. Existing actors gain the starter capacity and an
**empty** container; no inventory row is moved, no warehouse content is converted, no gold or
experience changes, and no save is reset. Asserted by the migration test.

## 18. Legacy manual reward compatibility (temporary, deliberately)

```text
CURRENT TRANSITIONAL STATE
  manual harvest / fishing / mining / forestry -> Home Warehouse (unchanged)
TARGET STATE
  production -> Actor Cargo -> travel -> Home Warehouse
```

This slice deliberately does **not** convert every reward path: it proves the container and the
transfer first, so a regression stays isolatable. The migration of production into cargo belongs to
the execution slices, and this note is the boundary marker so the bridge is never mistaken for the
architecture.

## 19-22. Future-shape validation

- **Main Character, manual**: harvest -> cargo -> the player keeps walking -> cargo fills -> unload at
  the warehouse. The model supports it today; the wiring is the next slice's.
- **Auto**: an `AUTO_CONTROLLED` actor harvesting into cargo and returning to unload needs no schema
  change - the container, the capacity, the transfer and the receipt all exist.
- **NPC**: cargo is keyed by `actor_id` with no Main-Character assumption anywhere in the table, the
  primitive or the transfer; a second actor is a second set of rows.
- **Ship / vehicle**: capacity comes from `CargoCapacityLookup` per actor kind, so a ship is a
  different number for the same code - not a different table.

## 23. Tests

```text
tests/api/cargo-transfer.test.ts           12 tests: empty cargo, grant to/over capacity, the primitives
                                           (unknown item, zero quantity), multi-item unload, conservation,
                                           exact-fill, warehouse-full refusal, sell-then-unload, replay
                                           and conflict, stale version, concurrent unloads, the
                                           post-pre-check race, empty no-op, no economy movement, authorization
tests/integration/actor-cargo-migration.test.ts  3 tests: additive on a live save, the guard, the FKs
tests/web/workers-panel.test.ts            cargo read/write sites and the hot-path guards
```

## 24. Gates

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         166 files, 1617 tests passed   (was 164 / 1602)
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27
git diff --check              clean
```

## 25. Migration

`0024_actor_cargo.sql`, applied to `happy-farm-staging` only (9 statements). Remote is now
`0001` - `0024`; staging has 3 actors (from earlier smoke tests), 0 cargo rows and 48 inventory rows,
all of them untouched warehouse stock.

## 26. Staging deployment

```text
Worker:      happy-farm-staging
Version ID:  70235239-88b7-4e66-8e58-c8f9eb828cf6   (2026-10-04T04:53:30Z)
Rollback:    db1e499e-fe7b-45b1-8d60-25598b55b4df   (V16.2.2B)
```

## 27. Remote smoke

```text
GET  /api/session                     200  guest
GET  /farms/:id/workers               200  actor MAIN_CHARACTER, 0 configured jobs
GET  /farms/:id/cargo                 200  {"capacity":30,"used":0,"available":30,"version":1,"items":[]}
POST /farms/:id/cargo/unload          200  honest no-op on empty cargo, and no receipt written
POST /farms/:id/cargo/grant           404  there is no grant route, by design
GET  /farms/:id/cargo (no cookie)     401
POST /api/shop/buy                    200  Market unchanged
POST /farms/:id/crops                 201  planting unchanged (legacy path)
GET  /api/warehouse                   200
GET  /farms/:id/work-areas            200  0 areas
```

**Cargo transfer is covered by deterministic API/integration tests rather than remotely**: there is no
safe, cheat-free way to seed cargo on a live deployment, and inventing one to satisfy a smoke test
would be exactly the item-grant surface the brief forbids. Remote cargo is empty, as expected.

## 28. Files changed

```text
packages/domain/src/cargo.ts                    new
packages/domain/src/actor.ts, errors.ts, index.ts
packages/game-data/src/cargo/index.ts           new (STARTER_CARGO_CAPACITY = 30)
packages/game-data/src/index.ts
packages/application/src/cargo.ts               new (CargoService, GetActorCargo, UnloadCargo)
packages/application/src/ports.ts, errors.ts, index.ts, jobs.ts
packages/contracts/src/index.ts                 cargo DTOs, unload request, error codes
workers/api/src/d1-repositories.ts              D1CargoRepository, actor cargo columns
workers/api/src/handler.ts                      two routes, wiring, error statuses
workers/api/src/runtime.ts, index.ts, dev-index.ts
database/migrations/0024_actor_cargo.sql        new
apps/web/src/api.ts, main.ts, index.html, styles.css, i18n.ts   the cargo strip
tests/api/cargo-transfer.test.ts, tests/integration/actor-cargo-migration.test.ts   new
tests/web/workers-panel.test.ts                 cargo guards
tests/api/{fishing,forestry,mining,work-area,actor-job}-loop, tests/integration/farm-uniqueness-repair   migration list + 0024
docs/design/AUTOMATION_LOGISTICS.md, docs/CONTEXT_INDEX.md, docs/DATA_MODEL.md, this file
```

## 29. Git status

The mixed working tree is preserved: nothing committed, stashed, reset or force-pushed, and no
historical WIP touched.

## 30. Deferred work

- **No production reward path is wired to cargo** - the bridge in section 18 is deliberate.
- **No travel**: no routes, no positions, no movement, no `WAITING_FOR_STORAGE` state. A failed unload
  simply leaves the cargo on the actor, and a later executor may read that as waiting for storage.
- **No per-stack unload**: the whole container goes at once, which is what a worker returning to the
  warehouse wants and what keeps the transfer one transaction.
- **Capacity is provisional** (30), and no backpack, equipment, cart or ship capacity exists yet.
- **The unload has no proximity gate**: authorization is the session and the farm's owner; a future
  slice may add location *eligibility* without touching it.
- **The cargo strip is HTTP-smoke-tested, not browser-tested**: its rendering still needs a manual pass.

## Explicit answers

| Question | Answer |
| --- | --- |
| Is Actor Cargo distinct from Home Warehouse? | YES |
| Can Cargo exceed its capacity? | NO |
| Can Warehouse overflow during unload? | NO |
| Can failed unload destroy Cargo? | NO |
| Can failed unload partially transfer items? | NO |
| Can replay duplicate items? | NO |
| Does transfer conserve total item quantity? | YES |
| Does client choose Cargo capacity? | NO |
| Does client choose destination owner? | NO |
| Does growth polling query Cargo? | NO |
| Does movement poll Cargo? | NO |
| Were existing Warehouse contents migrated into Cargo? | NO |
| Were all manual reward paths converted to Cargo? | NO |
| Was Auto execution implemented? | NO |
| Was offline simulation implemented? | NO |
| Were Routes implemented? | NO |
| Was production deployed? | NO |

Final verdict: **V16_2_2C_ACTOR_CARGO_FOUNDATION_COMPLETE**.
