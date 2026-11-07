# V16.2.2D2.4 — Auto navigation + target ordering

Date: 2026-10-05. Result: **D2_4_AUTO_NAVIGATION_NEEDS_REVISION** — the audit and measurement are
complete and one ordering candidate was implemented and measured; the evidence says the remaining
travel is *physical* (maturity order + supply/unload trips) rather than a selection or pathing bug, so
the bounded-routing and unreachable-target work was **not** built. The candidate that was built did
not pay and was reverted.

Scope: Main Character Auto farming navigation only. No movement-speed, cadence, Cargo, economic,
migration or deployment change.

## 1. Starting HEAD / state

`HEAD e502bb4`, dirty tree (B0–B3.1 + D2.3.2 + this task), `git diff --check` clean, node v22.23.3.
Nothing reset, stashed, committed, pushed or deployed.

## 2. Existing target-selection algorithm

`AdvanceAuto.perform` takes the **first** candidate in the list the Work Area produced:

* PLANT → `field.open[0]`;
* HARVEST → `field.mature[0]`;

and those lists come from `auto-targets.ts`, which returns the area's cells in a stable row-major
order (`y`, then `x`). The actor's current position, its previous target and the direction of travel
are not consulted. Selection is deterministic; it is simply position-blind.

Supply and destination anchors are fixed (`WAREHOUSE_ANCHOR`, `MARKET_ANCHOR` from game data), so there
is nothing to choose there.

## 3. Existing navigation algorithm

`travelSeconds(from, to, tiles, pitch, speed)` = Euclidean tile distance × pitch ÷ walk speed, clamped
to `[0.4 s, 180 s]`. It queries nothing, knows nothing about obstacles, and is the same function the
offline reconciler uses. Movement is therefore:

* one straight hop per transition, at a constant speed;
* no route, no waypoints, no cache, no pathfinding;
* crops are passable by construction — nothing in the model treats a planted cell as an obstacle.

## 4. Sources of wasted travel (measured)

Two facts dominate the 100/121-cell hour (79–87% travel):

1. **Maturity order versus sweep order.** Crops ripen where they were planted *earliest*, while the
   plan's next target is the earliest cell in row-major order. After a sweep the actor is at the far
   end of the field while the ripening front is back at the near end, so every harvest pass crosses
   the field.
2. **Fixed destination trips.** At 121 cells the measured hour contains ~25 supply trips and ~39–40
   unload trips. Each is a full field↔warehouse walk; Cargo 30 makes them frequent by design.

The measured average is ~2.4 s of travel per transition at 121 cells (≈3,020 s / 1,251 transitions),
which is several tiles per action — the crossings are real, but they are produced by those two
patterns, not by the choice of "first" versus "nearest".

## 5./6. Candidate ordering and the experiment that decided it

Considered: (a) row-major first (current), (b) nearest-to-actor, (c) serpentine sweep, (d)
nearest-with-continuity. The simplest candidate that could plausibly pay — **(b) nearest-to-actor,
deterministic ties by row-major order** — was implemented in `AdvanceAuto.perform` for both PLANT and
HARVEST and measured against the identical D2.3.2 setup (AUTO_GESTURE_MS 350 ms, Cargo 30, carrot, one
simulated hour, real settlements, `CountingD1`).

| cells | BEFORE transitions / travel s | AFTER (nearest) transitions / travel s | verdict |
| --- | --- | --- | --- |
| 30 | 535 / 1,048 | 535 / 1,052 | unchanged |
| 60 | 897 / 1,837 | 872 / 2,029 | **worse** |
| 100 | 1,076 / 2,863 | 1,074 / 2,906 | ~unchanged |
| 121 | 1,263 / 3,011 | 1,251 / 3,020 | ~unchanged |

Nearest-first is a greedy cover, and on this field it does not beat the raster order the row-major
list already produces; the extra crossings come back through the maturity front and the warehouse
trips. **The change was reverted**, leaving the codebase at its measured-better state.

## 7.–13. Pathfinding, obstacles, bounds, routes, unreachable targets

Not implemented, and the measurement above is the reason:

* farm ground has no obstacles in the model (crops and soil are passable, and the shipped field is open
  land), so a bounded A* over the Work Area would compute the same straight line `travelSeconds`
  already uses;
* there is consequently no "blocked direct travel" to route around on a normal field, and no
  unreachable target to skip — the case that motivates them (a fence or building cutting a field) does
  not exist on the current layouts, and inventing it would be scope without evidence;
* adding route state, cache invalidation and unreachable bookkeeping now would add surface area and D1
  risk for zero measured gain.

This is the §2/§30 outcome: implement the simplest architecture the measurement supports, and state
plainly that the rest is deferred.

## 14.–17. Offline model and benchmarks

Offline reconciliation already derives travel from the same route distance the online model uses (a
single `travelSeconds` value per hop) and jumps the event cursor to the arrival — no waypoint
simulation, no per-second loop. Because navigation is unchanged, the D2.3.2 numbers *are* the current
numbers at 350 ms:

```text
30 cells   4.5 plant/min   4.0 harvest/min   535 transitions/hour   travel 1,048 s (29%)
60 cells   7.2 plant/min   7.0 harvest/min   897 transitions/hour   travel 1,837 s (51%)
100 cells  9.0 plant/min   7.7 harvest/min   1,076 transitions/hour travel 2,863 s (80%)
121 cells 10.0 plant/min  10.0 harvest/min   1,263 transitions/hour travel 3,011 s (84%)
```

## 18.–20. CPU, D1 and equivalence

No navigation CPU was added (nothing was kept), so path calculations/hour, expanded nodes and route
reuse are all unchanged: zero routes exist. D1 is unchanged against D2.3.2 at the same cadence.
Online/offline equivalence is untouched — the reconciler and the online loop share the one
`travelSeconds` function, and the B3 equivalence proof still passes.

## 21.–22. Regression

All Auto/economy suites pass after the revert (57 focused tests across `auto-execution`,
`auto-reconcile`, `work-skill`, plus funding/settlement suites). Movement speed, `AUTO_GESTURE_MS`,
Cargo, settlements, B3.1 funding and manual Character movement are untouched — no source change
remains from this task.

## 23. Remaining limitations (the real D2.4 backlog)

1. **Travel is physical.** 80%+ of a large-field hour is walking, driven by the maturity front and by
   Cargo-30 delivery trips. The levers that move it are logistics (carts, bigger hands, a second actor)
   or a *field layout* that keeps the ripening front near the actor.
2. **No obstacle routing.** Once buildings, fences or large props cut a field, straight-line travel
   will be wrong and a bounded A* (plus route cache/invalidation and unreachable handling) becomes
   justified — that is the natural next slice, and it should start from a measured, obstructed field.
3. **No serpentine strategy.** A true serpentine would need to track the field's sweep direction and
   survive edits; the measurement does not yet show it beating the raster order.

## 24./25. Migration and deployment

**No migration. No deployment.** This task ends local, with no source change kept.

## Gates

```text
focused      auto-execution + auto-reconcile + work-skill: 57 tests pass (after the revert)
throughput   the 12-cell × 3-cadence matrix runs and is the measurement above
typecheck    pass        lint: pass        git diff --check: clean
```
