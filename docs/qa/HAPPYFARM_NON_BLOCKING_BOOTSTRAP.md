# HappyFarm non-blocking 3D bootstrap

Date: 2026-10-11  
Scope: client startup sequencing and development-only instrumentation  
Deployment/migration: none

## Result

`NON_BLOCKING_BOOTSTRAP_COMPLETE`

The renderer no longer waits for Production Rate reconciliation or the account/Warehouse refresh.
Server authority, settlement ordering, and existing game mechanics are unchanged.

## Old startup dependency graph

```text
HTML/JS
  -> session
  -> Farm authorization and /farm
  -> orchard visual snapshot
  -> fishing + resource bootstrap
  -> Auto reconciliation
  -> Production reconciliation
       -> account refresh (inventory, wallet, Warehouse, catalogues)
  -> full Farm refresh
  -> renderer creation
  -> first frame
```

The sequential reconciliation and account work was on the critical path to renderer creation. A
Production reconciliation failure could therefore leave the 3D world waiting even though the
renderer itself did not require settlement.

## New startup dependency graph

```text
HTML/JS
  -> session
  -> Farm authorization and /farm
  -> minimum world reads in parallel
       - Farm tiles/crops/trees/constructions/ponds
       - fishing catalogue/active action
       - resource nodes/active action
  -> farm_loaded
  -> renderer_init_started -> first_3d_frame -> game_interactive

Independent background path after renderer start:
  -> Auto reconciliation (existing order)
  -> Production reconciliation
  -> one authoritative account/Warehouse refresh
  -> warehouse_ready and scene/read-model refresh
  -> return popup from server-produced items, when settlement succeeded
```

The optional orchard visual snapshot is also late and farm-id checked before adoption. New-farm
creation uses the same minimum world path but does not run offline settlement.

## Data dependencies and safety

- Session resolution establishes the actor context; the browser does not send identity as authority.
- Farm authorization and the returned Farm id are required before any reconciliation request.
- The renderer requires the minimum world read model, not account settlement.
- Reconciliation uses the server's Farm id and its returned `producedItems`; no production is calculated
  locally.
- Warehouse, inventory, wallet, progression, and catalogue state become mutation-ready only after the
  authoritative account read succeeds.
- `refreshAccount`, Auto reconciliation, and Production reconciliation are single-flight.
- Crop/tree/plant, construction, market, Warehouse, worker Auto, fishing, and mining mutations are
  gated while account/reconciliation state is not ready. Camera movement and other non-economic 3D
  work remain available.
- Fishing/mining settle timers are paused safely during the gate and rescheduled after authoritative
  state is ready.

## Return popup and failure behavior

The existing popup remains presentation-only for away duration. It displays only positive quantities
from the successful server reconciliation response, including a correct zero-production result. A
failed reconciliation does not grant local resources, does not show a fabricated reward, and leaves a
recoverable sync error while the renderer remains usable. The popup is single-shot per return lifecycle.

## Instrumentation

The existing development-only `?perf=1` diagnostics now expose these marks independently:

`app_started`, `session_resolved`, `farm_loaded`, `renderer_init_started`, `first_3d_frame`,
`reconcile_started`, `reconcile_finished`, `warehouse_ready`, `game_interactive`.

API request timings remain separate from stage marks and do not record request bodies, headers,
cookies, or response data.

No authenticated staging browser timing was available in this run. Therefore no before/after 3D boot
timing improvement is claimed. Existing public unauthenticated probes measured `/api/health` and
`/api/session`, but they are not authenticated gameplay evidence. The next browser run must capture
the marks from an authenticated staging session, including a deliberately slow or failed reconcile.

## Validation

- Focused bootstrap/client suite: 6 files, 30 tests passed.
- Requested Apple, Forestry, Mining, Fishery, Aquaculture, Warehouse, offline-popup, and
  authentication regressions: 25 files, 175 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed for web and Worker dry-run build.
- `git diff --check`: passed; Git emitted existing LF/CRLF normalization warnings only.

## Files changed for this task

- `apps/web/src/main.ts`
- `apps/web/src/boot-performance.ts`
- `apps/web/src/i18n.ts`
- `tests/web/boot-performance.test.ts`
- `tests/web/non-blocking-bootstrap.test.ts`
- `tests/client/offline-return-popup.test.ts`
- this report

No Worker deployment, D1 migration, Production change, commit, push, reset, stash, clean, or automatic
restore was performed.

## Remaining browser evidence

1. Authenticated staging `?perf=1` trace with all marks and API timings.
2. Visible 3D frame while reconciliation is delayed, then Warehouse readiness and popup result.
3. Reconciliation failure with renderer retry/recovery and no local reward.
4. Protected endpoint rejection without authentication, then a real authorized Farm/Warehouse read.
5. First-load and hidden-to-visible gameplay checks using an authorized staging account.
