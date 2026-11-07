# V16.2.2D2.3 — B3 lazy offline reconciliation

Date: 2026-10-05. Verdict: **B3_OFFLINE_RECONCILIATION_COMPLETE**.

Baseline: B0.1 Atomic Auto Plant, B1 Atomic Auto Supply, B2 Atomic Auto Harvest + Unload and B2.5
Cloudflare optimisation are all COMPLETE. B3 makes the *absence itself* meaningful: closing the
browser no longer stops authoritative Auto time, and returning settles it lazily - with no tick, no
cron, no Durable Object and no queue.

## 1. Time and watermark model

`actor_auto_state.simulation_at` is the one durable fact. It is the authoritative instant the actor's
Auto timeline is settled through; everything before it is committed and immutable, everything after it
is derived. Reconciliation is the only thing that moves it forward.

```text
start  = simulation_at                       (null -> the server clock; nothing is simulated before
                                              Auto was first observed)
target = min(server now, start + 24 h)
```

The pass walks *events*, not seconds: at `cursor` it asks `AdvanceAuto` for one bounded transition at
that exact instant; a settlement happens at `cursor`; a walk advances `cursor` to the recorded arrival;
a growth wait advances `cursor` to the crop's own maturity. `simulation_at` is written by the
settlement that committed, so it always names an instant at which work actually happened.

## 2. 24-hour cap semantics

The cap is measured **from the watermark**, never from "time since the last login":

* a 30-hour absence reconciles through `start + 24 h` only;
* when the pass finishes (or is blocked) the watermark jumps to `now`, so the hours beyond the cap are
  *paused*, not pending;
* a second visit immediately afterwards therefore has nothing to reconcile - logging in and out cannot
  mint another 24 hours over an interval that was already settled.

Proven by `caps a long absence at 24 hours and cannot be replayed for a second window` (`targetAt −
startedAt` is exactly 24 h; the next call processes zero transitions).

## 3. Event-driven algorithm

```text
reconcile(actor, farm):
  start = simulation_at ?? now
  target = min(now, start + 24h)
  cursor = start
  while cursor < target and budget remains:
     step = AdvanceAuto.executeAt(actor, farm, cursor)     # one bounded transition
     WORKED      -> a settlement committed at cursor; cursor does not move (the actor keeps working)
     TRAVELLING  -> cursor = min(target, cursor + remaining travel)
     WAITING(+n) -> cursor = min(target, cursor + n)       # growth/resource wait the server can time
     WAITING(0)  -> BLOCKED: nothing can change without the player; stop
     RETRY       -> CONFLICT: another writer owns the timeline; stop
  write the watermark (see below)
```

No second-by-second, frame-by-frame or fixed-slice loop exists anywhere.

## 4. Reconciliation budget

```text
DEFAULT_RECONCILE_BUDGET = { transitions: 24, steps: 32 }
```

Chosen from B2.5's measurement (one Auto transition ≈ 26 statements / 22 read calls on a 121-cell
field): one call is a few hundred statements - bounded, small next to any request-limit concern, and
enough for a returning player to see progress. The budget is enforced per call, and the *client* loop
over calls is what finishes a long absence (measured: 85 calls for a 121-cell hour, 155 calls for a
4-cell day).

**Watermark on exhaustion**: if the budget runs out, the watermark is left exactly where committed
work ended - the settlements already wrote it - and `budgetExhausted: true` says so. It is never
advanced to the target. `stops at the exact processed instant when the budget runs out, and continues
from there` proves the watermark is strictly before the target and that the next call continues from
it.

## 5. Observation reuse

Within one pass, `AutoPassReuse` shares the two lists that cannot change while Auto runs: work-area
membership and standing building bounds. Crops, trees, cargo and the actor *do* change between
transitions and are re-read. The cache lives in one `ReconcileActorAuto.execute` call and is never
stored, shared between actors, or reused across requests - `AutoPassContext` is created per pass.

The simulated instant is authoritative inside the pass: `ResolveAutoPlan` projects maturity at the
supplied instant, `AdvanceAuto.executeAt` uses it for travel and growth, and the Auto plant/harvest
use cases stamp `planted_at` / the XP award / their receipts with the pass's event time rather than the
moment the player came back.

## 6. Trigger chosen

`POST /farms/:id/auto/reconcile` with a body of `{ requestId }` - one canonical entrypoint, server
authoritative, idempotent by construction.

The client calls it exactly twice in its lifecycle, both user-driven:

* `loadFarm` - entering the game (before the first farm read, so the island cannot paint stale);
* `visibilitychange -> visible` after the tab has been hidden for at least 60 seconds (a real absence,
  not a glance at another window).

It is **never** called by the 5-second growth poll, by a timer, or in the background. A farm with Auto
off answers `NOT_AUTO_CONTROLLED` and does nothing.

## 7. Online/offline coexistence

Both paths are the same code: `ReconcileActorAuto` calls the *same* `AdvanceAuto` the online loop uses,
which calls the *same* B0.1/B1/B2 atomic settlements. The only difference is the instant:

* online `POST /auto/step` uses the server clock and one transition per request;
* the pass uses `executeAt(..., cursor)` and one transition per simulated event.

One timeline, one set of guards. A stale actor version, a competing transition or a duplicated semantic
identity makes exactly one writer win: the online tab and the pass cannot both settle the same event,
and the loser reports `CONFLICT` (the client's next step simply re-resolves).

Two timeline semantics were fixed for this to be true:

1. **A walk no longer erases the watermark.** `travelTo`/`arrive`/`abandon` now carry
   `simulationAt` through, so an online walk cannot lose the instant reconciliation had reached.
2. **START begins an epoch.** Switching Auto on stamps `simulation_at = now`, so a period the player
   drove by hand is never retroactively simulated, and the settlement guards now also write the
   anchor on their conflict path, so the actor's recorded position follows the settlement that moved
   it.

## 8. Two-tab concurrency

`cannot duplicate economy when two tabs reconcile at the same time` runs two reconciliations
concurrently against one actor and compares the result with a single-tab run: cargo + warehouse totals
and XP are identical, and the harvest count matches. The winners are the same SQL guards the online
path already used (semantic receipt, `expectedVersion`, `simulation_at`), not browser coordination.

## 9. Blocked-state behaviour

`WAITING_FOR_SUPPLY`, `WAITING_FOR_FUNDS`, `WAITING_FOR_STORAGE`, `NO_ASSIGNMENT`, `DISABLED`,
`NOT_AUTO_CONTROLLED` and a growth wait with no wake-up all end the pass with `stopReason: "BLOCKED"`
or `"NOT_AUTO_CONTROLLED"` and **zero further steps** - no spinning the budget on a state that cannot
progress. Blocked time is paused: the watermark moves to `now`.

## 10. 1 h / 6 h / 24 h functional results (MEASURED)

| Scenario | Calls | Transitions | Harvests | Caught up |
| --- | --- | --- | --- | --- |
| 121 cells, 1 h | 85 | 1,349 | 605 | yes |
| 8 cells, 6 h | 73 | 1,095 | 472 | yes |
| 4 cells, 24 h | 155 | 2,319 | 992 | yes |

Every call stopped at its own budget and the client loop continued; no call ran unbounded, and the
watermark was exact after each one.

## 11. Reference equivalence

`reaches the same economics online and offline for the same elapsed time`: a 4-cell field is driven by
the online loop (one `POST /auto/step` per transition) for a measured elapsed window, then a second
world is given exactly that elapsed server time and reconciled with no online steps at all. Result:
4 harvests online, 4 harvests offline, and the offline XP equals `harvests × 4` - the same settlement
authority, the same reward rule. Receipt ids and step counts legitimately differ (different
orchestration), which is why the comparison is on economics and timeline, not on row ids.

## 12. CountingD1 cost (MEASURED, real repositories)

| Scenario | Calls | Batches | Statements | Reads | Rows read | Writes | Rows written |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 121 cells, 1 h | 85 | 1,349 | 63,611 | 52,060 | 214,911 | 11,551 | 10,846 |
| 8 cells, 6 h | 73 | 1,095 | 53,235 | 43,824 | 49,711 | 9,411 | 8,680 |
| 4 cells, 24 h | 155 | 2,319 | 113,260 | 93,480 | 90,923 | 19,780 | 18,194 |

Per returning call: ≈750 statements and ≈610 read calls (the pass re-reads crops/trees/cargo per
transition and shares the immutable lists). Per transition: ≈47 statements, ≈39 reads, ≈159 rows.
B2.5 measured ≈26 statements / ≈22 read calls per *step* on an empty-ish field; the difference is the
richer state a running field carries (list scans for a populated farm), not a regression in the
settlements.

These are local synthetic measurements, not Cloudflare billing figures.

## 13. Budget-exhaustion behaviour

Proven twice: the dedicated matrix test (watermark strictly before the target, then the next call
continues) and the cost runs (every window finished by repeated bounded calls rather than one giant
transaction).

## 14. No-background-work proof

`does zero work while the player is away`: after setup, the harness snapshot of batches, statements,
reads, rows, receipts and auto-state writes is taken, six hours of server time pass with no request,
and the second snapshot is byte-identical (a full zero-delta). The only thing that exists while a
player is away is the clock.

## 15. Migration status

**None.** B3 uses `actor_auto_state.simulation_at` (0027) and the existing `idempotency_keys`,
`actors`, `actor_cargo_items` and settlement tables. No schema change, no remote migration.

## 16. Deployment status

**None.** No Worker deploy, no web deploy, no remote database operation.

## 17. Manual QA checklist

1. Enable Auto on a farm with a planted field, note the island, close the tab for ≥ 5 minutes.
2. Reopen: the first farm read must already show the reconciled island (crops harvested/delivered,
   cargo and warehouse matching), with no visible "catch up" flicker.
3. Hide the tab for ≥ 60 s and return: the same reconciliation path runs on resume.
4. Leave the tab open and idle: the only traffic is the 5-second growth poll - no reconcile calls.
5. Turn Auto off, wait, reload: nothing changes (no Auto work while the player drives).
6. Two tabs, same farm, both reloaded after an absence: counts in Inventory/Warehouse and XP are the
   same as with one tab - nothing is paid twice.

## 18. Recommendation before staging

* Land it with a staging deploy **before** any public load test: the reconciliation path is the first
  feature that writes while a player is absent, and the returned per-call cost is now measurable.
* Re-measure on staging with `npx wrangler d1 info/insights` over a clean window; compare rows/day
  against the ~450 k baseline.
* If a returned player is expected to catch up a whole day in one screen, consider raising the
  per-call budget (transitions 24 → 48) and re-measuring - the watermark rule already makes partial
  progress safe, so this is a throughput knob, not a correctness one.
