# V16.2.3E — Staging Deployment Readiness Audit

Date: 2026-10-08  
Mode: read-only audit and validation  
Deployment or remote migration: not performed

## Verdict

`STAGING_NEEDS_REVISION`

V16.2.3E1 closes the code-quality and Production Rate regression blockers. The staging
infrastructure exists and is reachable, the remote migration list is known, and the staging Worker
dry-run is compatible with the current workspace. Deployment is still not authorized because:

1. the target V16.2.3 changes are not in `HEAD` and the working tree contains the intentional dirty
   feature work;
2. migrations 0029–0031 remain pending and were not applied by this audit; and
3. a positive authenticated browser session was not created during this read-only audit. The live
   unauthenticated boundary was checked, while `GET /api/session` was deliberately not called because
   it creates a persistent guest identity.

These are release gates, not reasons to apply the migrations or deploy around the checks.

## V16.2.3E1 blocker closure

The original lint and Production Rate blockers are closed by targeted changes only:

- `npm run lint`: PASS; all original 14 errors are resolved without broad lint disables.
- Production Rate standalone suites: PASS — settlement 11/11, repositories 4/4, application 6/6.
- Production Rate combined suite with domain tests: PASS — 4 files, 29 tests.
- Full focused regression set: PASS — 15 files, 107 tests.
- Economic-safety set: PASS — 8 files, 56 tests.
- Typecheck, build, staging Worker dry-run, and `git diff --check`: PASS.

One real production bug was corrected in `packages/domain/src/production-rate.ts`: an initially
zero-capacity Warehouse previously advanced the cursor and fixed-point remainder while producing
zero output. It now remains at the existing cursor/remainder and records `WAREHOUSE_FULL`, preventing
hidden backlog. A pure-domain regression proof and the real D1 persistence test cover this boundary.

The other original failures were stale fixture/assertion issues: inventory queries expected a version
column they did not select, repository fixtures violated the one-farm-per-player invariant, an
application fixture used nullish fallback for an explicitly unauthorized member, and the 24-hour
domain fixture had only 100 units of Warehouse capacity. Those tests now assert the established
authoritative semantics rather than weakening economic checks.

## Repository and HEAD

| Check | Result |
| --- | --- |
| Branch | `master`, ahead of `origin/master` by 47 commits |
| HEAD | `e502bb4550fd1097fdc69dc1fa30d96c75b6b545` (`V16.2: add island warehouse foundation`) |
| Working tree | Dirty; preserved exactly; no reset, stash, clean, commit, or push performed |
| Status count | 257 entries: 98 modified and 159 untracked |
| Target migrations in HEAD | 0029, 0030, and 0031 are absent from HEAD and untracked locally |
| Aquaculture application code in HEAD | absent; present as an untracked local change |

The workspace contains the complete local feature work, but it is not a deployable immutable
revision. A future deployment must be built from a reviewed commit containing the intended code,
tests, documentation, and migrations. The plain `workers/api/wrangler.toml` remains a local config
with an all-zero database id and must not be used for staging deployment.

## Staging configuration and routing

`workers/api/wrangler.staging.toml` is populated and passes `npm run check:staging-config`.

- Worker name: `happy-farm-staging`.
- Entrypoint: `workers/api/src/index.ts`.
- Compatibility date: `2026-09-27`.
- Static assets: `apps/web/dist`, binding `ASSETS`, SPA fallback enabled.
- D1 binding: `DB` → `happy-farm-staging`.
- D1 identifier: `acc598c9-e726-46c8-b1a3-23e5b6a42d52`.
- Access team and audience bindings are configured; their values are intentionally not reproduced
  here.
- `GUEST_AUTH_ENABLED = "true"` and `STARTER_GRANT_POLICY = "ALL_UNRECEIPTED"` are configured for
  the current public staging alpha.

The Worker serves the SPA and API on one origin. `/api/*` is stripped once by
`workers/api/src/staging-routing.ts` and sent to the API handler; all other paths go to static
assets. The browser uses `API_BASE = "/api"`, so no separate Pages project or CORS path is required
for the documented topology.

Read-only live checks on 2026-10-08 returned:

| Request | Result |
| --- | --- |
| `GET https://happyfarm-staging.longfx.trade/` | 200 |
| `GET https://happyfarm-staging.longfx.trade/api/health` | 200 |
| `GET https://happyfarm-staging.longfx.trade/api/shop` without credentials | 401 |
| `GET https://happy-farm-staging.duclong-reg.workers.dev/api/health` | 200 |

The current active deployment reported by Wrangler is version
`1d703a89-f496-4ed6-ac84-328db7e9361c`, created 2026-10-04. It predates the local 0029–0031
feature work. The repository deployment note identifies it as the V16.2.2D2 deployment.

## Remote and local migration state

Local migration files are sequential through 0031. The relevant files are:

1. `0029_production_rate_core.sql`
2. `0030_wild_fishery_stock.sql`
3. `0031_aquaculture_pond_cycle.sql`

Wrangler D1 listing confirmed that the configured remote database exists. The first read-only
`d1 migrations list --remote` attempt returned Cloudflare error 7403; a retry succeeded and reported
exactly these pending migrations, in this order:

```text
0029_production_rate_core.sql
0030_wild_fishery_stock.sql
0031_aquaculture_pond_cycle.sql
```

No migration command was applied. The pending list is consistent with migrations through 0028 being
already recorded remotely; the command reports pending rows rather than a complete applied-history
ledger. The transient 7403 should be treated as an operational prerequisite to resolve or recheck
before a deployment window.

Compatibility assessment:

- 0029 adds `actor_jobs.execution_mode` and the Production Rate tables. It is additive and must land
  before code that reads Production Rate state.
- 0030 rebuilds `work_areas` and `actor_jobs` to add the `FISHERY` vocabulary, copies existing rows,
  and adds `fishing_spot_states`. It must follow 0029 because it copies the Production Rate job
  column. This is the highest-risk migration and needs a backup plus before/after row-count checks.
- 0031 adds aquaculture pond state, settlement receipts, and database triggers. It is additive and
  depends on the existing construction, membership, inventory, and warehouse schema.

The migrations are forward-only. Existing player, farm, construction, inventory, warehouse, work
area, actor, and job rows should remain compatible by design, but the 0030 table rebuild must be
validated on a staging backup before any apply. A Worker containing the new routes must not be
deployed before all three migrations are applied.

## Authentication readiness

The deployed entrypoint uses `CloudflareAccessAuthenticator` plus the policy-gated guest session
authenticator. Actor identity is derived server-side from a verified Access JWT or a stored opaque
`hf_guest` cookie; request-body player IDs are not the identity source. Unsafe methods are protected
by the existing origin/CSRF boundary.

The positive guest establishment route is `GET /api/session`, and it is the only route allowed to
create a guest identity. It was not called during this audit to preserve read-only behavior. The
live 401 from `/api/shop` proves the protected boundary is active, and local Access, development
auth, and middleware tests passed in the clean focused run. A post-deployment browser acceptance
must still establish one disposable staging guest or use a real Access-authenticated tester, then
prove that the same browser can load and mutate only its own farm.

## D1 cost and polling audit

The current client-side design passes the static cost checks:

- the only periodic timer is the five-second visible growth refresh;
- the timer reads crops and trees only, not tiles, constructions, production, or aquaculture state;
- hidden tabs do not poll and an in-flight refresh is not stacked;
- `requestAnimationFrame` is renderer work, not an API/D1 request loop;
- Production Rate reconciliation is an explicit request used on load/resume/visibility handling, not
  an idle interval;
- farm actions refresh only the lists they can change; full-farm refresh remains an explicit load or
  manual-refresh path;
- no full-farm reconciliation loop or per-frame economic write was found.

The repository’s read-cost tests and `tests/web/auto-reconcile-trigger.test.ts` passed. The prior
staging read audit remains relevant: leaving public tabs open is still a real D1 cost even after the
growth-only/visibility gate, so the browser checklist below must include idle-tab monitoring.

## Validation performed

### Passing focused regression set

The clean focused command passed 15 files and 107 tests, covering:

- Apple Orchard HTTP/D1, offline return, and Production Rate binding;
- Forestry and Mining Production Rate;
- Wild Fishery Production Rate;
- Aquaculture vertical slice;
- Warehouse behavior, migration, and capacity;
- Access auth, development auth, and API middleware;
- reconciliation cost and browser polling cost;
- catalogue read cost.

### Initial failures closed by E1

The original audit snapshot recorded failures in the settlement, repository, application, and
domain suites. E1 reran each suite independently and in combination after classification and
targeted fixes; no known Production Rate test failure remains.

### Build and static gates

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; original 14 errors closed |
| `npm run build` | PASS; non-fatal Rollup annotation and large-chunk warnings |
| `npm run build:worker:staging` | PASS; dry-run only, assets and `DB`/`ASSETS` bindings resolved |
| `npm run assets:validate` | PASS; 27 models match their specs |
| `npm run check:staging-config` | PASS |
| `git diff --check` | PASS; only CRLF normalization warnings |

No deployment, remote migration, commit, push, reset, stash, or clean operation was performed.

## Exact prerequisites before deployment

1. Review and commit the intended V16.2.3 changes; do not deploy the current dirty workspace or
   `HEAD` alone.
2. Preserve the passing E1 validation evidence and rerun the full focused set and required build
   gates from that reviewed commit.
3. Confirm the Wrangler identity can repeatedly read the configured staging D1. Re-run the remote
   migration listing immediately before the window and preserve its output.
4. Take the approved staging D1 backup/row-count snapshot and verify the target database name and id.
5. Apply only the pending migrations, in the reported order 0029 → 0030 → 0031, using the staging
   config. This audit did not apply them.
6. Re-run the migration listing and verify no pending migrations remain. Check key row counts and
   constraints, especially `work_areas`, `actor_jobs`, `fishing_spot_states`, and aquaculture tables.
7. Build the web assets and staging Worker dry-run from the reviewed commit, then deploy only
   `workers/api/wrangler.staging.toml`.
8. Complete the browser acceptance checklist below on one canonical hostname, then test the second
   hostname only if it is intentionally part of the playtest.

## Safe deployment sequence

```text
reviewed commit
  -> typecheck/lint/focused tests/build/diff check
  -> remote migration list and D1 backup
  -> apply 0029, then 0030, then 0031
  -> verify no pending migrations and inspect row counts
  -> build web + staging Worker dry-run
  -> deploy staging config only
  -> health/unauthenticated checks
  -> authenticated browser acceptance
  -> monitor D1 reads, errors, and duplicate/retry behavior
```

Do not deploy the local `wrangler.toml`, do not apply migrations to production, and do not assume a
Worker rollback reverses forward-only D1 migrations.

## Browser acceptance checklist

- Open one documented canonical staging hostname and confirm the SPA shell and a representative GLB
  asset load.
- Confirm `/api/health` is 200 and a protected endpoint without a cookie/JWT is 401.
- Establish one guest session or enter through the configured Cloudflare Access application; confirm
  the player and home farm load without a development bootstrap route.
- Verify Apple offline settlement, Forestry, Mining, Wild Fishery, and the aquaculture cycle through
  real HTTP requests and the staging D1.
- Verify a duplicate request/retry produces no duplicate warehouse output.
- Verify warehouse-full behavior is explicit and leaves the source/cycle state safe.
- Verify a cross-farm request is rejected and an unauthenticated request is rejected.
- Leave the tab idle and watch that there is no per-frame request traffic and no production polling;
  background the tab and confirm growth polling stops.
- Return after server time has advanced and confirm authoritative offline progression without client
  activity.
- Record the Worker version, migration state, request IDs, and warehouse before/after quantities.

## Remaining limitations

- This audit did not create a staging player because that would mutate remote D1 during a read-only
  task. Positive live authentication remains a required post-deployment acceptance step.
- Remote migration history is known through Wrangler’s pending list, but the first read returned a
  transient authorization error. Repeated access should be part of the deployment preflight.
- The current QA/deployment notes describe the older V16.2.2D2 deployment; they should be updated
  after the reviewed V16.2.3 deployment, not before.

## Final verdict

`STAGING_NEEDS_REVISION`
