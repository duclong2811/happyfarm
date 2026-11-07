# V16.2.3E2 — Staging Release Execution

Date: 2026-10-11  
Scope: approved staging migrations 0030, 0031, and staging deployment  
Production: not touched

## Verdict

`STAGING_DEPLOYED_ACCEPTED`

Migrations 0030 and 0031 were applied and verified on staging. The approved Worker/frontend source
was deployed only to `happy-farm-staging` and passed the public smoke checks. No authenticated
gameplay test was run because no authorized staging test account was available.

## Approval and migration identity

- User approval: explicitly received in-chat before the remote backup and migration write.
- Target Worker: `happy-farm-staging`
- Target D1: `happy-farm-staging`
- D1 ID: `acc598c9-e726-46c8-b1a3-23e5b6a42d52`
- Migration: `database/migrations/0030_wild_fishery_stock.sql`
- Size: 7,671 bytes / 144 lines
- SHA-256: `A44B12E03ED3DA53434D90ACD4A689B3D7E728E8A057A05F33D410E0A8B9154C`
- Migration: `database/migrations/0031_aquaculture_pond_cycle.sql`
- Size: 4,390 bytes / 99 lines
- SHA-256: `4CB7BF5F4E8FAD63F4588EBE2185F960057345EC4C373E96ABB5920E45FFDAB1`

The corrected migration was applied through a temporary migration pattern that matched 0030 and
excluded 0031. The temporary operator config was removed after use; the checked-in staging config
was not changed.

## Backup

New backup created before the migration:

- Path: `C:\tmp\happyfarm-staging-preflight\happy-farm-staging-2026-10-11-pre-0030.sql`
- Size: 5,161,651 bytes
- SHA-256: `8D1D8C16AB8921D5DCED8471694ED45A8F08386EF6F4B61A7D58791FF8A9EB03`
- Export ledger: 0001 through 0029, ending at `0029_production_rate_core.sql`

Previous backups were preserved and verified unchanged:

- `happy-farm-staging-2026-10-08.sql` — 5,040,704 bytes — `B69D2B1D059AF27C9B49A0F960ADEC04260432BF08AC8AB6922E68C81A059B4A`
- `happy-farm-staging-2026-10-09-pre-0029.sql` — 5,040,704 bytes — `B69D2B1D059AF27C9B49A0F960ADEC04260432BF08AC8AB6922E68C81A059B4A`

Fresh pre-0031 backup:

- Path: `C:\tmp\happyfarm-staging-preflight\happy-farm-staging-2026-10-11-pre-0031.sql`
- Size: 5,162,344 bytes
- SHA-256: `BC48D380478C59819E821E8B93201726948CFEE472F729D5801F086FE013F2E4`
- Export ledger ended at `0030_wild_fishery_stock.sql`

## Applied migration

Only the pending migrations were applied, in order. The remote ledger now ends with:

```text
0029_production_rate_core.sql
0030_wild_fishery_stock.sql
0031_aquaculture_pond_cycle.sql
```

0030 was applied at `2026-10-11 11:56:23` and 0031 at `2026-10-11 12:01:04` in the Cloudflare
ledger. No restore, production change, commit, push, reset, stash, or clean was performed.

## Data verification

The following counts were read from the fresh backup and the remote database after 0030. All
existing counts matched exactly.

| Table | Pre-0030 | Post-0030 |
| --- | ---: | ---: |
| players | 49 | 49 |
| farms | 35 | 35 |
| farm_members | 35 | 35 |
| work_areas | 12 | 12 |
| work_area_cells | 283 | 283 |
| actors | 12 | 12 |
| actor_jobs | 10 | 10 |
| auto_funding_items | 5 | 5 |
| production_assignments | 0 | 0 |
| production_settlement_receipts | 0 | 0 |
| inventory_items | 62 | 62 |
| farm_constructions | 3,049 | 3,049 |
| production_sources | 0 | 0 |
| fishing_spot_states | table absent | 0 rows; table exists |

## Schema and integrity verification

- `PRAGMA foreign_key_check`: zero violations.
- Rebuilt foreign keys resolve to `work_areas`, `actor_jobs`, and `production_assignments`, not
  temporary rebuild names.
- No temporary `v16_2_3d3a` tables remain.
- `work_areas`, `actor_jobs`, `work_area_cells`, `auto_funding_items`,
  `production_assignments`, and `production_settlement_receipts` remain present.
- `fishing_spot_states` and `idx_fishing_spot_states_zone` exist.
- Expected rebuilt indexes exist: `idx_work_areas_farm`, `idx_work_areas_zone`,
  `idx_work_area_cells_area_yx`, `idx_actor_jobs_actor_priority`, `idx_actor_jobs_work_area`,
  `idx_auto_funding_items_job`, `idx_production_assignments_actor_source`,
  `idx_production_assignments_actor_job`, and `idx_production_assignments_farm`.
- Existing trigger inventory remains present, including `warehouse_capacity_guard_insert` and
  `warehouse_capacity_guard_update`; no 0030 trigger was expected or added.
After 0031, the following were verified:

- `aquaculture_pond_states` and `aquaculture_harvest_settlements` exist.
- `idx_aquaculture_pond_states_farm_id` and `idx_aquaculture_harvest_settlements_farm_id` exist.
- `aquaculture_harvest_validate` and `aquaculture_harvest_apply` exist.
- `PRAGMA foreign_key_check`: zero violations.
- Aquaculture row counts are zero on the empty pre-existing staging state.
- Aquaculture foreign keys resolve to `farms`, `farm_constructions`, and `players` as expected.
- Production Rate counts remain unchanged: `production_sources=0`,
  `production_assignments=0`, `production_settlement_receipts=0`.

0031 critical pre/post counts:

| Table | Pre-0031 | Post-0031 |
| --- | ---: | ---: |
| players | 49 | 49 |
| farms | 35 | 35 |
| farm_members | 35 | 35 |
| work_areas | 12 | 12 |
| work_area_cells | 283 | 283 |
| actors | 12 | 12 |
| actor_jobs | 10 | 10 |
| auto_funding_items | 5 | 5 |
| production_sources | 0 | 0 |
| production_assignments | 0 | 0 |
| production_settlement_receipts | 0 | 0 |
| inventory_items | 62 | 62 |
| farm_constructions | 3,049 | 3,049 |
| aquaculture_pond_states | table absent | 0 |
| aquaculture_harvest_settlements | table absent | 0 |

## Deployment

- Source manifest files: 309
- Dirty-worktree release manifest SHA-256:
  `CB7A34C2174674F8FF6A78B17369634D9AB994BE486FCD631D0CAF4111D67858`
- Staging dry-run: passed; D1, ASSETS, Access, guest-auth, and staging variables resolved.
- Worker: `happy-farm-staging`
- Wrangler config: `workers/api/wrangler.staging.toml`
- Deployment ID: `1b735473-53e9-4005-b833-75e771c0f5a6`
- Deployment URL: `https://happy-farm-staging.duclong-reg.workers.dev`
- Deployed source was the unchanged approved release manifest; only the QA report was added to the
  dirty tree after the prior migration checkpoint and it was not part of the Worker bundle.

## Public smoke tests

Canonical host: `https://happyfarm-staging.longfx.trade`

- Site root: HTTP 200; HTML served.
- Hashed JavaScript asset `/assets/index-qgpH-txY.js`: HTTP 200; JavaScript served.
- `/api/health`: HTTP 200; response `{"ok":true,"data":{"status":"ok"}}`.
- Same-origin API routing: passed through `/api/health` on the deployed host.
- Protected `/api/shop` without credentials: HTTP 401, stable `NOT_AUTHENTICATED` error.
- D1 connectivity: remote post-migration queries succeeded against the configured staging D1; the
  deployed dry-run confirmed the Worker `DB` binding points to the same D1 ID.
- No `/api/session` call was made, so no anonymous guest identity or player state was created.

## Release scope

The intended release source remains the reviewed V16.2.3 candidate under `apps/web/**`,
`packages/{application,contracts,domain,game-data}/**`, `workers/api/src/**`, staging config, and
migrations 0019–0031. Unrelated art/build-shop documentation, local environment files, generated
output, node modules, and production configuration are excluded from release consideration. The
staging deployment used only the verified staging Wrangler configuration.

## Tests and remaining work

- Local corrected 0030→0031 migration regression: 2/2 passed.
- Focused release regressions: 14 files, 53 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; existing non-fatal Zod annotation and bundle-size warnings only.
- `git diff --check`: passed; existing CRLF normalization warnings only.
- `npm run build:worker:staging`: passed as a staging dry-run.
- Local staging config check: passed.
- Known unrelated fixture issue: `tests/api/actor-job-loop.test.ts` has 9 failures when its
  intentionally pre-0029 fixture is used with the current handler; this is outside the migration
  hotfix and was not changed.
- Authenticated Farm/Warehouse/game-state verification was not executed because no authorized
  staging test account was available. Anonymous HTTP success was not treated as authentication.
- Remaining issue: the known fixture mismatch and the absence of an authorized authenticated
  gameplay account for full browser acceptance.
