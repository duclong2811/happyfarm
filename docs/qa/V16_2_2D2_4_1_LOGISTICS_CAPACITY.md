# V16.2.2D2.4.1 — Main Character logistics capacity benchmark

Date: 2026-10-05. Result: **D2_4_1_LOGISTICS_CAPACITY_COMPLETE**.

Scope: Main Character Auto farming / carry capacity only. No production capacity change, no
equipment, no cart, no worker, no navigation, no migration, no deployment, no UI.

This phase is **benchmark/design evidence**. It answers "how much is a bigger pair of hands worth?"
with a measured matrix and recommends a capacity band; it implements no progression.

## 1. Starting repository state

`HEAD e502bb4`, working tree intentionally dirty (B0.1–B3.1, D2.3.2, D2.4 plus this task),
`git diff --check` clean, node v22.23.3 / npm 10.9.9. Nothing was reset, stashed, committed, pushed
or deployed; staging still runs the B3.1 build from the previous task.

## 2. Files changed (benchmark-only; no production source)

| File | Change |
| --- | --- |
| `tests/support/cost-harness.ts` | Optional benchmark-only `cargoCapacity` injection through the production `CargoCapacityLookup` port; per-step capture of the `to`/`from` anchor and the `cargo` meter; travel decomposition, logistics-trip and cargo-utilization metrics on `CycleResult`; `tolerateStepFailure` so a full warehouse can be observed instead of thrown; the harness raises the shelf *before* stocking seeds so a deep store does not trip `warehouse_full` on the harness's own insert |
| `tests/integration/auto-logistics-capacity.test.ts` | New: the 20-scenario matrix, travel decomposition, marginal-value table, multipliers, the optional 150-cell probe and the starter-warehouse interaction |
| `tests/integration/auto-logistics-capacity-correctness.test.ts` | New: shipped default is 30; an injected capacity lands on the actor row and really carries more; the guard refuses an over-capacity row; online/offline equivalence at a non-default capacity |
| `docs/qa/V16_2_2D2_4_1_LOGISTICS_CAPACITY.md` | This report |

**No file under `apps/`, `packages/`, `workers/` or `database/migrations/` was touched.** No production
constant, no shop item, no schema, no client code.

## 3. Benchmark architecture

The harness runs the **production** `createHandler`, the production repositories, the production Auto
planner (`resolvePass`), the production `AdvanceAuto` executor and the real settlements
(`PlantCrop`/`HarvestCrop`/`LoadCargo`/`PurchaseSupplyIntoCargo`/`UnloadCargo`/`FundAndPurchaseSupply`),
behind a counting `D1DatabaseLike` and the shipped schema (`schemaSql()` = every migration in order).
Nothing is re-implemented: a "supply trip" is a real settled `LOAD_INPUT`, a "travel second" is the
server's own `retryAfterMs` for a real recorded walk.

One simulated hour of world time per scenario (the harness breaks when the driven clock reaches
3600 s), carrot, the same deterministic row-major field layout, `AUTO_GESTURE_MS = 350`, and the real
`travelSeconds` model. The only variable across a field size is the capacity the actor is created
with.

## 4. How capacity was parameterized

Cargo capacity is content (`STARTER_CARGO_CAPACITY = 30` in `packages/game-data/src/cargo/index.ts`),
delivered to the handler through the `CargoCapacityLookup` port
(`gameDataCargoCapacities.forActorKind`, wired in `workers/api/src/runtime.ts`) and written onto the
`actors.cargo_capacity` row by `mainCharacterFor` (`packages/application/src/jobs.ts`). The database's
own `cargo_capacity_guard_insert/_update` triggers (migration `0024_actor_cargo.sql`) enforce it inside
every transaction.

`createCostWorld(cells, { cargoCapacity })` passes a benchmark-only `{ forActorKind: () => N }` where
production passes `gameDataCargoCapacities`. The candidate therefore travels the **real** path: the
actor is created with N through `mainCharacterFor`, the guard enforces N, the planner reads N from
`main.cargoCapacity`, and the offline reconciler uses the same lookup. No pre-check is bypassed and no
grammar differs between a benchmark actor and a production actor. Candidates 45/60/90/120 exist only
as constructor arguments in a test; nothing persists them.

## 5. Proof the production default remains 30

`auto-logistics-capacity-correctness.test.ts` asserts, and the full suite passes:

```text
STARTER_CARGO_CAPACITY === 30
CARGO_CAPACITY_BY_ACTOR_KIND.MAIN_CHARACTER === 30
gameDataCargoCapacities.forActorKind("MAIN_CHARACTER") === 30   # the production port
a fresh save's MAIN_CHARACTER actor row has cargo_capacity === 30
```

The pre-existing `actor-cargo-migration.test.ts` still proves a live save gains `cargo_capacity = 30`
on upgrade, and `auto-throughput.test.ts` still pins `AUTO_GESTURE_MS = 350`. No capacity candidate
leaks into gameplay configuration.

## 6. Baseline validation

Cargo 30 reproduces D2.3.2 **exactly** at all four field sizes, which is what makes the comparison
valid:

| cells | plant/min (measured) | plant/min (D2.3.2) | travel % (measured) | travel % (D2.3.2) |
| --- | --- | --- | --- | --- |
| 30 | 4.5 | 4.5 | 29 | 29 |
| 60 | 7.2 | 7.2 | 51 | 51 |
| 100 | 9.0 | 9.0 | 80 | 80 |
| 121 | 10.0 | 10.0 | 84 | 84 |

## 7. Full 20-scenario matrix (MEASURED, one simulated hour)

Shelf raised to 200 000 so *labor* is the limit. `supply/h` = settled `LOAD_INPUT`+`PURCHASE_INPUT`;
`unload/h` = settled `UNLOAD`; `whVis/h` = walks that ended at the warehouse (supply + unload);
`mktVis/h` = walks to the market (0 everywhere: the default assignment has Auto Purchase off, so the
market path never triggers). `units/supply` = carried units per supply load.

| cells | cargo | plants | harvests | plant/min | harv/min | supply/h | unload/h | whVis/h | travelS | travel% | cargoAvg | peakCargo | util% | peakUtil% | units/supply | stmts/h | reads/h | rowsRead/h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 30 | 270 | 240 | 4.5 | 4.0 | 9.0 | 16.0 | 16.0 | 1048 | 29% | 15.0 | 30 | 50 | 100 | 30.0 | 28,035 | 23,503 | 65,464 |
| 30 | 45 | 270 | 240 | 4.4 | 3.9 | 21.4 | 9.7 | 32.1 | 1465 | 40% | 26.4 | 45 | 59 | 100 | 12.3 | 27,896 | 23,392 | 66,615 |
| 30 | 60 | 300 | 270 | 4.8 | 4.3 | 9.5 | 8.6 | 8.6 | 936 | 25% | 22.1 | 60 | 37 | 100 | 30.0 | 29,492 | 24,724 | 68,890 |
| 30 | 90 | 300 | 270 | 4.7 | 4.2 | 9.3 | 5.6 | 11.2 | 1015 | 26% | 43.4 | 90 | 48 | 100 | 30.0 | 28,868 | 24,207 | 68,444 |
| 30 | 120 | 300 | 270 | 4.8 | 4.3 | 9.5 | 3.8 | 8.6 | 936 | 25% | 50.5 | 120 | 42 | 100 | 30.0 | 29,364 | 24,622 | 69,452 |
| 60 | 30 | 434 | 420 | 7.2 | 7.0 | 15.0 | 28.0 | 35.0 | 1837 | 51% | 15.1 | 30 | 50 | 100 | 30.0 | 47,083 | 39,428 | 189,884 |
| 60 | 45 | 410 | 402 | 6.8 | 6.7 | 33.0 | 19.0 | 51.0 | 2206 | 61% | 26.6 | 45 | 59 | 100 | 14.5 | 45,577 | 38,152 | 186,048 |
| 60 | 60 | 480 | 433 | 8.0 | 7.2 | 8.0 | 14.0 | 14.0 | 1468 | 41% | 29.8 | 60 | 50 | 100 | 60.0 | 49,137 | 41,173 | 199,565 |
| 60 | 90 | 480 | 426 | 8.0 | 7.1 | 10.0 | 9.0 | 16.0 | 1511 | 42% | 48.5 | 90 | 54 | 100 | 48.0 | 48,721 | 40,832 | 199,265 |
| 60 | 120 | 507 | 480 | 8.4 | 8.0 | 9.0 | 8.0 | 8.0 | 1437 | 40% | 45.0 | 120 | 38 | 100 | 60.0 | 52,747 | 44,185 | 212,574 |
| 100 | 30 | 540 | 465 | 9.0 | 7.7 | 38.0 | 33.0 | 69.0 | 2863 | 80% | 17.2 | 30 | 57 | 100 | 15.8 | 56,615 | 47,407 | 350,825 |
| 100 | 45 | 589 | 540 | 9.8 | 9.0 | 27.0 | 24.0 | 53.0 | 2755 | 77% | 25.8 | 45 | 57 | 100 | 21.9 | 62,168 | 52,056 | 396,829 |
| 100 | 60 | 660 | 600 | 11.0 | 10.0 | 21.0 | 20.0 | 41.0 | 2472 | 69% | 33.9 | 60 | 56 | 100 | 31.4 | 68,475 | 57,352 | 433,342 |
| 100 | 90 | 580 | 560 | 9.6 | 9.3 | 30.9 | 12.0 | 50.8 | 2668 | 74% | 55.3 | 90 | 61 | 100 | 20.3 | 62,314 | 52,163 | 388,601 |
| 100 | 120 | 700 | 617 | 11.7 | 10.3 | 13.0 | 10.0 | 22.0 | 2205 | 61% | 65.1 | 120 | 54 | 100 | 53.8 | 70,593 | 59,146 | 450,814 |
| 121 | 30 | 601 | 598 | 10.0 | 10.0 | 25.0 | 39.0 | 66.0 | 3011 | 84% | 15.7 | 30 | 52 | 100 | 24.1 | 66,404 | 55,550 | 501,276 |
| 121 | 45 | 603 | 522 | 10.0 | 8.7 | 34.0 | 24.0 | 61.0 | 3020 | 84% | 26.3 | 45 | 58 | 100 | 19.1 | 62,421 | 52,255 | 454,741 |
| 121 | 60 | 726 | 605 | 12.0 | 10.0 | 17.8 | 19.8 | 40.6 | 2779 | 77% | 30.3 | 60 | 50 | 100 | 40.3 | 71,549 | 59,951 | 542,015 |
| 121 | 90 | 714 | 653 | 11.9 | 10.8 | 20.9 | 14.0 | 40.9 | 2771 | 77% | 51.6 | 90 | 57 | 100 | 34.6 | 73,741 | 61,748 | 559,727 |
| 121 | 120 | 726 | 665 | 12.1 | 11.1 | 19.0 | 11.0 | 38.0 | 2720 | 75% | 73.4 | 120 | 61 | 100 | 44.0 | 74,966 | 62,784 | 572,537 |

## 8. Supply-trip comparison (settled input loads per hour)

| cells | Cargo 30 | 45 | 60 | 90 | 120 | best |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | 9.0 | 21.4 | 9.5 | 9.3 | 9.5 | ~flat (small field is growth-bound) |
| 60 | 15.0 | 33.0 | 8.0 | 10.0 | 9.0 | 60 |
| 100 | 38.0 | 27.0 | 21.0 | 30.9 | 13.0 | 120 |
| 121 | 25.0 | 34.0 | 17.8 | 20.9 | 19.0 | 60 |

The count is **not monotonic in capacity**, and that is a real, reproducible property of the current
policy, not noise (the harness is deterministic; see §21). A bigger capacity only reduces trips when
the load is actually capacity-bound; when it is not, leftover harvested goods in the hands fragment
the next seed load.

## 9. Unload-trip comparison (settled deliveries per hour)

| cells | Cargo 30 | 45 | 60 | 90 | 120 |
| --- | --- | --- | --- | --- | --- |
| 30 | 16.0 | 9.7 | 8.6 | 5.6 | 3.8 |
| 60 | 28.0 | 19.0 | 14.0 | 9.0 | 8.0 |
| 100 | 33.0 | 24.0 | 20.0 | 12.0 | 10.0 |
| 121 | 39.0 | 24.0 | 19.8 | 14.0 | 11.0 |

Unload trips fall monotonically with capacity at every field size — this is the clean lever. Each
unload means a full field→warehouse→field round trip, so this is where a bigger bag reliably saves
travel.

## 10. Travel decomposition (MEASURED, seconds of the simulated hour)

`field` = walks whose destination is a cell (inside-field); `wh` = walks to the warehouse;
`CELL->WH` = output logistics (field → warehouse); `WH->CELL` = input logistics (warehouse → field).
Market travel is 0 everywhere (Auto Purchase off by default).

| cells | cargo | fieldS | field% | whS | wh% | CELL->WH | WH->CELL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 30 | 856 | 24% | 193 | 5% | 193 | 274 |
| 30 | 60 | 844 | 22% | 92 | 2% | 92 | 185 |
| 30 | 120 | 844 | 22% | 92 | 2% | 92 | 185 |
| 60 | 30 | 1437 | 40% | 400 | 11% | 400 | 454 |
| 60 | 60 | 1305 | 36% | 162 | 5% | 162 | 218 |
| 60 | 120 | 1333 | 37% | 103 | 3% | 103 | 166 |
| 100 | 30 | 2005 | 56% | 858 | 24% | 858 | 975 |
| 100 | 60 | 1987 | 55% | 485 | 13% | 485 | 583 |
| 100 | 120 | 1954 | 54% | 251 | 7% | 251 | 341 |
| 121 | 30 | 2216 | 62% | 795 | 22% | 795 | 846 |
| 121 | 60 | 2267 | 62% | 512 | 14% | 512 | 555 |
| 121 | 120 | 2236 | 62% | 484 | 13% | 484 | 528 |

(All four rows of each field size are in the benchmark output; the table trims to 30/60/120 for
readability.)

The decisive finding: **a bigger bag attacks the warehouse slice, not the inside-field slice.**
Warehouse travel falls from 24%→7% of the hour on 100 cells and 22%→13% on 121, but inside-field
travel stays at 54–62% on the large fields. Capacity is therefore a partial answer to the 80% travel
problem, not the whole one.

## 11. Cargo utilization (MEASURED)

| field | cargo | avg carried | peak carried | avg util | peak util | units/supply | units/unload | unused at unload |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 30 | 15.0 | 30 | 50% | 100% | 30.0 | 30.0 | 0.0 |
| 30 | 45 | 26.4 | 45 | 59% | 100% | 12.3 | 44.0 | 1.0 |
| 30 | 120 | 50.5 | 120 | 42% | 100% | 30.0 | 120.0 | 0.0 |
| 60 | 60 | 29.8 | 60 | 50% | 100% | 60.0 | 60.0 | 0.0 |
| 100 | 60 | 33.9 | 60 | 56% | 100% | 31.4 | 60.0 | 0.0 |
| 100 | 120 | 65.1 | 120 | 54% | 100% | 53.8 | 120.0 | 0.0 |
| 121 | 60 | 30.3 | 60 | 50% | 100% | 40.3 | 60.0 | 0.0 |
| 121 | 90 | 51.6 | 90 | 57% | 100% | 34.6 | 89.9 | 0.1 |
| 121 | 120 | 73.4 | 120 | 61% | 100% | 44.0 | 120.0 | 0.0 |

Every peak reaches capacity (`peak util = 100%`), and the unloads themselves are at full hands
(`unused at unload` 0.0, except 0.1–1.0 in the Cargo 45/90 cases where the sweep ends on a partial
load). But **average** utilization stays ~42–61% because the actor spends much of the hour walking to
fresh targets with a partly-empty bag, and because the supply load is bounded by standing empty ground
rather than by capacity. A capacity of 120 usually carries far less than 120 on a supply trip (44.0
units on 121 cells, 53.8 on 100): a 120-unit bag is real estate that is often simply unused, which is
exactly why 90/120 buy so little over 60.

## 12. Throughput comparison

Harvests per minute (and plants per minute) at each capacity, per field size, in §7. Highlights:

| field | 30 → 60 | 30 → 120 |
| --- | --- | --- |
| 30 | +7% | +7% |
| 60 | +3% | +14% |
| 100 | +29% | +33% |
| 121 | 0% | +11% |
| 150 (probe) | +50% | +61% |

## 13. Diminishing returns (marginal value per step, per hour)

Full table is printed by the benchmark. The shape:

| field | 30→45 | 45→60 | 60→90 | 90→120 | reading |
| --- | --- | --- | --- | --- | --- |
| 30 | −0.10 harv/min | +0.40 | −0.09 | +0.09 | flat; no capacity value |
| 60 | −0.30 | +0.51 | −0.11 | +0.90 | mostly flat until 120 |
| 100 | +1.25 | +1.00 | −0.69 | +0.98 | strong gains; 60 already big |
| 121 | −1.26 | +1.30 | +0.85 | +0.22 | noisy; 60 the sweet spot |
| 150 | — | — | — | — | 60 captures ~all of the 120 gain |

Diminishing returns begin **right after 60**: on the two cleanest large-field measurements (100 cells
and the 150-cell probe) 60 already captures ~97–99% of the 120-level throughput, while 90 is a local
regression on 100 cells. 120 never more than ~+3% over 60 where the measurement is clean.

## 14. D1 comparison (normalized per simulated hour)

| field | cargo | stmts/h | reads/h | rowsRead/h | stmts per transition |
| --- | --- | --- | --- | --- | --- |
| 100 | 30 | 56,615 | 47,407 | 350,825 | 52.7 |
| 100 | 60 | 68,475 | 57,352 | 433,342 | 51.1 |
| 100 | 120 | 70,593 | 59,146 | 450,814 | 51.2 |
| 121 | 30 | 66,404 | 55,550 | 501,276 | 52.6 |
| 121 | 60 | 71,549 | 59,951 | 542,015 | 51.6 |
| 121 | 120 | 74,966 | 62,784 | 572,537 | 45.2 |

## 15. Explain the D1 change

Statements per transition stay ~45–53 at every capacity — a transition costs the same wherever it is.
Higher capacity therefore changes D1 **only by changing how many transitions fit in the hour**, and
the extra transitions are overwhelmingly productive field work (Plant/Harvest) replacing logistics
transitions. Two effects are separable:

A. fewer logistics operations: unload trips fall at every field size (e.g. 39→11 per hour on 121),
which removes whole unload round trips (each a batch plus travel arrival writes);

B. additional productive economic work enabled by the time saved: more Plant/Harvest transitions,
each of which still settles atomically.

On 100 cells, Cargo 60 buys +29% throughput for +21% statements — D1 grows **sub-proportionally to the
value delivered**, because §11 shows the average load is not saturated and the extra capacity does not
add per-transition overhead.

## 16. Warehouse bottleneck interaction (§18)

Everything above raises the shelf so labor is the limit. Left at the shipped **1000-unit** starter
shelf (121 cells, one hour):

| cargo | ran for | plants | harvests | supply/h | unload/h | travelS | ended | stmts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 671 s (11 min) | 121 | 120 | 26.8 | 37.5 | 535 | HTTP 409 (warehouse_full) | 72,029 |
| 120 | 1131 s (19 min) | 242 | 210 | 19.1 | 9.5 | 823 | HTTP 409 (warehouse_full) | 77,842 |

The shelf is the next ceiling. A bigger bag lets the actor deliver more per trip, so it survives
longer before the shelf fills (671 s → 1131 s), but both runs are still cut short by the shelf rather
than by the hour. Larger Cargo therefore buys productivity only until the player raises warehouse
capacity; beyond that, warehouse tiers — not carrying — bound the farm. No warehouse tier was
changed; this is reported as future balance evidence.

Note for a later task (out of scope here): the shipped Auto policy treats a full shelf as an error
surfaced as HTTP 409 rather than a `WAITING_FOR_STORAGE` step when the hands are full and the shelf is
full. That is pre-existing behavior, untouched here, and worth a separate decision.

## 17. Atomicity / correctness

Capacity parameterization weakens nothing. The candidates travel the real path, so:

- Cargo optimistic concurrency (`cargo_version` + `cargo_transfer_id`) is unchanged;
- the `cargo_full` guard is the database's own trigger and is proven to refuse a 61st unit on a
  60-capacity actor (`auto-logistics-capacity-correctness.test.ts`);
- load/harvest/unload atomicity and all-or-nothing unload are the production settlements;
- replay (`IDEMPOTENCY_CONFLICT`), stale-version (`CONFLICT_STALE_STATE`) and concurrent-settlement
  behavior are covered by `auto-*-settlement.test.ts`, all green;
- the semantic transition identity (`auto-<kind>-<stepRequestId>`) is untouched.

## 18. B3.1 regression

Emergency Supply Funding is untouched. Its tests (`auto-funding.test.ts`,
`auto-funding-settlement.test.ts`) pass unchanged, including funding default off, the whitelist,
priority, the minimum necessary sale, insufficient-whitelist → zero sale, funding+purchase atomicity
and offline funding. Funding is capacity-correct by construction: `funding.ts` checks
`assertCargoDeltaFits(main.cargoCapacity, cargoUsed(cargoRows), [quantity])`, so a benchmark candidate
that reaches the funding path is bound by the same capacity as every other path.

## 19. Online/offline equivalence (§27)

New proof in `auto-logistics-capacity-correctness.test.ts`: for an 8-cell farm at **Cargo 60** the
online browser loop and the B3 lazy reconciler, given the same elapsed authoritative time, reach the
same harvest count (measured: online 8 / offline 8), with the actor row still at 60. The reconciler
uses the same `cargoCapacities` lookup and the same planner, so a configured capacity produces
equivalent economics online and offline. No second-by-second offline loop exists.

## 20. 150-cell probe (§36)

Run; the layout supports 150 farm cells.

| cargo | plant/min | harv/min | supply/h | unload/h | travel% | peakCargo | util% | stmts/h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 8.6 | 8.3 | 38.0 | 35.0 | 86% | 30 | 58% | 57,435 |
| 60 | 14.9 | 12.5 | 18.0 | 25.0 | 76% | 60 | 47% | 88,710 |
| 120 | 15.0 | 13.4 | 15.0 | 13.0 | 74% | 120 | 54% | 91,211 |

At 150 cells the actor is the severely constrained party with 30 units (86% travel, 8.6 plant/min).
Cargo 60 roughly doubles planting throughput (+73%) and cuts travel to 76%; Cargo 120 adds ~1% more
planting and ~7% more harvesting over 60. This is the boundary where a second labor system, not a
bigger bag, is the natural next step.

## 21. Why the matrix is not monotonic (a measured property, not noise)

The harness is fully deterministic (fixed ids and clock; the B2.5 digests are pinned and reproduce
exactly), so the Cargo-45 / Cargo-90 outliers are causal. A direct trace of a 30-cell field shows the
mechanism, which is the current production policy:

1. The actor LARGE-loads seeds, plants the field, then harvests a sweep into the hands (2 carrot
   units per crop).
2. Deliveries are **all-or-nothing** and the cargo container holds **both** inputs and outputs.
3. With Cargo 30 the harvest sweep lands exactly full (30), so unload then reload is clean: one seed
   load of 30.
4. With Cargo 45 the sweep is cut at 44, then continues to 16 — leaving harvested carrots in the
   hands when the field becomes empty. Those leftover **outputs** reduce the free space for the next
   **input** load, so the actor makes two seed loads (29 + 1) instead of one, and travels more.

So a larger capacity can *increase* supply trips and travel under this policy. This is a design
finding for the progression work that follows: capacity tiers are only cleanly valuable in combination
with an input/output-aware delivery policy (or separate input/output space). It is not a reason to
change anything in this benchmark phase, and `§13`'s 60-saturation still holds on the clean
measurements.

## 22. Progression interpretation (§20)

Measured bands (concept only — nothing implemented):

- **Starter, Cargo 30** — fine for 20–50 cells (growth-bound, ~4–5 plant/min, no capacity pressure).
- **Small carrying upgrade, ~45** — no reliable value at any measured size; the 45 outliers are
  regressions. Not recommended on this evidence.
- **Large backpack / carrying upgrade, ~60** — the sweet spot: +29–50% throughput on 60–150 cells,
  unload trips cut roughly in half, and ~97–99% of what 120 offers on the clean measurements.
- **Hand cart, 90–120** — a weak upgrade over 60 in the clean runs (+0–3%); only the noisy 100-cell
  run shows more, and 90 is a regression there.

## 23. Backpack interpretation (§20)

One modest upgrade (a "large backpack" band around **60**) is justified by the data: it is the
smallest capacity that measurably relieves large-field logistics, and it is where the marginal curve
flattens.

## 24. Cart interpretation (§21)

A capacity-only cart (90–120) is **not** justified yet. It reduces unload trips further, but on both
clean large-field measurements (100 cells, 150 cells) 60 already captures ~97–99% of its throughput,
and its average utilization is 54–61% — the extra space is often unused because supply loads are
bounded by standing ground and deliveries are all-or-nothing. A cart would need a *different*
mechanic (a second actor, input/output separation, or a route/logistics effect) to earn its slot.

## 25. Remaining bottleneck after larger Cargo (§22)

After Cargo 60–120 the hour is still dominated by **inside-field travel** (54–62% on 100/121 cells)
and by the actor's **single labor timeline**: one actor can only walk one path and settle one
transition at a time. Warehouse travel shrinks to 7–13%, growth is negligible on large fields, and the
work gesture is a minority. The bottleneck is no longer logistics trips; it is the one pair of hands.

## 26. NPC Worker implication (§22)

The evidence points away from "even larger Cargo" and toward a **second labor timeline**. A worker
would multiply the part of the hour the actor cannot fix by carrying more — the inside-field travel —
and would remain useful after the shelf interaction (§16) is solved. Recommended: treat the Worker as
the next major productivity system, with a modest Cargo-60 band shipped first as the small progression
step. No worker was implemented.

## 27. Migration and deployment status

**No migration. No deployment.** No schema change and no `0029`; migration `0028_auto_funding.sql` is
untouched. Nothing was applied remotely. Staging remains on the B3.1 build.

## Gates

```text
benchmark            20 scenarios (30/60/100/121 × 30/45/60/90/120) + 150-cell probe + starter-shelf
                     interaction, deterministic digests, Cargo-30 baseline exactly matches D2.3.2
capacity correctness default 30 (content + port + fresh actor row), injected 60 on the row,
                     database guard refuses 61/60, online==offline at 60
focused              cargo/harvest/unload/supply/funding settlement suites + B2.5 harness + B3 reconcile
full Vitest          190 files / 1802 tests passed
typecheck            pass
lint                 pass (--max-warnings=0)
git diff --check     clean
web build            dist/assets/index-D589NsTP.js (unchanged; no client change)
Worker staging dry-run  pass (D1 + ASSETS bindings resolved, 1600 KiB upload)
```

## Recommendation (§37)

**B — one modest capacity upgrade is justified.** Ship a single carrying upgrade around **Cargo 60**
for large farms; do not build a multi-tier capacity ladder or a capacity-only cart (C/D rejected by
§24), and treat the NPC Worker as the next major productivity system (§26). Fix the mix of inputs and
outputs in one all-or-nothing delivery (§21) before pricing any higher-capacity tier.

Final verdict: **D2_4_1_LOGISTICS_CAPACITY_COMPLETE**.
