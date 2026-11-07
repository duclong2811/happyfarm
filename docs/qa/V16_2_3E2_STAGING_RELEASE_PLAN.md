# V16.2.3E2.1 — Final Staging Release Preflight

Date: 2026-10-08  
Mode: release preparation  
Deployment: not performed  
Remote migration: not performed

## Final verdict

`STAGING_RELEASE_PREPARED`

The validated release snapshot, staging D1 backup, migration order, exact staging-only commands,
and recovery procedure are prepared. The working tree remains uncommitted by instruction. A future
operator must create a reviewed immutable commit from the intended file set and run the commands in
this document against that same snapshot; this preflight does not authorize deployment.

## Current repository state

| Item | Result |
| --- | --- |
| Branch | `master`, ahead of `origin/master` by 47 commits |
| HEAD | `e502bb4550fd1097fdc69dc1fa30d96c75b6b545` (`V16.2: add island warehouse foundation`) |
| Working tree | 259 entries: 98 modified and 161 untracked |
| Git safety | No reset, stash, clean, commit, push, deployment, or migration apply performed |
| Validated snapshot | Current working tree after V16.2.3E1 fixes; not represented by HEAD |

`HEAD` does not contain migrations 0029–0031 or the aquaculture/Production Rate implementation. The
release must not be built from HEAD alone and must not be assembled by blindly including every dirty
path.

## Intended release changeset

The candidate release is the cumulative V16.2.1–V16.2.3E1 implementation required to reproduce the
validated staging Worker. The reviewed changeset should include these groups:

- `apps/web/**` gameplay client, API client, work-area/worker UI, farm refresh scope, and renderer
  changes used by the validated build;
- `packages/domain/**`, `packages/application/**`, `packages/contracts/**`, and
  `packages/game-data/**` for land, work areas, actors/jobs, cargo, automation, Production Rate,
  Forestry, Mining, Wild Fishery, Aquaculture, Warehouse, and Orchard binding;
- `workers/api/src/**` Worker composition, handlers, D1 repositories, atomic settlement adapters,
  authentication, and staging routing;
- `database/migrations/0019_warehouse_upgrade_marker.sql` through
  `database/migrations/0031_aquaculture_pond_cycle.sql`, preserving the complete local migration
  chain. Migrations 0019–0028 are already recorded remotely but must remain in the repository chain;
  only 0029–0031 are pending remotely;
- the matching focused tests under `tests/**`, including migration support and cost harnesses;
- the V16.2.3 QA and architecture records under `docs/qa/**`, plus the directly relevant deployment,
  performance, and decision documents.

The exact final manifest must be produced during review from this candidate set. Do not stage files
solely because they are dirty, and do not omit a dependency merely because its file is untracked.

## Exclusions and manual review

The following are not release source files:

- local environment files: `.env`, `workers/api/.dev.vars`;
- generated/local state: `.wrangler/**`, `dist/**`, `apps/web/dist/**`, and `node_modules/**`;
- credentials, signed export URLs, Wrangler auth files, and any token-bearing local configuration.

The repository check found only `.env.example` tracked among env-like names. The local
`workers/api/.dev.vars` is ignored and its values were not displayed. No credential or private-key
pattern was found in tracked source. The staging Access domain/audience and D1 identifier are
configuration identifiers, not reproduced here as secrets.

These paths require explicit human review before inclusion or exclusion because they are ambiguous
from a dirty tree alone:

- `docs/design/build-shop-experiments/**`;
- broad visual/art documentation changes such as `docs/HAPPYFARM_ART_BIBLE.md` and older
  `V12_4_*` design notes;
- any client renderer change not required by the current world-resource, Worker/API, or release
  acceptance behavior;
- older QA documents unrelated to the V16.2.3 release record.

Preserve all of these files in the workspace; exclusion here means “do not include without review,”
not “delete.”

## Staging identity and isolation

`workers/api/wrangler.staging.toml` is the only proposed deployment configuration:

- Worker: `happy-farm-staging`;
- entrypoint: `workers/api/src/index.ts`;
- D1 binding: `DB` → `happy-farm-staging`;
- D1 id: `acc598c9-e726-46c8-b1a3-23e5b6a42d52`;
- assets: `apps/web/dist` through `ASSETS`, with SPA fallback;
- guest auth enabled for the public staging alpha, with Cloudflare Access verification also configured.

The local and development configs point to `happy-farm-local` with an all-zero local placeholder id
and use `dev-index.ts` or local SQLite. No production D1 binding exists in the repository. The plain
`workers/api/wrangler.toml` must not be used for staging.

There is no separate Pages deployment in the proposed topology. One Worker serves both static assets
and API requests: the browser uses `/api`, the Worker strips that prefix, and all other paths go to
`ASSETS`.

Read-only live checks passed:

| Request | Result |
| --- | --- |
| Staging custom-domain root | 200 |
| Staging custom-domain `/api/health` | 200 |
| Staging custom-domain protected `/api/shop` without credentials | 401 |
| Staging workers.dev root | 200 |
| Staging workers.dev `/api/health` | 200 |

No live guest session was created during this preflight because `GET /api/session` creates persistent
state. Local auth tests and the live unauthenticated boundary are the evidence; post-deployment
browser acceptance must prove one positive guest or Access-authenticated session.

## Remote migration state

Wrangler read-only migration listing reports exactly:

```text
0029_production_rate_core.sql
0030_wild_fishery_stock.sql
0031_aquaculture_pond_cycle.sql
```

The preflight D1 export contains the remote `d1_migrations` ledger with exactly 0001 through 0028.
Therefore the required apply order is confirmed:

```text
0029 -> 0030 -> 0031
```

No remote migration was applied.

## Staging D1 backup

Backup was prepared using supported Wrangler D1 export tooling:

```text
C:\tmp\happyfarm-staging-preflight\happy-farm-staging-2026-10-08.sql
```

Verification:

- exists and is readable;
- size: 5,040,704 bytes;
- 28 tables detected;
- migration names 0001–0028 detected in the export ledger;
- SHA-256: `B69D2D1D059AF27C9B49A0F960ADEC04260432BF08AC8AB6922E68C81A059B4A`.

The export contains staging data and must be protected as an operational backup. It is outside the
repository, is not part of the release commit, and was not restored or modified.

## Migration compatibility and data risk

- 0029 is additive: it adds the Production Rate execution mode, sources, assignments, and receipts.
- 0030 rebuilds `work_areas` and `actor_jobs` while copying existing rows, adds the `FISHERY` kind,
  and creates wild-fish spot state. This is the highest-risk step and requires the verified backup,
  pre/post row counts, and an immediate post-apply migration listing.
- 0031 is additive: it adds aquaculture pond state, harvest settlement receipts, and atomic triggers.

All three migrations are forward-only. Existing staging data is expected to remain compatible, but a
Worker requiring new tables must not be deployed before all three migrations complete. A Worker
rollback does not roll back D1 schema changes.

## Frontend, Worker, and auth compatibility

`npm run build` passes and `npm run build:worker:staging` passes as a dry-run. The staging dry-run
resolves `DB`, `ASSETS`, Access bindings, guest-auth policy, and the built asset directory. The web
bundle uses same-origin `/api` and `credentials: "same-origin"`, matching the Worker routing and
cookie auth model. `npm run assets:validate` passes for all 27 models.

## Final validation

| Check | Result |
| --- | --- |
| Focused regressions | 15 files, 107 tests passed |
| Production Rate/domain/repository/application | 4 files, 29 tests passed |
| Economic safety | 8 files, 56 tests passed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS; existing non-fatal bundler warnings only |
| `npm run build:worker:staging` | PASS; dry-run only |
| `npm run assets:validate` | PASS; 27 models |
| `git diff --check` | PASS; CRLF normalization warnings only |

## Proposed commands — not executed

Run these only from the reviewed commit that reproduces the validated snapshot. These are the exact
staging-only commands; they were prepared but not run for migration or deployment:

```powershell
npm exec -- wrangler d1 migrations list happy-farm-staging --remote --config workers/api/wrangler.staging.toml

npm exec -- wrangler d1 export happy-farm-staging --remote `
  --config workers/api/wrangler.staging.toml `
  --output C:\tmp\happyfarm-staging-preflight\happy-farm-staging-pre-apply.sql `
  --skip-confirmation

npm exec -- wrangler d1 migrations apply happy-farm-staging --remote --config workers/api/wrangler.staging.toml

npm exec -- wrangler d1 migrations list happy-farm-staging --remote --config workers/api/wrangler.staging.toml

npm run build
npm run build:worker:staging
npm exec -- wrangler deploy --config workers/api/wrangler.staging.toml
```

The apply command must report 0029, then 0030, then 0031. If any step fails, stop; do not rerun
blindly and do not deploy the Worker.

## Recovery procedure

1. Before the window, capture the current active Worker version with
   `npm exec -- wrangler deployments list --config workers/api/wrangler.staging.toml` and retain the
   verified D1 export.
2. If the migration command fails, stop and inspect the D1 migration ledger and export. Do not apply
   a later migration out of order.
3. If the Worker deploy succeeds but runtime behavior fails, inspect logs and route health first. A
   prior Worker version can only be restored if it is compatible with the forward-migrated schema:

   ```powershell
   npm exec -- wrangler versions list --config workers/api/wrangler.staging.toml
   npm exec -- wrangler rollback <compatible-version-id> --config workers/api/wrangler.staging.toml
   ```

4. Do not treat Worker rollback as database rollback. The migrations remain applied. If the prior
   Worker is not schema-compatible, use a new forward-compatible Worker release instead.
5. Restore the D1 export only through a separately approved disaster-recovery procedure. No restore
   command is part of this release plan.

## Remaining risks

- The final release commit has not been created, so the validated dirty workspace must be converted
  into an immutable reviewed snapshot before deployment.
- The dirty tree contains broad historical gameplay and visual changes; an explicit file manifest is
  required to prevent accidental unrelated release content.
- Positive authenticated browser gameplay remains a post-deployment acceptance step because session
  establishment writes a guest identity.
- Migration 0030 performs a table rebuild and deserves operator row-count/constraint verification.
- Build output contains existing non-fatal bundle-size and third-party annotation warnings.

## Final verdict

`STAGING_RELEASE_PREPARED`
