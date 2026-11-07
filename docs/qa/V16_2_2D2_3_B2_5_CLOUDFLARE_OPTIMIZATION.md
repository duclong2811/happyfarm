# V16.2.2D2.3 — B2.5 bounded settlement + Cloudflare optimization

Date: 2026-10-05. Verdict: **B2_5_CLOUDFLARE_OPTIMIZATION_COMPLETE**.

Baseline: B0.1 Atomic Auto Plant, B1 Atomic Auto Supply and B2 Atomic Auto Harvest + Unload are all
COMPLETE. B2.5 is measurement-first: a deterministic cost harness around the real repositories, a
hot-path ranking from that evidence, and one bounded optimisation that the evidence selected.

**No bulk settlement was introduced.** The measurements say the dominant cost was repeated
observation work per step, not the settlement statements; the fix is read reuse, and the bulk
question is left to B3 with the numbers below.

## 1. Baseline transaction shapes (measured)

`tests/support/cost-harness.ts` drives the production handler, the production repositories and the
shipped migrations through a `D1DatabaseLike` that records every batch, statement, read, row returned
and `meta.changes`. One full cycle per scenario (every cell planted, grown, harvested once, plus the
supply and deliveries that cycle needs):

| Scenario | Steps | Settlements | Batches | Statements | Reads | Rows read | Writes | Rows written | Receipts | Auto-state writes | Simulated elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 cell (15 harvests) | 91 | 46 | 46 | 3,203 | 2,836 | 2,404 | 367 | 323 | 107 | 243 | 5,080.6 s |
| 30 cells | 126 | 63 | 63 | 4,694 | 4,131 | 13,914 | 563 | 531 | 156 | 376 | 424.2 s |
| 121 cells | 762 | 381 | 381 | 28,418 | 25,117 | 288,138 | 3,301 | 3,154 | 887 | 2,286 | 1,100.5 s |

MEASURED. Starter Main Character cargo capacity 30, crop `crop_carrot` (300 s growth), one `FARM`
work area of 1/30/121 cells, a fixed clock and fixed ids, `schemaSql()` = all migrations 0001–0027.

## 2. Measurement methodology

* `CountingD1` forwards to `NodeD1Database` (the in-memory SQLite D1 double the suite already uses)
  and classifies each statement by its own SQL: SELECT/WITH = read, otherwise write.
* Statement counting: standalone `first`/`all`/`run` count once; a batch counts its statements once
  and delegates to uncounted wrappers, so nothing is double-counted.
* Rows: `all()` returns `results.length`, `first()` 0/1, `run()` and batches add `meta.changes`.
* The harness is deterministic: fixed ids, a test clock it advances exactly as the browser does
  (retryAfterMs + a small gesture), one request per step, no overlap.
* **MEASURED** = batches, statements, reads, rows, receipts, auto-state writes, steps, settlements.
  **DERIVED** = everything in section 4. Nothing here is a Cloudflare billing figure.

## 3. Hot-path ranking (baseline, 121-cell cycle)

By executions (measured):

| # | Query | Calls | Rows |
| --- | --- | --- | --- |
| 1 | `SELECT … FROM farms WHERE id = ?` | 4,998 | 4,998 |
| 2 | `SELECT … FROM actor_cargo_items WHERE actor_id = ?` | 2,670 | 2,552 |
| 3 | `SELECT … FROM farm_members WHERE farm_id = ? AND player_id = ?` | 1,911 | 1,911 |
| 4 | `SELECT … FROM actors WHERE …` | 1,911 | 1,910 |
| 5 | `SELECT … FROM crop_instances WHERE farm_id = ?` | 1,859 | **90,675** |
| 6 | `SELECT … FROM actor_jobs …` | 1,512 | 1,511 |

88% of all statements were reads (25,117 of 28,418), and the four largest entries are the *same rows
read repeatedly inside one request*: **6.6 farm reads per step** (762 steps → 4,998), 2.5 actor reads,
2.5 membership reads, 3.5 cargo reads. The economic settlements were 381 batches (~2,700 statements,
≈9.5% of all statements) and their writes were identical before and after the optimisation.

**Ranking: repeated observation reads > whole-farm list scans > settlement statement count.** The
profession's single-crop settlement shape was *not* the dominant cost.

## 4. 1 h / 6 h / 24 h offline estimates (DERIVED)

Measured online rate for the 121-cell field: 121 harvests in 1,100.5 simulated seconds = **395.9
harvest events/hour** (carrot, cargo 30, travel included). Per-harvest share of the measured cycle
(post-optimisation): 166.6 statements, 139.4 read calls, 1,241.7 rows read, 3.15 batches, 7.3 receipts.

| Window | Harvest events at the measured rate | Statements | Read calls | Rows read |
| --- | --- | --- | --- | --- |
| 1 h | ~396 | ~66.0 k | ~55.2 k | ~492 k |
| 6 h | ~2,375 | ~396 k | ~331 k | ~2.95 M |
| 24 h (cap) | ~9,500 | ~1.58 M | ~1.32 M | ~11.8 M |

Assumptions: the measured online rate holds; one carrot cycle per cell; the same cargo/travel
behaviour; the 24 h cap applies. The growth-rate ceiling is higher (121 cells × 3600/300 = 1,452
harvests/h), so the measured rate is the binding one today because travel and cargo pace the loop.

**This is why B3 must not settle every event with a fresh observation pass.** One 121-cell island
working offline for a day is an order of magnitude beyond the D1 free tier if each event costs a full
step; the reconciliation pass has to read once and advance many bounded transitions. B2.5 makes that
possible (section 6) and supplies the numbers to size it.

## 5. Baseline A3 conclusion

No bulk Plant/Harvest settlement was implemented, because:

* the settlement statements were ≈9.5% of the measured cost;
* the dominant cost was repeated reads inside a single step, which bulk settlement would only address
  indirectly, by removing steps that per-crop travel legitimately requires;
* bulk harvest would compress events across cells the actor has to walk to, which the brief forbids
  ("must NOT bypass physical logistics").

## 6. Optimization implemented (evidence-selected)

**Read reuse inside one Auto step.** The same rows were being read up to six times per request:

1. `requireOwnedFarm` now *returns* the farm it read, so callers stop re-reading the row
   (`packages/application/src/jobs.ts`).
2. `mainCharacterFor(dependencies, farmId, observedFarm?)` accepts the farm the caller already read.
3. `ResolveAutoPlan.execute(actor, farmId, observed?)` accepts the farm, actor and carried rows the
   executor already read — and still runs the full authorization itself, from the authenticated
   actor (`packages/application/src/auto.ts`). `executeWithSnapshot` additionally returns the rows the
   pass read (`AutoPlanObservation`).
4. `AdvanceAuto` reads the farm, the actor and the carried stack once, passes them to the planner, and
   hands the plan's snapshot to `fieldState`, so the work-area cells, crops, trees and building bounds
   are not read a second time in the same request (`packages/application/src/auto-executor.ts`).

Nothing about the economy, the settlements, the timeline, travel, cargo or the contracts changed. The
snapshot is only reused within one request, before any settlement write.

## 7. Before/after cost (MEASURED, same scenarios)

| Scenario | Statements | Read calls | Rows read | Writes | Batches | Receipts | Auto-state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 cell | 3,203 → 2,386 (**−25.5%**) | 2,836 → 2,019 (**−28.8%**) | 2,404 → 1,682 (**−30.0%**) | 367 → 367 | 46 → 46 | 107 → 107 | 243 → 243 |
| 30 cells | 4,694 → 3,332 (**−29.0%**) | 4,131 → 2,769 (**−33.0%**) | 13,914 → 7,638 (**−45.1%**) | 563 → 563 | 63 → 63 | 156 → 156 | 376 → 376 |
| 121 cells | 28,418 → 20,164 (**−29.0%**) | 25,117 → 16,863 (**−32.9%**) | 288,138 → 150,248 (**−47.9%**) | 3,301 → 3,301 | 381 → 381 | 887 → 887 | 2,286 → 2,286 |

Writes, batches, receipts and auto-state writes are **identical** — the optimisation removed reads
only. Per-step reads fell from ~33 to ~22 on the 121-cell field, and the work-area-cells and building
bounds lists are now read at most once per step (1,494 → 763 and 763 for 762 steps).

## 8. Batch bound and rationale

No bulk batch was introduced, so there is no new bound to justify. The existing bounds are unchanged:
one step = at most one settlement; one harvest = one crop; one delivery = one all-or-nothing transfer.
The read reuse is bounded by construction: one request, one snapshot, one bounded transition.

## 9. Reference-vs-optimized equivalence (MEASURED)

The harness records a SHA-256 digest of every durable table the loop can touch (crops, tiles, cargo,
warehouse, actors, auto state, progression, wallet, ledger, receipts, harvest settlements, jobs,
work areas). The reference digests were captured from the **pre-optimisation** implementation of the
same scenarios and are embedded in `tests/integration/auto-cost-harness.test.ts`:

```text
1 cell      03f4eed4573aeff27181ad06c3fb2bc0733c966b4976b1101363c756353f7af1   unchanged
30 cells    55b9f367b77fad75daac506e578ddb2fccf69569ed8c1c0f330f1a7bf492da77   unchanged
121 cells   d74b7c9604f8e2f47ab8901285bfae6f6308a6629eb437f7de21108f7ee4ad09   unchanged
```

The equivalence assertions also pin steps (91/126/762), settlements (46/63/381), batches (46/63/381),
receipts (107/156/887), auto-state writes (243/376/2,286) and rows written (323/531/3,154), so a
silent economic change cannot hide behind an equal digest.

## 10. Replay / concurrency / capacity proofs

No settlement primitive changed, so the B0.1/B1/B2 proofs still guard them, and they were re-run
green: `auto-plant-settlement`, `auto-supply-settlement`, `auto-harvest-settlement`,
`auto-unload-settlement`, `cargo-load-supply`, `auto-execution`, `auto-executor` (8 files, 76 tests).
Replay, competing transition, stale timeline/crop/container, cargo-full and warehouse-full rollbacks
are unchanged by construction — the optimisation touches reads only, and the write counts prove it.

## 11. Harvest receipt decision

Keep both receipts. `HARVEST_CROP` is the settlement's own guarded receipt: it is the *pre-award*
progression guard and the once-per-crop settlement identity. `AUTO_HARVEST` is the semantic Auto
transition receipt and the batch's post-state guard. They have distinct responsibilities; merging
them would either lose the pre-award guard or give the Auto transition the settlement's identity.
No measured benefit justified revisiting it (2 receipt rows per harvest ≈ 2 of 166 statements per
harvest).

## 12. Unload optimization decision

Leave the `3N + 3` shape alone. Typical cargo is one or two stacks (the measured cycle's deliveries
cost 78 statements for 2 deliveries, ≈1.2% of the 121-cell cycle), and the unload is not a hot path.
Rewriting it would be cosmetic.

## 13. Per-player cost model (DERIVED from section 6/7)

* One Auto settlement step at 121 cells: ~26 statements, ~22 read calls, ~197 rows read.
* One harvest event (with its share of supply, planting and delivery): ~167 statements, ~139 read
  calls, ~1,242 rows read.
* One 121-cell online hour at the measured rate: ~66 k statements, ~55 k read calls, ~492 k rows.
* One delivery (2 stacks): 78 statements, 64 reads, 14 writes.

Model for a future capacity gate: `rows/day ≈ active_players × online_hours × 492 k` for fully
Auto-driven 121-cell islands, plus each player's manual play. That is a planning figure, not a
Cloudflare measurement.

## 14. Future 5 → 80 load-test plan

Ladder: **5, 10, 20, 40, 60, 80** simultaneously active Auto players, each with a 121-cell field.
Capture per stage: requests/min, D1 rows read/min, rows written/min, Worker CPU, p50/p95 latency,
error rate, 429/5xx, D1 conflicts. Derive requests/player/hour, rows-read/player/hour,
rows-written/player/hour. 80 must not be assumed safe until measured. Not run in B2.5.

## 15. Historical staging context (not comparable, context only)

Staging D1 measured ~4.54 M rows read/24 h before the V14.3.2/V16.2.1A read work, and ~450 k
rows read/24 h afterwards. Those are real staging numbers for the whole alpha; the numbers in this
document are local synthetic measurements of one island. Do not mix them.

## 16. Migration / deployment status

**No migration. No deployment.** B2.5 adds no schema change: it reuses 0024/0026/0027 as they are, and
no staging or production artifact was uploaded or migrated.

## 17. Gates

```text
measurement harness     1 test (3 scenarios) pass, with equivalence + read-shape assertions
focused Auto regression 8 files, 76 tests pass (B0.1, B1, B2, cargo, executor)
full Vitest             181 files, 1757 tests pass   (was 180 / 1756)
typecheck               pass
lint                    pass, 0 warnings
git diff --check        clean
production web build    pass
Worker staging dry-run  pass (no deployment)
```

## 18. Recommendation before B3

1. **Do not add bulk settlement yet.** The measured dominant cost is observation, not settlement.
2. **B3 should reuse one observation across a bounded pass.** `AutoPlanObservation` exists for this:
   a reconciliation pass can read the farm once and advance up to its transition budget, instead of
   paying ~22 reads per event.
3. **Size the pass from the numbers above.** A 24 h offline return for a 121-cell island is ~9.5 k
   events at today's pacing; the reconciliation budget must bound that (and the 24 h cap must hold).
4. **Re-measure with bulk candidates only if B3 shows the observation-reuse pass is still too
   expensive** — and then bound any bulk settlement by both cargo capacity and the transition budget,
   with an all-or-nothing semantic identity.
