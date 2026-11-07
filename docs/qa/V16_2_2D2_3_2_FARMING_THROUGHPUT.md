# V16.2.2D2.3.2 — Main Character farming throughput calibration

Date: 2026-10-05. Result: **D2_3_2_FARMING_THROUGHPUT_COMPLETE**.

Scope: Main Character Auto farming only. No pathfinding, no bulk farming, no Cargo change, no movement
change, no migration, no deployment.

## 1. Starting repository state

`HEAD e502bb4`, working tree dirty (B0–B3.1 WIP plus this task), `git diff --check` clean,
node v22.23.3 / npm 10.9.9. Nothing was reset, stashed, committed, pushed or deployed.

## 2. Existing Auto farming timing architecture

Three independent layers, and only one of them was ever a candidate:

| Layer | What it is | Where |
| --- | --- | --- |
| **A. Visual** | The client's work-gesture window after a successful transition before asking for the next step | `AUTO_GESTURE_MS` in `apps/web/src/main.ts` |
| **B. Authoritative labor** | Travel (`travelSeconds`) and crop growth; fishing/mining/forestry also have `actionSeconds` | `packages/domain/src/auto-travel.ts`, game data |
| **C. Orchestration** | One request per transition, no overlap, a 1.5 s back-off after a lost race, and the retry-after the server asks for | `scheduleAutoStep` / `delayForAutoStep` in `main.ts` |

There is **no authoritative Plant or Harvest work duration for crops**: planting and harvesting settle
atomically at their simulated instant (`PlantCrop` / `HarvestCrop`). "Making planting slower or faster"
therefore had nothing authoritative to change — the only farm-labor knob in the codebase is the
client's presentation window, which is layer A.

## 3./4. Existing Plant and Harvest timing pipelines

```text
reach cell (travel: authoritative)
  -> PLANT settles at that instant (no work duration)
  -> client plays AUTO_GESTURE_MS = 500 ms while the request for the next step is not in flight
  -> next plan / next walk

reach ripe crop (travel: authoritative)
  -> HARVEST settles at that instant (no work duration)
  -> same 500 ms gesture window
  -> cargo grows; a delivery is a separate travel + all-or-nothing unload
```

Both are instant in the model; the visible "work" is presentation, and the 500 ms window was the one
piece of dead time in the server's own timeline (the actor is idle while the client animates).

## 5. START Auto latency

`START` is a single `POST /workers/control` (or a step after it); the client acknowledges from the
response and the first step follows immediately — there is no fixed post-START sleep. The measured
first-transition latency in the harness is one request, so the observed "delay" is the round trip plus
the first travel leg, not a client timer. No accidental dead time was found or removed here.

## 6. Bottleneck analysis

The dominant cost is **authoritative waiting**, not the work gesture:

* travel is ~80% of a one-hour run on a 100/121-cell field (≈2.9–3.1 ks of 3.6 ks);
* growth is the dominant wait on a small field (≈2.3 ks of the 30-cell hour) and a minor one at 121
  cells (≈20 s, because a big field always has something ripe);
* the gesture window is 4–17% of the hour.

So §11/§12 apply: global movement speed is untouched, no pathfinding was added, and the remaining
large lever is D2.4 (travel/target ordering), not faster economic work.

## 7.–10. Baselines (MEASURED, one simulated hour per scenario)

Carrot, Cargo 30, deterministic layouts, the production handler/repositories/settlements behind the
harness `CountingD1`; the Home Island warehouse is raised for the measurement so *labor* is the limit
rather than the starter 1000-unit shelf. Cadence = the client gesture window.

| cells | cadence | plants | harvests | plant/min | harvest/min | transitions | supply trips | unload trips | stmts/h | reads/h | rows read/h | travel s | growth s | work s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30 | 500 ms | 270 | 240 | 4.4 | 3.9 | 535 | 9 | 16 | 27,730 | 23,247 | 64,751 | 1,048 | 2,277 | 268 |
| 30 | 350 ms | 270 | 240 | 4.5 | 4.0 | 535 | 9 | 16 | 28,035 | 23,503 | 65,464 | 1,048 | 2,318 | 187 |
| 30 | 250 ms | 270 | 246 | 4.5 | 4.1 | 541 | 9 | 16 | 28,415 | 23,820 | 66,524 | 1,066 | 2,345 | 135 |
| 60 | 500 ms | 420 | 410 | 7.0 | 6.8 | 871 | 14 | 27 | 45,731 | 38,294 | 185,670 | 1,783 | 1,296 | 436 |
| 60 | 350 ms | 434 | 420 | 7.2 | 7.0 | 897 | 15 | 28 | 47,083 | 39,428 | 189,855 | 1,837 | 1,360 | 314 |
| 60 | 250 ms | 440 | 420 | 7.4 | 7.1 | 903 | 15 | 28 | 47,930 | 40,142 | 193,102 | 1,842 | 1,402 | 226 |
| 100 | 500 ms | 475 | 375 | 7.9 | 6.2 | 926 | 49 | 27 | 48,839 | 40,887 | 295,554 | 2,935 | 121 | 463 |
| 100 | 350 ms | 540 | 465 | 9.0 | 7.7 | 1,076 | 38 | 33 | 56,615 | 47,407 | 350,825 | 2,863 | 254 | 377 |
| 100 | 250 ms | 560 | 482 | 9.3 | 8.0 | 1,114 | 38 | 34 | 58,678 | 49,137 | 367,949 | 2,884 | 326 | 279 |
| 121 | 500 ms | 597 | 596 | 9.9 | 9.9 | 1,257 | 25 | 39 | 65,941 | 55,162 | 496,038 | 2,842 | 11 | 629 |
| 121 | 350 ms | 601 | 598 | 10.0 | 10.0 | 1,263 | 25 | 39 | 66,404 | 55,550 | 501,276 | 3,011 | 23 | 442 |
| 121 | 250 ms | 601 | 601 | 10.0 | 10.0 | 1,269 | 27 | 40 | 66,698 | 55,798 | 503,730 | 3,119 | 40 | 317 |

## 11. Time distribution (MEASURED, seconds of the simulated hour)

| cells | travel | growth | work gesture | supply wait | other |
| --- | --- | --- | --- | --- | --- |
| 30 | 1,048 (29%) | 2,277–2,345 (63–65%) | 135–268 | 0 | ~50 |
| 60 | 1,783–1,842 (50%) | 1,296–1,402 (36–39%) | 226–436 | 0 | ~50 |
| 100 | 2,863–2,935 (80%) | 121–326 | 279–463 | 0 | ~50 |
| 121 | 2,842–3,119 (79–87%) | 11–40 | 317–629 | 0 | ~65 |

## 12./13. Candidates and their throughput

Candidates 500 (current) / 350 / 250 ms, measured above. Highlights:

```text
100 cells   transitions 926 -> 1,076 (+16%) -> 1,114 (+20%)   harvests/min 6.2 -> 7.7 -> 8.0
121 cells   transitions 1,257 -> 1,263 (+0.5%) -> 1,269 (+1%)  harvests/min 9.9 -> 10.0 -> 10.0
60 cells    transitions 871 -> 897 (+3%) -> 903 (+4%)
30 cells    transitions 535 -> 535 (0%) -> 541 (+1%)
```

## 14. D1 / Cloudflare relative cost

Cost scales with the work actually done, not multiplicatively: statements per transition stay ≈52 at
every cadence, so `stmts/h` moves with `transitions/h` (e.g. 100 cells: +16% work → +16% statements).
Nothing about the *offline* path changes: reconciliation never used the client gesture, so a
B3 reconciliation hour costs the same at any cadence.

## 15./16. Selected calibration and why

```text
SELECTED: AUTO_GESTURE_MS = 350 ms   (was 500 ms)
```

* It keeps a visible work action (the brief's ≈0.3–0.6 s window) while capturing ~80% of the
  throughput gain at the mid sizes (100 cells: +16% of +20%).
* It is dead time removed from the server's own timeline, so the extra work is legitimate additional
  labor over elapsed authoritative time — nothing is duplicated, and every transition still settles
  through the same atomic settlement.
* 250 ms adds the last ~4% of throughput for another ~4% of D1 and shortens the visible gesture
  toward the threshold where the work stops reading as work.
* At 121 cells the field is travel-bound, which is why all three cadences land within ~1%: the
  remaining opportunity belongs to D2.4, not to faster economic work.

## 17./18. Before/after throughput and START responsiveness

Per simulated hour, 500 → 350 ms: transitions +0% (30 cells), +3% (60), +16% (100), +0.5% (121);
harvests/min 3.9→4.0, 6.8→7.0, 6.2→7.7, 9.9→10.0. START latency is unchanged (one request, no added
timer); the *first* transition now lands 150 ms sooner because the same window is shorter.

## 19. Online/offline equivalence

Unchanged by this task: the gesture is client presentation, the offline reconciler advances by travel
and growth only, and the B3 equivalence proof (same elapsed server time → same durable economics)
still passes (`tests/integration/auto-reconcile-cost.test.ts`). The durable digest for a *fixed
simulated window* is unaffected because authoritative timing did not change.

## 20. Economic/conservation proofs

The throughput harness runs the real settlements: crop/tile/cargo/warehouse/wallet/XP rows are the
production ones, and the existing B0.1/B1/B2/B2.5/B3/B3.1 suites (including replay, concurrency,
cargo-full, warehouse-full and conservation) all pass unchanged.

## 21. B3.1 regression

Emergency funding is untouched: the funding tests (pure, settlement-level and route-level) still pass,
including priority persistence, minimum sale, insufficient-whitelist zero sale and offline funding.

## 22. Estimated D2.4 opportunity

Travel is 79–87% of a large-field hour and 29% of a small one; growth is the small-field equivalent.
A pathfinder that removed even a quarter of the field travel would add roughly 20% throughput on 100+
cells — an order of magnitude more than the last cadence step. **Further speedup should come from
D2.4, not from faster economic work.**

## 23. Natural Main Character capacity conclusion (MEASURED, balance only — not encoded anywhere)

| Field | What the measurement shows |
| --- | --- |
| 20–50 cells | comfortable: the actor is growth-bound (63–65% of the hour waiting on crops) and keeps the field planted |
| 50–100 cells | practical but logistics appears: 14–49 supply trips and 27 unload trips per hour, travel ≈50–80% |
| 100–150 cells | increasingly constrained: travel ≈80%, only ≈10 harvests/min, and the starter 1000-unit warehouse caps a big field long before the actor does |
| 150+ cells | naturally demands workers, carts and machinery: one labor timeline cannot cover the travel |

## 24. Future worker/tool implications

The measurement gives the future systems a clean baseline: a second actor is worth roughly the travel
fraction of a second field, tools/machinery that shorten travel (or raise Cargo) attack the 80% line,
and nothing needs a per-area penalty — the limit already emerges from travel, growth, Cargo and trips.

## 25./26. Migration and deployment

**No migration. No deployment.** The task ended local: measurement harness, one presentation constant,
tests and this report. Staging still runs the B3.1 build from the previous task.

## Gates

```text
throughput harness   12 scenarios (30/60/100/121 × 500/350/250) pass, with the table above
focused              funding 13 + funding-settlement 4 + reconcile + B2.5 harness
full Vitest          188 files / 1796 tests passed
typecheck · lint · git diff --check        pass
web build            assets/index-D589NsTP.js (the new 350 ms constant)
Worker staging dry-run                     pass
```
