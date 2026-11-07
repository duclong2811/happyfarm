# V16.2.2D2.3 — B3 staging release + human QA preparation

Date: 2026-10-05. Result: **B3_STAGING_DEPLOYED_READY_FOR_HUMAN_QA**.

Target: Cloudflare **staging only** — `happy-farm-staging`, canonical
`https://happyfarm-staging.longfx.trade/`. Production was not touched in any way.

## 1. Pre-deploy git state

```text
branch            master (ahead of origin/master)
HEAD              e502bb4550fd1097fdc69dc1fa30d96c75b6b545  "V16.2: add island warehouse foundation"
working tree      194 dirty entries (tracked modifications + untracked B0–B3 work)
git diff --check  clean
node / npm        v22.23.3 / 10.9.9
```

Nothing was committed, pushed, stashed, reset or cleaned.

## 2. Fresh gate results

| Gate | Result |
| --- | --- |
| Full Vitest (pre-deploy) | **183 files / 1770 tests passed** |
| Full Vitest (final, with the release fix and the trigger test) | **184 files / 1774 tests passed** |
| typecheck | pass |
| lint | pass, 0 warnings |
| `git diff --check` | clean |
| production web build | pass — `assets/index-CDlBBlym.js` (1,222.61 kB / 322.87 kB gzip), `assets/index-JL3LWMqx.css` |
| Worker staging dry-run | pass — 1,568.49 KiB / 254.95 KiB gzip |

## 3. Migration audit

`wrangler d1 migrations list happy-farm-staging --remote` → **"No migrations to apply!"**.

Remote staging already carries every migration the repository ships (0001–0027), B3 adds no schema
change, and **no migration was applied** during this release. Production D1 was never contacted.

## 4. Pre-deploy staging metrics (MEASURED REMOTE)

`wrangler d1 info happy-farm-staging`, rolling 24 h window at deploy time:

```text
num_tables        27
database_size     4.8 MB
read_queries_24h  13,279
write_queries_24h 2,148
rows_read_24h     396,541
rows_written_24h  6,958
region            APAC
```

This is a rolling window, not an A/B against the previous deploy; the ~450 k figure in the B2.5 doc
remains historical context only.

## 5. Versions

| | Version | Created |
| --- | --- | --- |
| Previous (rollback target) | `6cff7ea5-6da4-40d9-898d-5b6aec6d0bf1` | 2026-10-04T11:41:39Z |
| First B3 deploy (superseded) | `44dc619c-8e84-4c98-900d-233533c11449` | 2026-10-05T04:5x |
| **Current staging** | `5a6c6d21-9a54-4b78-b237-ca3d3466252b` | 2026-10-05T05:00:09Z |

Rollback: `npx wrangler rollback 6cff7ea5-6da4-40d9-898d-5b6aec6d0bf1 --config workers/api/wrangler.staging.toml`.

## 6. Remote smoke (non-destructive)

```text
GET  /api/health                                200 {"ok":true,"data":{"status":"ok"}}
GET  /                                          200, serves assets/index-CDlBBlym.js + index-JL3LWMqx.css
GET  /assets/index-CDlBBlym.js                  200, 1,222,609 bytes, contains "auto/reconcile"
GET  /api/session (fresh)                       200, Set-Cookie hf_guest (HttpOnly)
GET  /api/session (same session)                200, identical payload - the guest persists
POST /api/farms/:id/auto/reconcile (no cookie)  401 NOT_AUTHENTICATED
POST /api/farms/<unknown>/auto/reconcile        404 RESOURCE_NOT_FOUND
POST /api/farms/:id/auto/reconcile (guest)      200 stopReason=NOT_AUTO_CONTROLLED, transitions=0
POST /api/farms/:id/auto/step                   200 phase=STOPPED, waitReason=NOT_AUTO_CONTROLLED
```

One fresh guest + farm was created for this smoke (industry-standard practice for staging); no
existing player's farm was read or mutated.

## 7. Bug found by the smoke and fixed before the final deploy

The first B3 deploy answered **`ACTOR_NOT_FOUND` (400)** for a brand-new guest farm, because the
client now calls reconciliation on entry and a fresh farm has no actor row yet. That is a normal state,
not an error: `ReconcileActorAuto` now answers `NOT_AUTO_CONTROLLED` with zero work when the actor does
not exist, and `tests/integration/auto-reconcile.test.ts` pins it. The Worker was redeployed
(`5a6c6d21-…`) and the smoke above passes.

## 8. Poll / reconcile separation

`tests/web/auto-reconcile-trigger.test.ts` reads `apps/web/src/main.ts` and asserts:

* `reconcileAutoOnce()` is referenced exactly three times: its definition, the `loadFarm` call and the
  resume call;
* `api().reconcileAuto(...)` appears exactly once;
* `refreshGrowthOnce` (the 5-second poll) contains no reconciliation;
* the source contains no `beforeunload` and no `sendBeacon`;
* the resume path requires `awayMs >= 60_000` (a real absence, not a tab glance);
* the growth timer is still `setInterval(refreshGrowthOnce, GROWTH_REFRESH_INTERVAL_MS)`.

The deployed bundle was also checked to contain the route.

## 9. Post-deploy metrics (MEASURED REMOTE)

Immediately after the final deploy:

```text
num_tables        27
database_size     4.89 MB
read_queries_24h  12,329
write_queries_24h 1,233
rows_read_24h     380,524
rows_written_24h  4,143
```

Still a rolling 24 h window (mostly pre-deploy traffic). Do not read it as a before/after comparison;
it is a new observation point. Re-measure after real B3 QA.

## 10. Human QA checklist

### A. Primary offline test

1. Open `https://happyfarm-staging.longfx.trade/` (fresh guest or your usual staging guest).
2. Create a small `FARM` Work Area (4–12 cells) on natural grass, and one `REPLANT_CROP` assignment
   with a fast crop (carrot). Turning **Auto Purchase Supplies ON** is optional and useful.
3. START Auto. Watch until you have seen: the actor walk, supply enter Cargo, and a crop planted.
4. Record the BEFORE state: current time, Gold, XP, Cargo quantities, Warehouse quantities, number and
   state of crops.
5. Close the browser tab completely.
6. Wait 10–20 real minutes.
7. Reopen the canonical URL.
8. Record the AFTER state (same fields) and check: reconciliation happened on return; Auto progressed
   according to the elapsed server time; crops/Cargo/Warehouse/XP reflect legitimate work; no
   teleporting and no duplicated goods; the game is usable afterwards.
9. Note UX: approximate time from page open to a caught-up/usable state, whether several reconcile
   requests happened, any 429/5xx/timeout, any visible lag or freeze.

### B. Visibility resume

10. With Auto running, switch to another tab/window for more than 60 seconds, then come back.
11. Expect one reconciliation opportunity on return, progress to occur, no rapid repeat loop, and the
    5-second crop/tree poll to stay separate.

### C. Auto off

12. STOP Auto, record the state, leave for several minutes, return: **no** retroactive Auto work for the
    manually controlled period.

### D. Two tabs (recommended)

13. Same guest, two tabs, Auto on, hide both long enough to accumulate time, then bring both back
    near-simultaneously. Expect no duplicate harvest, XP, Gold charge, Cargo or corrupt Auto state.
    The two responses need not be textually identical; the durable economy must be correct.

### E. Blockers (only if quick)

14. Cargo full: Auto returns and unloads rather than destroying a harvest.
15. Warehouse full: cargo stays with the actor, nothing is lost, Auto shows a waiting state.

## 11. Known limitations

* Reconciliation is client-triggered (entry + resume). A player who never reopens the page gets no
  offline progress until they do - by design; there is no server-side tick.
* A long absence may need several bounded reconciliation calls; the client only re-renders after the
  calls it makes, so a very long absence may take a moment to look caught up (measure it in QA).
* Offline work is bounded by the 24 h cap *and* by physical storage and supply, exactly as the design
  says.

## 12. Production safety

```text
Production deployed?  NO
Production DB modified?  NO
Migrations applied remotely?  NO (none were pending)
```
