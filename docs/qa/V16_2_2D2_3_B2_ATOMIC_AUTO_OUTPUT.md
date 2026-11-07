# V16.2.2D2.3 — B2 Atomic Auto Harvest + Unload

Date: 2026-10-05. Verdict: **B2_ATOMIC_AUTO_OUTPUT_COMPLETE**.

Baseline: B0.1 Atomic Auto Plant COMPLETE, B1 Atomic Auto Supply COMPLETE.

B2 closes the last two economic transitions of the `REPLANT_CROP` lifecycle so that **no Auto
mutation commits without the Auto timeline committing with it**:

```text
Warehouse -> Cargo supply -> Plant -> Growth -> Harvest into Cargo
          -> Travel to Warehouse -> Unload -> repeat
```

Offline reconciliation (B3) is **not** part of this slice and was not implemented.

## 1. Old harvest flow (before B2)

```text
AdvanceAuto.perform("HARVEST")
  -> travelTo(crop cell)                        (its own actor_auto_state write)
  -> HarvestCrop.executeIntoCargo(...)          one batch:
       harvest_settlements row (trigger: cargo grant + crop delete)
       + progression seed + guarded HARVEST_CROP receipt + XP apply
  -> worked()                                   (no timeline write at all)
```

The economic mutation and the Auto timeline were **not** one transaction — worse, the harvest did not
advance `actor_auto_state` or `simulation_at` at all, so the timeline could disagree with the world
after a harvest, and the harvest's identity was an HTTP-shaped request id (`auto-harvest-<cropId>`)
rather than a semantic transition.

## 2. New atomic harvest flow

```text
AdvanceAuto.perform("HARVEST")
  -> travelTo(crop cell)                                  (unchanged)
  -> HarvestCrop.executeIntoCargoAuto(..., autoContext)   one request
       -> D1AutoHarvestSettlementService.settle
            executeD1AtomicBatch([
              prepareHarvestIntoCargoAutoSettlement   (5 statements)
                container claim (cargo_version + cargo_transfer_id = transitionId)
                harvest_settlements row (trigger: cargo grant + crop delete)
                player_progression seed
                guarded HARVEST_CROP receipt (pre-award progression state)
                XP apply
              prepareAutoHarvestGuardAndAdvance        (2 statements)
                actor_auto_state version + simulation_at
                semantic AUTO_HARVEST receipt (post-state guard)
            ])
  -> worked()
```

One `db.batch()`, seven statements. Either the crop leaves the ground, the carrots land in cargo, the
experience is paid, the timeline advances and both receipts exist — or nothing does.

## 3. Old unload flow (before B2)

```text
AdvanceAuto.deliver()
  -> travelTo(WAREHOUSE)                        (its own actor_auto_state write)
  -> UnloadCargo.execute(...)                   one batch:
       actors marker + cargo deletes + warehouse additions + UNLOAD_CARGO receipt
  -> worked()                                   (no timeline write at all)
```

Again the transfer was atomic with itself but **not** with the Auto timeline; `simulation_at` never
moved on a delivery, and the identity was `auto-unload-<stepRequestId>` — an HTTP id.

## 4. New atomic unload flow

```text
AdvanceAuto.deliver()
  -> travelTo(WAREHOUSE)                                 (unchanged)
  -> UnloadCargo.executeAuto(..., autoContext)           one request
       -> D1AutoUnloadSettlementService.settle
            executeD1AtomicBatch([
              prepareUnloadSettlement(..., deferReceipt)  (3N + 1 statements for N stacks)
                actors marker (cargo_version guard + cargo_transfer_id = transitionId)
                N cargo deletes (marker-scoped)
                2 per stack: warehouse seed + growth (warehouse capacity trigger inside)
              prepareAutoUnloadGuardAndAdvance            (2 statements)
                actor_auto_state version + simulation_at
                semantic AUTO_UNLOAD receipt (post-state guard)
            ])
  -> worked()
```

For a one-stack delivery this is 7 statements; for the two-stack proof fixture, 9.

## 5. Reward and experience semantics

Unchanged by construction: Auto calls the **same** `HarvestCrop` use case and the **same**
`D1HarvestSettlementRepository` settlement the manual path uses, with `destination = 'CARGO'` instead
of `'WAREHOUSE'`. The reward quantity, the XP award, the maturity check (server clock), the crop
version guard and the crop-delete trigger are literally the same code and the same SQL.

Proven in `tests/integration/auto-harvest-settlement.test.ts` through the real use case: harvesting
`crop_carrot` pays `item_carrot x2`, awards `4` XP, leaves `progression_version = 2` and removes the
crop row. `tests/api/auto-execution.test.ts` proves the same through the HTTP route.

## 6. Cargo full

The full reward must fit, or nothing happens. The cargo capacity trigger
(`cargo_capacity_guard_insert` / `_update`) is the authority inside the batch; a harvest whose reward
would overflow aborts the whole transaction, so:

* the crop stays in the ground and stays harvestable,
* the carried stack is unchanged,
* no XP is written,
* there is no `AUTO_HARVEST` receipt and no `HARVEST_CROP` settlement row,
* the Auto timeline does not consume the event.

Proven by `keeps the crop standing, the experience unpaid and no receipt when cargo is full` (full
durable snapshot equality before/after).

## 7. Warehouse full

The delivery is all-or-nothing, exactly as before: the warehouse's own capacity trigger refuses the
growth inside the same batch, so the cargo stays on the actor, the warehouse is untouched, and no
`AUTO_UNLOAD` receipt is written. There is no partial unload, no auto-sell, no discard and no gold
conversion.

Proven by `keeps the cargo on the actor and the warehouse untouched when the warehouse is full`
(999/1000 warehouse plus a 5-unit cargo -> `WAREHOUSE_FULL`, cargo total still 5, carrot row still
999).

## 8. Semantic identity

`autoTransitionId` (`packages/application/src/auto-plant.ts`) now covers `HARVEST` and `UNLOAD` and
takes `assignmentId: string | null` — a delivery is the *actor's* step, so it names the actor rather
than inventing an assignment.

```text
auto-<actor16>-<assignment16|actor>-<KIND>-<eventTimeDigits>
```

The HTTP `requestId` is not the economic identity. `HarvestCrop.executeIntoCargoAuto` and
`UnloadCargo.executeAuto` look the receipt up by the semantic id under `AUTO_HARVEST` /
`AUTO_UNLOAD`, and both settlements write that receipt inside the same batch as the mutation.

The harvest carries a second, settlement-shaped receipt (`HARVEST_CROP`) exactly as every harvest
does: it is the pre-award progression guard, and it is what makes one crop impossible to harvest
twice (`harvest_settlements` is unique per crop).

## 9. Replay and concurrency proofs

| Case | Evidence |
| --- | --- |
| Exact semantic replay | second `settle` with the same context is refused; full durable snapshot equal to the post-first state |
| Retry with a new HTTP request id | use case level: `UnloadCargo.executeAuto` with a different `requestId` returns the first receipt and moves nothing; harvest level: a new record id under the same transition is refused |
| Same-transition concurrency | `Promise.allSettled` of two identical settlements yields exactly one fulfilment |
| Competing transitions, one crop | a second (later event time) harvest attempt against the same crop is refused and changes nothing |
| Stale Auto timeline | both harvest and unload roll back completely (snapshot equality) |
| Stale crop / stale container | harvest rolls back on a wrong crop version and on a stale cargo container version |
| Stale container on unload | a wrong `expectedCargoVersion` rolls back with the cargo still intact |

Every assertion inspects final durable rows (`crop_instances`, `actor_cargo_items`, `inventory_items`,
`actors`, `player_progression`, `actor_auto_state`, `idempotency_keys`, `harvest_settlements`) rather
than exception types alone.

## 10. Conservation proofs

* Harvest: the produced output equals the crop definition's reward (2 carrots, version 1 on a fresh
  stack; 5 -> 7, version 3 -> 4 on an existing stack) and exactly one `HARVEST_CROP` settlement row
  exists with `destination = 'CARGO'`.
* Unload: for every stack the cargo decrease equals the warehouse increase (2 + 3 in, 0 left), and
  `SUM(actor_cargo_items)` + `SUM(inventory_items)` is unchanged across the transfer.

## 11. AdvanceAuto convergence

`AutoActions.harvest.executeIntoCargoAuto` and `AutoActions.unload.executeAuto` are the only Auto
harvest/delivery calls; the legacy `executeIntoCargo` / `execute` branches are no longer reached by
`AdvanceAuto`. `LOAD_INPUT`, `PURCHASE_INPUT`, `PLANT`, travel and wait semantics are untouched.

`tests/api/auto-execution.test.ts` adds two route-level proofs:

* `commits the harvest and the Auto timeline in one batch` — the harvest's WORKED step leaves
  `actor_auto_state.simulation_at` equal to that step's own event time, version + 1, anchor `CELL`,
  and exactly one `AUTO_HARVEST` + one `HARVEST_CROP` receipt with one CARGO settlement row.
* `commits the delivery and the Auto timeline in one batch` — the UNLOAD WORKED step leaves
  `simulation_at` equal to that step's event time, anchor `WAREHOUSE`, one `AUTO_UNLOAD` receipt, no
  `UNLOAD_CARGO` receipt, and the 30 carried carrots in the warehouse.

## 12. D1 statement shape

Measured by construction (statement counts are asserted through the durable post-state, not a
statement counter):

| Transition | Statements in the one batch |
| --- | --- |
| Auto Harvest | 7 = claim + settlement row + progression seed + guarded receipt + XP apply + auto advance + semantic receipt |
| Auto Unload (N stacks) | 3N + 3 = marker + N deletes + 2N warehouse statements + auto advance + semantic receipt |

Reads were not instrumented in this slice; the harvest read set is the use case's own (farm,
membership, receipt, crop, carried rows, progression) plus the Auto guard's bounded reads, and the
delivery read set is the unload's own (actor, cargo rows, warehouse row, per-stack inventory) plus the
plan read. This is the input B2.5 needs.

## 13. Migration status

**None.** B2 reuses `actor_auto_state` (0026), `simulation_at` (0027), `actors.cargo_version` /
`cargo_transfer_id` / `actor_cargo_items` (0024) and `idempotency_keys`. No DDL was added, no schema
was widened, and no remote migration was applied.

## 14. Deployment status

**None.** No Worker deploy, no web deploy, no remote database operation. Staging remains on its last
deployed version.

## 15. Files changed

```text
packages/application/src/auto-plant.ts                      transition identity for HARVEST/UNLOAD
packages/application/src/harvest.ts                         AutoHarvestSettlement + executeIntoCargoAuto
packages/application/src/cargo.ts                           AutoUnloadSettlement + UnloadCargo.executeAuto
packages/application/src/auto-executor.ts                   AdvanceAuto uses the new boundaries
workers/api/src/d1-repositories.ts                          prepared harvest/unload components + Auto guards
workers/api/src/d1-auto-harvest-settlement.ts               new
workers/api/src/d1-auto-unload-settlement.ts                new
workers/api/src/handler.ts                                  composition + wiring
tests/integration/auto-harvest-settlement.test.ts           new
tests/integration/auto-unload-settlement.test.ts            new
tests/api/auto-execution.test.ts                            two timeline-convergence proofs
docs/qa/V16_2_2D2_3_B2_ATOMIC_AUTO_OUTPUT.md                this file
```

## 16. Gates

```text
full Vitest        180 files, 1756 tests passed   (was 178 / 1734)
typecheck          pass
lint               pass, 0 warnings
production web     pass (index-euRdafzS.js)
Worker dry-run     pass (1557.96 KiB / 252.50 KiB gzip)
git diff --check   clean
```

## 17. Remaining blocker before B2.5

None identified in B2. The next slice (B2.5) is where the batching questions live, and B2 deliberately
leaves them open:

* one Auto harvest is still one crop settlement, and one delivery is still one all-or-nothing
  transfer — no bounded multi-cell/multi-crop settlement exists yet;
* the per-transition statement counts above are the baseline B2.5 would compress;
* `AUTO_HARVEST` and `HARVEST_CROP` are two receipt rows per harvest; whether B2.5 folds them into one
  is a batching decision, not a correctness one.

## 18. Explicit answers

| Question | Answer |
| --- | --- |
| Is the Auto harvest economic mutation + Auto advancement atomic? | YES |
| Is the Auto unload economic mutation + Auto advancement atomic? | YES |
| Can a semantic retry duplicate the harvested reward or XP? | NO |
| Can concurrency duplicate a harvest of one crop? | NO |
| Does a full cargo lose the crop or its reward? | NO |
| Does a full warehouse lose the carried cargo? | NO |
| Do the conservation proofs pass? | YES |
| Do AdvanceAuto HARVEST/UNLOAD use the new boundaries? | YES |
| Was a migration required? | NO |
| Was anything deployed? | NO |
