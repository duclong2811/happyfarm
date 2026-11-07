# V16.2.1 Cloudflare staging baseline release

Date: 2026-10-04. Verdict: **V16_2_1_STAGING_BASELINE_DEPLOYED**.

This is a release/report record, not a gameplay change. It deploys the current working-tree gameplay
through V16.2.1 to Cloudflare staging, applies the pending migrations and captures a pre-automation
cost/performance baseline. Automation/logistics is design-only and was not implemented here.

## 1. Pre-deploy git state

```text
branch:            master (ahead of origin/master by 47 commits)
HEAD:              e502bb4550fd1097fdc69dc1fa30d96c75b6b545  "V16.2: add island warehouse foundation"
git diff --stat:   76 files changed, 1996 insertions(+), 1125 deletions(-)
modified tracked:  76   (working-tree WIP, none staged)
untracked after cleanup: 23
git diff --check:  clean (Git emitted CRLF line-ending notices only)
```

The tree is intentionally a mixed WIP snapshot; nothing was reset, restored, stashed or rewritten.
Change ownership, as identified from the diff and the untracked set:

- **V14.5.x free natural land** - `packages/domain/src/land.ts`, `packages/application/src/land.ts`,
  `docs/decisions/0029-*`, `docs/decisions/0030-*`, `tests/**/land*`, land routes in
  `workers/api/src/handler.ts`/`d1-repositories.ts`, `apps/web/src/render/terrain.ts`.
- **Build Shop visual WIP** - `apps/web/src/build-shop/**`, `apps/web/src/render/thumbnail*.ts`,
  `docs/design/V12_4_VISUAL_BUILD_SHOP.md`, `tests/web/build-*`.
- **V16.2 Warehouse** - `database/migrations/0018_island_warehouses.sql` (committed at HEAD),
  `packages/{domain,application}/src/warehouse.ts`, `docs/design/WAREHOUSE.md` (committed portion).
- **V16.2.1 Warehouse full QA** - `database/migrations/0019_*`, `0020_*`,
  `packages/application/src/storage.ts`, `workers/api/src/d1-repositories.ts` pinning,
  `docs/qa/V16_2_1_WAREHOUSE_FULL_QA.md`, the extended warehouse/crop/tree/fishing/mining/forestry
  tests, `docs/design/WAREHOUSE.md` (uncommitted portion).
- **V16.2.2 design docs** - `docs/design/AUTOMATION_LOGISTICS.md` (design only, no code).
- **Temporary QA artifacts** - the three root files removed in section 2.

## 2. Temporary artifact cleanup

Re-verified as untracked and unreferenced (a repo-wide `rg` found no reference; `git ls-files`
reported "did not match any file(s) known to git"), then removed exactly:

```text
warehouse-baseline.log        (the earlier sandbox EPERM failure log)
warehouse-full-suite.log      (153 files / 1493 tests passing run)
warehouse-review.diff         (95 KB scratch diff)
```

No other untracked file was touched.

## 3. Local release gates (all passed before deploy)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass, 0 warnings |
| Full suite | `npm test` | **153 files, 1493 tests passed** |
| Assets | `npm run assets:validate` | all 27 models match specs |
| Staging config | `npm run check:staging-config` | no remaining placeholders |
| Web build | `npm run build` (web) | ok; `assets/index-DTgVUv6a.js` (1168 kB / 306.9 kB gzip), `assets/index-DtQeYIi_.css` |
| Worker dry-run (dev) | `npm run build` (api) | ok |
| Worker dry-run (staging) | `npm run build:worker:staging` | ok |
| Diff hygiene | `git diff --check` | clean |

The Vite build reports only the pre-existing large-chunk advisory. Counts match the V16.2.1 baseline.

## 4. Migration audit (0016-0020)

Remote staging was audited before mutation; it was **not** assumed.

- `d1_migrations` on staging listed `0001` - `0015`; `0016` - `0020` were pending.
- No `fishing_actions`, `resource_*`, `home_island_warehouses` tables existed (17 tables total).
- Ordering is repository-defined and correct: 0016 (fishing) -> 0017 (resource nodes) ->
  0018 (warehouse, which also rebuilds `economy_ledger`) -> 0019 (nullable marker column) ->
  0020 (nullable reward-roll columns + immutability triggers).
- Additive/non-destructive: 0016/0017 create new tables + indexes; 0018 creates a new table, a
  per-player backfill row and trigger pairs, and rebuilds `economy_ledger` by copying every row
  (the same proven pattern 0009 and 0010 already applied remotely - no table has a foreign key to
  `economy_ledger`); 0019/0020 add nullable columns only.
- No migration truncates or clamps inventory. The capacity guard refuses only a row that *grows*, so
  a legacy over-capacity player can still read, sell and consume.
- Compatibility with existing saves: pre-migration, the largest per-player inventory total was 36,
  far below the 1000 starter capacity, so the new guard cannot reject existing savings.

## 5. Pre-migration staging baseline (read-only)

```text
players            22
farms              12
inventory_rows     33      inventory_total_qty 459
economy_ledger     79
player_identities  22
tables             17      database_size 3.15 MB
```

## 6. Rollback / backup status

- **Previous live Worker version:** `24b24d4c-35bf-4d0b-9912-9be859c548fd` (deployed 2026-10-02T14:08Z,
  the V14.3 build). `npx wrangler rollback 24b24d4c-... --config workers/api/wrangler.staging.toml`
  restores it, assets included.
- **D1 Time Travel:** available. Pre-migration bookmark
  `00000055-00000000-000050fa-9584f2dab70940a6ec4895fc9a10a7a1`
  (`npx wrangler d1 time-travel restore happy-farm-staging --bookmark=...`).
- **Migrations are forward-only** (project policy): a Worker rollback to a pre-0016 build against a
  migrated database is not a supported state; recover forward with a new migration, not a downgrade.
- **Git:** HEAD + working tree recorded above; nothing committed or pushed, so the deployed source is
  reproducible from this tree.

## 7. Staging bindings / config

`workers/api/wrangler.staging.toml`, confirmed from `build:worker:staging` and the deploy banner:

| Binding | Value |
| --- | --- |
| `env.DB` | D1 `happy-farm-staging` (`acc598c9-e726-46c8-b1a3-23e5b6a42d52`) |
| `env.ASSETS` | `apps/web/dist` (SPA fallback) |
| `env.ACCESS_TEAM_DOMAIN` | `https://dawn-field-0231.cloudflareaccess.com` |
| `env.ACCESS_AUD` | set (Access path preserved, outranks guest) |
| `env.STARTER_GRANT_POLICY` | `ALL_UNRECEIPTED` |
| `env.GUEST_AUTH_ENABLED` | `"true"` (staging only) |

No cron trigger and no Durable Object binding exist. The dev bridge (`dev-index.ts`, `dev-auth.ts`,
`workers/api/dev/**`, `/__dev/bootstrap`) is not in the deployed entrypoint's import graph.

## 8. Migrations applied

Applied with `wrangler d1 migrations apply happy-farm-staging --remote` (staging only):

```text
0016_fishing_actions.sql          applied
0017_resource_nodes.sql           applied
0018_island_warehouses.sql        applied
0019_warehouse_upgrade_marker.sql applied
0020_action_reward_rolls.sql      applied
```

Post-migration verification (read-only):

```text
players            22      farms 12      identities 22
inventory_rows     33      inventory_total_qty 459      (unchanged - no loss)
economy_ledger     79      (unchanged)
home_island_warehouses 22  (capacity min/max 1000, max tier 0)
fishing_actions 0   resource_node_states 0   resource_actions 0
tables             21      database_size 3.24 MB
```

## 9. Deployments

```text
Worker:           happy-farm-staging
New version:      879a109b-abea-4e81-9fe8-ceceb7871eed
Assets:           25 files uploaded (57 unchanged); JS index-DTgVUv6a.js, CSS index-DtQeYIi_.css
Worker startup:   49 ms
Canonical URL:    https://happyfarm-staging.longfx.trade/
Alt hostname:     https://happy-farm-staging.duclong-reg.workers.dev
```

Web and Worker ship together (one Worker serving `[assets]`), so there is no separate web deployment
id and no client/Worker cache skew: the shell that is served references the bundle of this version.

## 10. Remote smoke tests (AUTOMATED REMOTE VERIFIED)

```text
GET  /                        200   shell; index.html references index-DTgVUv6a.js + index-DtQeYIi_.css
GET  /play                    200   SPA fallback
GET  /api/health              200
GET  /api/nope                404   JSON 404, never the SPA shell
GET  /api/session (no cookie) 200   sets hf_guest; {"kind":"GUEST"}
GET  /api/session (same jar)  200   same playerId on repeat
GET  /api/shop (no cookie)    401   NOT_AUTHENTICATED
GET  /__dev/bootstrap         200   the SPA shell (static fallback), not a dev endpoint
GET  /api/__dev/bootstrap     404   JSON 404 - no dev API route
POST /api/farms (evil Origin) 401   origin guard refuses the cross-origin unsafe request
```

Cookie flags on `/api/session`:

```text
Set-Cookie: hf_guest=...; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax
```

Authenticated reads (guest cookie), all `200`: `/api/shop`, `/api/warehouse`, `/api/wallet`,
`/api/inventory`, `/api/progression`, `/api/crop-definitions`, `/api/tree-definitions`, `/api/fishing`,
`/api/resource-nodes`, `/api/build-catalog`, `/api/world-objects`.

Gameplay loop on a dedicated fresh guest (`player_89d28ba6-...`, `farm_6c1cb23f-...`), distinct from
any existing player:

```text
farm bootstrap   POST /api/farms 201; GET /api/farms/:id 200; 144 tiles; 0 crops/trees
shop BUY         2x carrot seed: gold 100 -> 96, seeds 10 -> 12
plant            POST /api/farms/:id/crops (crop_carrot, x=9,y=26 natural land) 201 (no land purchase)
growth           server clock: mature=false -> mature=true after 300 s
harvest          +2 item_carrot, +4 XP (level 1, xp 4); wallet unchanged
warehouse        tier 0, capacity 1000, used 13 (11 seeds + 2 carrots)
```

The immature-harvest guard was also exercised first: harvest at `growthProgress 0.003` returned `409`.
No unknown player's save was touched. Fishing / mining / forestry command bodies and production-tree
harvests were **not** driven remotely.

## 11. Polling audit

Unchanged from V14.3.2 and confirmed in `apps/web/src/polling.ts` + `apps/web/src/main.ts`:

- Interval `GROWTH_REFRESH_INTERVAL_MS = 5000`.
- Gate `shouldRefreshGrowth` = farm loaded AND tab visible AND no tick in flight.
- `refreshGrowth` reads only `GET /farms/:id/crops` and `GET /farms/:id/trees`; every other change is
  action-driven.

An idle, visible player therefore fires two endpoints every 5 s (24 requests/min): crops + trees.
A hidden tab fires nothing. No polling was changed in this release.

## 12. Cloudflare baseline metrics (pre-automation)

`wrangler d1 info happy-farm-staging`:

```text
               before migration     after deploy
read_queries_24h      54,857           53,352
write_queries_24h      3,195            3,377
rows_read_24h      4,638,655        4,540,668     <-- ~91% of the 5M Free read limit
rows_written_24h      11,507           12,563
database_size         3.15 MB          3.24 MB
region                APAC (ICN)
```

`wrangler d1 insights` (top queries) attributes most rows-read to full-list reads still in flight:
`SELECT ... FROM farm_tiles WHERE farm_id = ?` (avg 551 rows, x3847) plus per-request identity/farm/
membership lookups (1 row each). **This is the load-bearing pre-automation warning:** staging is
already near the D1 Free 5M rows-read/day ceiling on ordinary alpha traffic. Historical Worker
requests/errors/CPU are not exposed by the CLI from this environment; measure them in the Cloudflare
dashboard (see below) and re-check with `npx wrangler d1 info` / `d1 insights`.

## 13. Free-tier load-test plan (prepared, NOT run)

Ladder to run only after the alpha capacity gate exists: **5, 10, 20, 40, 60, 80** active players.
Per stage capture: requests/min, D1 rows-read/min, rows-written/min, Worker CPU, p50/p95 latency,
error rate, 429/5xx, D1 contention/conflicts - then derive requests/player/hour,
rows-read/player/hour, rows-written/player/hour. 80-player safety must not be assumed until measured.

Observation procedure for the tester (Cloudflare dashboard, read-only):

- Workers & Pages -> `happy-farm-staging` -> Metrics: Requests, Errors, CPU time.
- D1 -> `happy-farm-staging`: rows read/written, queries, latency, size (`d1 info` / `d1 insights`).
- Zero Trust -> Access: confirm the custom-domain gate state for each hostname.

### Alpha capacity gate (design note only - not implemented)

The future ~80-player free-tier gate is **not built here**. Its intended shape, for the release that
precedes public load testing: a server-configured active-session limit; lease-based activity where a
session counts as active only while it is being used; inactivity expiry; **no high-frequency
heartbeat** (reuse the existing 5 s visible-only growth poll as the activity signal rather than adding
a new timer); a clear "server full" response to a new session past the limit; an online count; and
admin observability of the active set. This belongs with the automation work, not the baseline.

## 14. Manual QA remaining (REQUIRES HUMAN BROWSER QA)

Desktop: open `https://happyfarm-staging.longfx.trade/`; guest enters with no login; existing/new farm
loads; Character View movement; Estate View camera; plant on natural grass far from the starter area;
confirm **no Land Mode**; harvest; Inventory; Warehouse; Market buy/sell; fishing; mining; forestry;
Build Shop only if the tester is comfortable with the current WIP.

Mobile: open the canonical URL; guest persists after refresh; portrait layout; joystick; Run; camera
gesture; pinch zoom; Estate interaction; plant/harvest; Inventory/Warehouse; Market.

Automated tests above prove API/DB behavior, not rendering, touch input, or camera feel. No browser
session was available to this release run; none of the manual items are claimed as passing.

## 15. Explicit answers

| Question | Answer |
| --- | --- |
| Was production DB modified? | NO |
| Was production deployed? | NO |
| Was staging DB migrated? | YES |
| Was migration 0020 applied to staging? | YES |
| Is canonical staging reachable? | YES |
| Does guest session work remotely? | YES |
| Does Warehouse work remotely? | YES |
| Is natural Home Island land still free? | YES (planted at tile 9,26 with no purchase) |
| Was Land Mode restored? | NO |
| Was Automation implemented? | NO |
| Was any global cron added? | NO |
| Was 80-player safety assumed? | NO |
| Were pre-automation Cloudflare metrics established? | YES (baseline recorded; dashboard metrics pending human capture) |

Final verdict: **V16_2_1_STAGING_BASELINE_DEPLOYED**.
