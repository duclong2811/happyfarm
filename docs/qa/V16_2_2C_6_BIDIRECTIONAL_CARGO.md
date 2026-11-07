# V16.2.2C.6 - Bidirectional cargo and the Auto supply foundation

Date: 2026-10-04. Verdict: **V16_2_2C_6_BIDIRECTIONAL_CARGO_COMPLETE**.

V16.2.2C moved goods one way (Cargo -> Warehouse). This slice adds the other direction:

```text
Warehouse -> Cargo     LOAD          an authoritative, conserving transfer of stock the player owns
Shop      -> Cargo     PURCHASE      an ordinary purchase whose goods are taken rather than stored
```

**Auto still does not execute.** There is no resolver, no control-mode switch, no travel, no planting
and no automatic purchase loop; this slice builds only the primitives D1/D2 will call.

## 1. LOAD model

`CargoRepository.loadAllAtomically(load, receipt)`, driven by `LoadCargo`:

```text
LOAD_CARGO { actorId, playerId, expectedCargoVersion, itemDefinitionId, quantity,
             expectedInventoryQuantity, expectedInventoryVersion, timestamp }
```

One batch: the cargo-version guard writes this request's marker, the warehouse row is subtracted from
**exactly the state the caller read**, cargo grows (or the stack is created), an emptied warehouse row
is removed, and the receipt is written. Nothing else.

## 2. API / use case

```text
POST /farms/:id/cargo/load   { requestId, itemDefinitionId, quantity, expectedVersion }  -> { cargo }
```

The client sends a request id, an item, a bounded quantity and the cargo version it read. It never
sends an owner, a source, a capacity, a price or a category. The destination is the farm owner's Main
Character; the source is that owner's Home Warehouse.

## 3. Atomicity

One transaction, and every statement is scoped: the subtraction is guarded on
`quantity = expected AND version = expected AND quantity >= requested`, and both cargo writes are
scoped to the warehouse row having reached `expectedVersion + 1`, so **a load whose subtraction did not
happen cannot credit cargo**.

## 4. Conservation

`warehouse[item] + cargo[item]` is identical across success, failure and replay - asserted directly in
the tests (`total(item)`), including across a concurrent LOAD and UNLOAD of the same item.

## 5. Cargo capacity handling

Three layers, and the database is the authority: the request schema bounds the quantity, `LoadCargo`
pre-checks with `assertCargoDeltaFits` for a clean `CARGO_FULL`, and the **`cargo_capacity_guard_*`
triggers** refuse the row inside the transaction. Two concurrent loads that would each fit alone but
not together: exactly one wins (tested).

## 6. Warehouse quantity handling

The subtraction carries `quantity >= ?` and the row is identified by its exact quantity *and* version,
so the warehouse can never go negative and a concurrent sale or consumption fails the whole load. A
load is allowed while the warehouse is full or grandfathered over capacity: the guard only refuses a
row that *grows*, so stock can always be drawn down (tested).

## 7. Marker and concurrency

LOAD reuses the C.6 marker (`actors.cargo_transfer_id = requestId`) - the marker the C concurrency bug
produced. It is safe for both directions because the marker is per *request*, never per direction: the
guard writes it, every dependent statement is scoped to it, and a loser's clause can never match.
Tested: LOAD vs LOAD, LOAD vs UNLOAD, stale version, replay, changed payload, two tabs.

## 8. Idempotency

The receipt is written in the same batch as the mutations, keyed `(actor, LOAD_CARGO, requestId)`.
A replay returns the stored view and moves nothing; the same request id with a different payload is
`IDEMPOTENCY_CONFLICT`. The stored response is the *settled* cargo view, computed before the write, so
a replay does not need to re-read anything.

## 9-13. Supply purchase

```text
POST /farms/:id/cargo/purchase  { requestId, shopEntryId, quantity, expectedVersion }  -> { purchase }
purchase = { itemDefinitionId, quantity, currencyId, amountSpent, newBalance, cargo }
```

`PurchaseSupplyIntoCargo` + `EconomySettlementRepository.settleSupplyIntoCargoAtomically`:

- **Shop reuse**: the entry, the server's own price (`calculateShopTotal`), the currency, the item
  definition, the centralized `EconomyService` mutation (wallet + ledger), and the receipt are the
  ordinary buy path, unchanged.
- **Ledger**: the same `SHOP_BUY` reason and `SHOP_ENTRY` reference - no new ledger reason and no forked
  economy. A supply purchase is economically indistinguishable from any other purchase.
- **Item restrictions**: the item must exist and be a **supply** (`CARGO_SUPPLY_CATEGORIES = ["SEED"]`
  today, an explicit list rather than "whatever is carryable"), so a crop can be carried and still
  cannot ride this path.
- **Gold safety**: the price is never taken from the request - a request carrying `amountSpent` is
  refused by the strict schema - and the settlement is one transaction, so a failure leaves 0 items,
  0 partial cargo, 0 gold debit and 0 ledger rows.
- **Capacity**: the pre-check makes the common case clean; the cargo trigger is the authority, so a
  purchase that does not fit is refused **before** gold moves. The resolver may ask for a smaller
  quantity; the primitive never charges for goods it did not deliver.

## 14. Application primitives for the future executor

`LoadCargo`, `PurchaseSupplyIntoCargo` and `UnloadCargo` are application use cases over ports - no HTTP
in their signatures - so D1 can call them directly:

```text
loadSupplyFromWarehouse(...)   -> LoadCargo.execute(actor, farmId, command)
purchaseSupplyIntoCargo(...)   -> PurchaseSupplyIntoCargo.execute(actor, farmId, command)
unloadCargoToWarehouse(...)    -> UnloadCargo.execute(actor, farmId, command)
```

The routes are thin adapters over the same three.

## 15. API surface

```text
GET  /farms/:id/cargo            (V16.2.2C)
POST /farms/:id/cargo/load       new
POST /farms/:id/cargo/purchase   new
POST /farms/:id/cargo/unload     (V16.2.2C)
```

There is **no cargo grant route** (verified 404 remotely), and no route was added for the resolver.

## 16. UI changes

**None.** The brief scoped the UI out ("avoid spending UI effort here"; the polished Auto panel belongs
with D1/D2). The panel still shows cargo and the unload button; LOAD and purchase are API-only until
the Auto sheet is built.

## 17. Ordinary Shop compatibility

Unchanged and tested: `POST /shop/buy` still delivers to the Home Warehouse, and only the explicit
`/cargo/purchase` command takes goods in hand. The staging smoke did both in one session and watched
each land in the right place.

## 18. Manual production compatibility

Unchanged: harvest, fishing, mining and forestry still settle straight to the Warehouse (the
transitional bridge recorded in V16.2.2C), and planting still works with no cargo involved.

## 19. Existing-save behaviour

**No migration.** The slice needs no schema change: the cargo container, its capacity guard, the
transfer marker and the shop settlement all already exist. Existing warehouse stock, cargo, gold,
experience, work areas and assignments are untouched, and the smoke test exercised the new routes on a
fresh save with its real starter inventory and gold.

## 20. D1 and query plans (measured on staging)

```text
warehouse item lookup   SEARCH inventory_items USING INDEX sqlite_autoindex_inventory_items_1 (player_id=? AND item_definition_id=?)
warehouse subtraction   SEARCH inventory_items USING INDEX sqlite_autoindex_inventory_items_1 (player_id=? AND item_definition_id=?)
cargo item lookup       SEARCH actor_cargo_items USING INDEX sqlite_autoindex_actor_cargo_items_1 (actor_id=? AND item_definition_id=?)
actor capacity/version  SEARCH actors USING INDEX sqlite_autoindex_actors_1 (id=?)
wallet lookup           SEARCH wallets USING INDEX sqlite_autoindex_wallets_1 (player_id=? AND currency_id=?)
```

Every read is a unique-index seek. No polling was added: LOAD and purchase are explicit economic
events, so the idle, growth-poll, movement, pointer and frame costs are all zero.

## 21. Security review

Applied `.agents/skills/security-review/SKILL.md`:

- **IDOR / foreign actor**: the actor is derived from the authenticated player's own farm; a stranger
  gets 403 and an unauthenticated request 401 (both tested). No route takes an actor id.
- **Replay**: receipts settle with the mutations; replays change nothing; a changed payload conflicts.
- **Quantity tampering**: the schema bounds the quantity; the domain enforces the transport bound; the
  container's own capacity is the final authority.
- **Price tampering**: the price comes from the catalogue; a request that carries one is rejected.
- **Capacity tampering**: capacities are never client input; `cargo_capacity` is on the actor row and
  the trigger enforces it.
- **Negative / overflow**: quantities are positive whole numbers, bounded, and every arithmetic result
  is checked as a safe integer.
- **Concurrent wallet spend**: the ledger's wallet guard does the work, exactly as for an ordinary buy.
- **Concurrent inventory consumption**: the subtraction is scoped to the exact row state.
- **Receipt collision**: `(actor, operation, requestId)` is the primary key.
- **Marker races**: the per-request marker is what prevents a losing transfer from paying twice.
- **No cheat surface**: there is no grant route, and neither new route creates an item - one moves
  stock the player already owns, the other is a paid purchase.

## 22. Tests

`tests/api/cargo-load-supply.test.ts` (18 tests):

```text
LOAD    success and conservation; exactly-fills; over capacity refused with both sides intact;
        insufficient warehouse quantity; unknown item; zero / negative / oversized quantity;
        replay; changed-payload conflict; stale version; two concurrent loads; concurrent LOAD+UNLOAD;
        load after a sale; load while the warehouse is full; foreign player; unauthenticated
PURCHASE  the supply boundary is narrower than the carryable one; buy into cargo with gold down,
        ledger written and the warehouse untouched; exactly-fills; over-capacity refused without
        charging; insufficient gold; the price is the catalogue's (a request price is rejected);
        unknown entry; replay; two concurrent purchases; ordinary /shop/buy still stores
```

Existing suites stay green, including the UNLOAD conservation regression and the "no cargo query from
the poll, the frame, the pointer or the movement loop" source guards.

## 23. Gates

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         167 files, 1636 tests passed   (was 166 / 1618)
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27
git diff --check              clean
```

## 24. Migration

**None.** No schema change was required, and none was invented.

## 25. Staging deployment

```text
Worker:      happy-farm-staging
Version ID:  2c9ac70a-d68b-43c9-bad3-a3670404fc20
Rollback:    a536d5ad-2f5f-4aa2-88ae-9c52a03f819a   (the same slice before the cargo-version fix)
```

## 26. Remote smoke

With a fresh guest's real starter state (100 gold, 10 carrot seeds) - no debug grants:

```text
GET  /farms/:id/workers        200  actor resolved, 0 assignments
GET  /farms/:id/cargo          200  {capacity 30, used 0, version 1}
POST /farms/:id/cargo/load     200  4 seeds: warehouse 10 -> 6, cargo 0 -> 4, version 1 -> 2
POST /farms/:id/cargo/load     200  replay: warehouse still 6, cargo still 4
POST /farms/:id/cargo/purchase 201  2 seeds: gold 100 -> 96 (2 x 2), cargo 4 -> 6, warehouse still 6,
                                    version 2 -> 3
POST /farms/:id/cargo/purchase 201  replay: gold still 96, cargo still 6, version still 3
POST /api/shop/buy             200  ordinary buy of 3 seeds: warehouse 6 -> 9, cargo unchanged at 6
POST /farms/:id/crops          201  planting unchanged
POST /farms/:id/cargo/grant    404  there is no grant route
GET  /farms/:id/cargo (no cookie) 401
```

Conservation held end to end: the seeds the player owned were either in the warehouse or in hand, never
both and never neither.

### A bug the smoke found, and the fix

The first smoke showed the purchase delivering its goods while the container **version stayed put**:
`settleSupplyIntoCargoAtomically` had no `cargo_version` bump, so a client could keep presenting a
version that no longer described what the actor was carrying. The bump was added to the same
transaction, and moving the version check *after* the receipt lookup kept a legitimate replay working
(a replay arrives holding the version its own purchase already moved on). Both are now pinned by tests
("the container version advances on a purchase"), and the re-run above shows `version 2 -> 3` with the
replay leaving it at 3.

## 27. Files changed

```text
packages/domain/src/cargo.ts                          MAX_CARGO_LOAD_QUANTITY, CARGO_SUPPLY_CATEGORIES
packages/application/src/ports.ts                     CargoLoad, CargoPurchase, loadAllAtomically,
                                                      settleSupplyIntoCargoAtomically
packages/application/src/cargo.ts                     LoadCargo, PurchaseSupplyIntoCargo
packages/application/src/errors.ts                    SUPPLY_NOT_ALLOWED
packages/contracts/src/index.ts                       load/purchase requests, purchase result, error code
workers/api/src/d1-repositories.ts                    D1CargoRepository.loadAllAtomically,
                                                      D1EconomySettlementRepository.settleSupplyIntoCargoAtomically
workers/api/src/handler.ts                            two routes, wiring, error statuses
tests/api/cargo-load-supply.test.ts                   new (18 tests)
docs/qa/V16_2_2C_6_BIDIRECTIONAL_CARGO.md             this file
docs/design/WORK_SKILLS_AND_AUTO.md, docs/design/AUTOMATION_LOGISTICS.md,
docs/CONTEXT_INDEX.md, docs/DATA_MODEL.md             status updates
```

## 28. Git status

The mixed working tree is preserved: nothing committed, stashed, reset or force-pushed, and no
historical WIP touched.

## 29. Deferred work

- **Auto execution** in every form: no resolver, no control-mode switch, no travel, no planting, no
  harvesting into cargo, no automatic unload and no automatic purchase. This slice is primitives only.
- **The Auto panel**: the polished Workers/Auto UI belongs with D1/D2; the cargo strip is unchanged.
- **Per-stack LOAD** is one item per request; loading many stacks is the resolver's job to sequence.
- **Supply categories** are seeds only; feed and physical materials join the list with their systems.
- **Manual production still settles to the Warehouse** - the transitional bridge, unchanged here.

## Explicit answers

| Question | Answer |
| --- | --- |
| Can Warehouse items be loaded into Actor Cargo? | YES |
| Can LOAD overflow Cargo? | NO |
| Can LOAD make Warehouse negative? | NO |
| Can LOAD partially succeed? | NO |
| Can LOAD replay duplicate items? | NO |
| Does LOAD conserve quantity? | YES |
| Can a legitimate supply purchase settle directly into Cargo? | YES |
| Does supply purchase use server-authoritative price? | YES |
| Can purchase charge Gold without delivering the full requested item? | NO |
| Does ordinary Shop BUY still go to Warehouse? | YES |
| Does Cargo grant remain unavailable? | YES |
| Does creating/enabling an Assignment execute work? | NO |
| Does Actor move automatically? | NO |
| Does Auto run? | NO |
| Was production deployed? | NO |

Final verdict: **V16_2_2C_6_BIDIRECTIONAL_CARGO_COMPLETE**.