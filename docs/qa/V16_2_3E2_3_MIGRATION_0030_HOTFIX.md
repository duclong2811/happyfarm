# V16.2.3E2.3 — Migration 0030 Foreign-Key Hotfix

Date: 2026-10-09  
Mode: targeted migration hotfix and local validation  
Remote migration/deployment: not performed after the hotfix

## Verdict

`MIGRATION_0030_HOTFIX_READY`

The corrected unapplied migration succeeds against a non-empty local D1 database representing the
schema through 0029. It preserves persisted work areas, actor jobs, their dependent rows, inventory,
constructions, indexes, and foreign-key integrity, and 0031 applies successfully afterward.

The staging release remains paused. This report does not authorize or perform a remote migration or
deployment.

## Original failure

The first staging release attempt applied 0029 successfully. Migration 0030 then failed and rolled
back with a SQLite foreign-key constraint error while rebuilding `work_areas`.

Staging after the failure remained healthy:

- remote migration ledger ended at 0029;
- players 49, farms 35, work areas 12, actors 12, actor jobs 10;
- inventory rows 63 and constructions 3,049;
- `PRAGMA foreign_key_check` returned zero rows;
- no Worker deployment occurred.

## Actual dependency graph

The migration originally rebuilt `work_areas` and `actor_jobs` but left their existing children
pointing at the old table names:

```text
work_area_cells                  -> work_areas
actor_jobs                       -> work_areas
auto_funding_items               -> actor_jobs
production_assignments           -> actor_jobs, work_areas
production_settlement_receipts  -> production_assignments
```

The existing `actor_jobs.work_area_id` foreign key uses `ON DELETE RESTRICT`. Dropping
`work_areas` while the old `actor_jobs` table still existed therefore failed. The graph inspection
found no other tables referencing either rebuilt parent.

## Corrected migration strategy

`database/migrations/0030_wild_fishery_stock.sql` now:

1. keeps foreign-key enforcement enabled;
2. creates replacement versions of both parents and every dependent table;
3. copies all rows and columns into the replacement graph;
4. drops old tables from leaves upward;
5. renames replacements back to the original names;
6. recreates the existing indexes;
7. creates `fishing_spot_states` and its index.

The change is necessary because SQLite cannot add `FISHERY` to the existing `CHECK` vocabularies
with `ALTER TABLE ... ADD COLUMN`. The migration does not use a foreign-key-disable workaround.

## Local realistic dataset

The new test builds every migration through 0029 in an in-memory `NodeD1Database`, then seeds:

- one player, farm, owner membership, and warehouse-backed inventory row;
- one persisted work area and membership cell;
- one actor and an actor job whose `work_area_id` references that work area;
- one auto-funding item;
- one finite Production Source and Production Assignment referencing the job and work area;
- one Production settlement receipt;
- one stored fish-cage construction.

No staging export or real player data was uploaded or used in the local test.

## Local migration results

`tests/integration/wild-fishery-migration.test.ts`:

- corrected 0030 succeeds: PASS;
- all seeded rows remain present and ownership/version fields remain unchanged: PASS;
- no temporary rebuild tables remain: PASS;
- all rebuilt table columns match the pre-migration schema: PASS;
- all existing indexes remain present: PASS;
- child foreign keys resolve to the restored table names: PASS;
- `PRAGMA foreign_key_check`: zero violations;
- fishing spot table and index exist: PASS;
- existing trigger inventory is preserved: PASS;
- existing stored construction remains intact: PASS.

The same local database then applies the existing 0031 migration:

- aquaculture tables: PASS;
- aquaculture validation/apply triggers: PASS;
- previously persisted construction data: PASS;
- `PRAGMA foreign_key_check`: zero violations.

## Regression results

Focused requested set: 14 files, 69 tests passed.

Covered fishery HTTP/D1 behavior, fishing stock, Work Area behavior, migration tests,
Forestry/Mining, Apple Orchard, Aquaculture, and Production Rate domain/repository/settlement
regressions.

An additional `tests/api/actor-job-loop.test.ts` run had 9 failures because its fixture intentionally
stops at migration 0023 while the current handler selects the `execution_mode` column introduced by
0029. This is an existing fixture/schema mismatch outside this migration hotfix; no assertion or
economic behavior was weakened or changed.

## Static validation

- `npm run lint`: PASS;
- `npm run typecheck`: PASS;
- `npm run build`: PASS, with existing non-fatal Rollup/Zod annotation and bundle-size warnings;
- `git diff --check`: PASS, with existing CRLF normalization warnings.

## Backup checksum verification

Both preserved exports were recalculated directly without modification:

| Backup | Size | SHA-256 |
| --- | ---: | --- |
| `C:\tmp\happyfarm-staging-preflight\happy-farm-staging-2026-10-08.sql` | 5,040,704 bytes | `B69D2B1D059AF27C9B49A0F960ADEC04260432BF08AC8AB6922E68C81A059B4A` |
| `C:\tmp\happyfarm-staging-preflight\happy-farm-staging-2026-10-09-pre-0029.sql` | 5,040,704 bytes | `B69D2B1D059AF27C9B49A0F960ADEC04260432BF08AC8AB6922E68C81A059B4A` |

The reported checksum discrepancy is not reproducible. The files are currently byte-identical at
the reported size. Neither backup was overwritten, restored, or uploaded.

## Remaining staging release steps

After a separate release approval using this corrected source snapshot:

1. take a fresh pre-0030 backup;
2. apply corrected 0030 to `happy-farm-staging` and verify ledger, row counts, indexes, constraints,
   and `PRAGMA foreign_key_check`;
3. apply 0031 and verify aquaculture schema and integrity;
4. run the staging Worker dry-run against the approved build;
5. deploy only `workers/api/wrangler.staging.toml`;
6. run health, frontend, API, and authenticated gameplay acceptance with an existing authorized
   staging account;
7. record the Worker version and all migration/smoke results.

Do not apply 0030 or 0031 to staging from the old release snapshot. Do not restore automatically,
deploy production, commit, push, reset, stash, or clean the working tree.

## Security and integrity notes

The change is limited to migration schema preservation and its deterministic local proof. No auth,
authorization, inventory mutation, economy settlement, client authority, secret, token, or remote
staging data was added to source or logs. The migration keeps server/database constraints active and
preserves the existing ownership and foreign-key boundaries.
