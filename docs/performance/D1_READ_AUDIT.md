# D1 read audit (V14.3.2)

Status: complete. Cloudflare alerted that the account exhausted the D1 Free daily limit of
**5,000,000 rows read/day**. This document records what consumed it, what was fixed, and the budget
the current architecture needs. It is a read-cost audit, not a capacity promise.

## Conclusion in one line

The staging database was the consumer, and 91.8% of the rows were two full-list queries that the
**client's 2-second farm poll** repeated from browser tabs left open on the public staging alpha.
Nothing in the repository, the test suite, or the local development server touched remote D1.

## 1. The databases

| Environment | Config | Binding | Database | Id | Location |
| --- | --- | --- | --- | --- | --- |
| Local dev | `workers/api/wrangler.dev.toml` | `DB` | `happy-farm-local` | `00000000-0000-0000-0000-000000000000` (placeholder) | local `node:sqlite` file, `.wrangler/dev-local.sqlite` |
| Staging | `workers/api/wrangler.staging.toml` | `DB` | `happy-farm-staging` | `acc598c9-e726-46c8-b1a3-23e5b6a42d52` | Cloudflare D1 (APAC) |
| Production | not configured | - | - | - | - |

`workers/api/wrangler.toml` (the plain config) also names `happy-farm-local` with the all-zero id and
is only used by `npm run db:migrate:local` and the default worker build. There is no production
database binding anywhere.

**Affected database: `happy-farm-staging` (`acc598c9-e726-46c8-b1a3-23e5b6a42d52`).**

## 2. Every remote-access path

Only two things can read or write remote D1, and neither is a routine code loop:

1. **The deployed staging Worker.** It binds `DB` to `happy-farm-staging`, so any HTTP traffic that
   reaches `/api/*` resolves an identity and reads the database. This is the actual consumer; the
   rows came from browsers playing the public guest alpha, not from a script.
2. **`scripts/repair/starter-package-backfill.mjs`.** It shells out to
   `wrangler d1 execute happy-farm-staging --remote`, and it refuses any database or config that is
   not staging. It is a one-off operator repair: dry-run by default, `--apply` to write, and it reads
   one small `players`/`starter_grants` anti-join (single-digit rows today).

Documented operator commands (in `docs/deployment/STAGING.md` and `docs/deployment.md`) that can
reach remote D1 are `wrangler d1 migrations list/apply ... --remote` and `wrangler deploy --config
workers/api/wrangler.staging.toml`. Both are manual, deliberate, and were not repeated during this
audit.

### What cannot reach remote D1

| Command | Remote D1? | Why |
| --- | --- | --- |
| `npm test` / `vitest run` | **No** | `tests/support/node-d1.ts` is `node:sqlite` `:memory:`. No wrangler, no network. |
| `npm run dev` | **No** | Vite's middleware loads `workers/api/dev/api-host.ts`, which opens `.wrangler/dev-local.sqlite` with `node:sqlite`. Proven at runtime (see below). |
| `npm run typecheck`, `npm run lint` | **No** | compiler / linter only. |
| `npm run assets:validate`, `npm run build` (web) | **No** | file tooling / Vite bundling. |
| `npm run build:worker:dev`, `build:worker:staging` | **No SQL** | `wrangler deploy --dry-run` bundles locally and prints bindings; it does not execute a query. |
| `npm run db:migrate:local` | **No** | explicitly `--local`. |
| `npm run check:staging-config` | **No** | reads the config text. |

### Runtime proof that local dev is local

Starting a throwaway dev server and hitting `/api/health` prints:

```text
[dev-api] database C:\Project\HappyFarm\.wrangler\dev-local.sqlite
```

The local file holds one farm with **144 tiles** and **381 constructions** - exactly the shape the
staging farms have - and every local plant/harvest/trade/world read resolves through that file.

## 3. D1 analytics findings (read-only)

`npx wrangler d1 info happy-farm-staging` for the affected 24h window:

| Metric | Value |
| --- | --- |
| rows read | **5,829,075** |
| read queries | 91,837 |
| rows written | 13,001 |
| write queries | 3,106 |
| database size | 1.71 MB |
| region | APAC |

`npx wrangler d1 insights happy-farm-staging` ranked the queries by rows read:

| # | Query | Runs | Total rows read | Avg rows read/run |
| --- | --- | --- | --- | --- |
| 1 | `SELECT * FROM farm_constructions WHERE farm_id = ? ORDER BY created_at, id` | 4,105 | **3,128,155** | 762 |
| 2 | `SELECT farm_id, x, y, ... FROM farm_tiles WHERE farm_id = ? ORDER BY y, x` | 8,094 | **2,221,892** | 274 |
| 3 | `SELECT id, player_id, last_seen_at FROM player_identities WHERE kind = 'GUEST' AND ...` | 26,351 | 20,721 | 0.79 |
| 4 | `SELECT ... FROM farm_members WHERE farm_id = ? AND player_id = ?` | 20,079 | 20,079 | 1 |
| 5 | `SELECT ... FROM farms WHERE id = ?` | 20,183 | 20,125 | 1 |

Queries 1 and 2 together are **5,350,047 of 5,829,075 rows (91.8%)**. Everything else - identity,
membership, wallet, inventory, progression, crops, trees - is noise by comparison.

`avgRowsRead` is roughly **2x the row count** for these two queries: an indexed range scan reads the
index entries (144 tiles / 381 constructions) *and* then the table rows for the selected columns
(`SELECT *` for constructions). That is why 144 tiles bill ~274 rows and 381 objects bill ~762.

### Highest-frequency query

`player_identities` (26,351 runs) - one per authenticated request. Cheapest possible: 0.79 rows/run.

### Highest-cost query

`SELECT * FROM farm_constructions ...` - 3.13M rows, 53.7% of the day.

## 4. Polling behaviour

The client had one timer (`apps/web/src/main.ts`), running every **2,000 ms** whenever a farm was
loaded, with no visibility check. Each tick called `refreshFarm()`, which fetched five lists:

```text
GET /farms/:id/tiles          -> 144 tiles            (~274 rows read)
GET /farms/:id/plots          -> the same 144 tiles again (~274)
GET /farms/:id/crops          -> planted crops        (~2 x crops)
GET /farms/:id/trees          -> planted trees        (~2 x trees)
GET /farms/:id/constructions  -> 381 built objects    (~762)
```

About **1,304 rows read per tick** on a farm of the size staging serves. The client already skipped a
render rebuild when the state was unchanged - but that is a *render* optimization; the D1 reads had
already happened. Only eliminating the reads helps the quota.

The observed run counts confirm the shape: the tiles query ran exactly twice per constructions query
(8,094 vs 4,105), which is the `/tiles` + `/plots` pair per tick.

## 5. Explaining the 5,000,000

```text
rows/tick ~= 274 (tiles) + 274 (plots re-read) + 762 (constructions) + crops + trees ~= 1,304
ticks/day observed = 4,105          (constructions query run count)
4,105 x 1,304 ~= 5,353,000 rows      ~= the 5,350,047 rows the two queries actually read
```

4,105 ticks/day is **2.85/minute** averaged over 24 hours. A foreground tab ticks 30/min; a
background tab is throttled by the browser to roughly 1/min. 2.85/min is the blend of a staging tab
that was in the foreground for a small part of the day and backgrounded for the rest - i.e. **one or
two testers leaving the alpha open**, not unusual "real traffic".

Classification: **STAGING_BROWSER_POLLING** (with a full-list-read amplification), not
REMOTE_TEST_TRAFFIC, not a missing index, and not `N+1`.

## 6. Query plans

Measured locally against a representative 144-tile / 381-construction farm:

```text
tiles         SEARCH farm_tiles USING INDEX idx_farm_tiles_farm_id (farm_id=?) | USE TEMP B-TREE FOR ORDER BY
constructions SEARCH farm_constructions USING INDEX idx_farm_constructions_bounds (farm_id=?) | USE TEMP B-TREE FOR ORDER BY
crops         SEARCH crop_instances USING INDEX idx_crop_instances_farm_id (farm_id=?)
trees         SEARCH tree_instances USING INDEX idx_tree_instances_farm_id (farm_id=?)
identity      SEARCH player_identities USING INDEX sqlite_autoindex_player_identities_2 (kind=? AND issuer=? AND subject=?)
membership    SEARCH farm_members USING INDEX sqlite_autoindex_farm_members_1 (farm_id=? AND player_id=?)
```

Every hot query is a **SEARCH**, never a `SCAN`. Hot predicates (`farm_id`, `player_id`,
`owner_player_id`, the identity triple, the idempotency triple) are all index- or primary-key-backed
by `database/migrations/0001`, `0002`, `0005`, `0008`, `0010`, `0011`, `0014`, and `0015`.

**No missing index was found and none was added.** The cost was the *number of rows a correct plan
had to read*, not the plan shape. Adding an index would not have removed the 2x index+table cost of
`SELECT *`; only reading less fixes that.

## 7. Fixes made

Client-only, and deliberately narrow:

1. **The timer refreshes growth only** (`refreshGrowth`: crops + trees). Land, plots and built
   objects change only when the player acts, and every action already calls the full `refreshFarm`,
   so polling them bought nothing.
2. **A hidden tab polls nothing** (`document.visibilityState`). A phone in a pocket or a background
   tab now costs zero rows.
3. **Returning to the foreground refreshes at once**, so a player who comes back sees current state
   without waiting out the timer.
4. **The cadence is 5 s instead of 2 s** (`GROWTH_REFRESH_INTERVAL_MS`), which is still small next to
   the fastest crop (300 s).

The gate is pure and tested: `apps/web/src/polling.ts` (`shouldRefreshGrowth`),
`tests/web/polling.test.ts`.

### Effect

| Scenario | Before (per hour) | After (per hour) |
| --- | --- | --- |
| Hidden tab | ~78,000 rows (throttled) up to 2.35M (foreground) | **0** |
| Visible idle tab | ~2,350,000 rows | **~16,000 rows** |

A visible idle tab now reads 2 identity/farm/membership rows per request plus the crops and trees it
actually has; the two 100-700 row list reads are gone from the timer entirely.

## 8. Cost model

All figures are D1 rows read, using the measured ~2x index+table billing for indexed list reads.

| Activity | Rows read |
| --- | --- |
| Initial load (session + farm + 5 farm lists + 8 account lists) | **~1,400** |
| Visible idle player-hour (growth polls only) | **~16,000** |
| Hidden player-hour | **0** |
| Active player-hour (e.g. 60 actions, each a full refresh + growth polls) | **~100,000** |

Projected daily rows (assume 2 idle-visible hours + 1 active hour per player):

| Players | Daily rows | vs 5,000,000 free |
| --- | --- | --- |
| 10 | ~1.3M | fits |
| 100 | ~13M | over |
| 1,000 | ~130M | far over |
| 10,000 | ~1.3B | far over |

This is an engineering estimate to detect regressions, not a capacity promise. It also shows the next
ceiling: the free plan comfortably serves an invited alpha of a handful of testers, but not hundreds
of concurrently open tabs, regardless of polling.

## 9. Policy and guardrails

```text
LOCAL      normal coding, testing, running the game   -> local sqlite only
STAGING    manual integration verification, only      -> explicit, deliberate, rare
PRODUCTION forbidden during the alpha                 -> not configured
```

- Routine commands stay local; a regression test (`tests/integration/d1-local-isolation.test.ts`)
  fails if any workspace script names `--remote` or `wrangler deploy` without `--dry-run`.
- The only repository script that reads remote D1 is the staging repair, which refuses any other
  database and is a dry run unless `--apply` is passed.
- A browser tab is the cheapest thing to leave open and the most expensive thing to forget: the poll
  now stops itself when the tab is hidden.

## 10. Remaining risks and recommendations

- **Staging is public with no per-IP limit.** Extra guests cost a start-up load each; that is small
  next to polling, but a scripted sign-up loop would still add rows. Consider a rate limit or
  Turnstile before a wider alpha.
- **`/plots` re-reads every tile** to compute the unlocked plot index. It is no longer polled, so it
  is now rare, but a future pass could compute unlock state from a single aggregate.
- **`SELECT *` on `farm_constructions`** reads every column including unused ones; naming the columns
  the client needs would trim the table-row half of that query if it is ever polled again.
- **Watch the free-plan ceiling as testers grow.** The fix removes the runaway; it does not make the
  free plan scale to hundreds of idle tabs. Paid D1, or a cheaper change signal than polling, is the
  next lever if the alpha grows.
- Cloudflare's own D1 metrics (`d1 info`, `d1 insights`) are the fastest way to re-check this budget;
  they are read-only and safe to run.

## 11. V16.2.1A follow-up - the poll was not the second problem

V16.2.1 recorded a fresh baseline of ~4.54M rows-read/day (91% of the Free ceiling) and the intent to
reduce it again before automation. The V16.2.1A audit found the remaining volume was **not** the poll:

- The 5 s timer was already reading only `crop_instances` and `tree_instances`, only while visible.
- The cost was the client's `refreshFarm`, which re-read **all four farm lists** after every action.
  Two of them dominated: full `farm_tiles` (2.13M rows) and full `farm_constructions` (1.77M) - 86%
  of the day. Both used a non-covering `farm_id` index and then sorted, costing two rows-read per
  returned row (measured: 144 tiles = 289, 720 tiles = 1440, 382 objects = 764).

The fix is in `docs/qa/V16_2_1A_D1_READ_OPTIMIZATION.md`: migration
`0021_farm_read_indexes.sql` adds covering, order-matching indexes for the tiles/crops/trees list
reads (halving their rows-read and removing the temp sort), and the client now refreshes only the
lists an action can change - opening a farm reads all four, a harvest reads crops, the timer reads
crops and trees. The "no new continuous system" rule held: no WebSocket, no Durable Object, no cron,
no per-player timer, and no change to the 5 s visible-only poll.

## 12. V16.2.2D1 - one resolver pass is a bounded read set, not a poll

V16.2.2D1 gives Auto a pure resolver (`resolvePass` in `packages/domain/src/work-skill.ts`) and one
read that feeds it (`ResolveAutoPlan` in `packages/application/src/auto.ts`, served by
`GET /farms/:id/auto-plan`). It **plans only**: no planting, harvesting, travel, unload, purchase or
node mutation, and therefore no new write path and no new hot path.

The read set for one pass, and the index each read already uses:

```text
farm + membership                     by primary key (the authorization root)
actors                                by actor id / (owner_player_id, kind) - the Main Character bootstrap
actor_cargo_items                     by actor_id (bounded by the container's own capacity)
wallets                               by (player_id, currency_id)
home_island_warehouses                by player_id - capacity and used in one row
actor_jobs                            by (actor_id, priority, id) - the priority-ordered range read
work_area_cells                       by work_area_id, once per *distinct* area (never per assignment)
crop_instances / tree_instances       by farm_id, covering index from migration 0021
farm_constructions (bounds)           by farm_id
resource_node_states                  by (zone_id, node_id) - the actor's own zone only
inventory_items.find(owner, input)    by (player_id, item_definition_id), one per distinct input needed
```

Catalogues (crops, trees, resources, shops) are game data held in memory and cost no D1 rows. There is
**no** `SELECT` over the world, no `COUNT` over a farm's crops, and no per-crop or per-node query; a
plan for three assignments in three areas of a 144-cell field reads the same number of statements as a
plan for one.

Frequency is the point. The plan runs when the Auto panel is opened and after an Auto action, and
**nowhere else**: no 2 s Auto poll, no frame-loop resolver, no pointer or movement resolver, no cron,
no Durable Object and no per-actor timer. `tests/web/workers-panel.test.ts` fails if `getAutoPlan(`
appears anywhere but the panel's own load, or if a farm load, the growth poll or the account refresh
names the plan - the same source guard the worker and cargo reads already have. A running Auto with the
panel closed writes and reads nothing until the player opens it again.

## 13. V16.2.2D2 - how often the executor runs, and what one step costs

D2 made Auto execute (the replanting crop family: walk, load, plant from cargo, grow, harvest into
cargo, return, unload, replant). The D1 policy above is unchanged and still binds: the resolver is not a
poller, and neither is the executor.

A step is `POST /farms/:id/auto/step`. It costs the D1 plan read set plus:

```text
actor, membership, farm                the authorization root, as on every route
actor_auto_state                       one primary-key row: where the actor is, and any walk
the winning assignment's area cells    one bounded range read
crops / trees / construction bounds    one read each, by farm_id
one settlement, when one happens       the settlement's own batch (its reads and its writes)
```

There is no new index to add: every one of those reads is a point read or a per-area range read that
already had an index from 0021/0022/0023. The writes are the interesting half, and they are all
*transition* writes rather than frame writes:

```text
start a walk       1 guarded upsert of actor_auto_state
finish a walk      1 guarded upsert of actor_auto_state
a settlement       the settlement's own batch, plus (for a plant) one row in actor_auto_state
```

**Cadence** is what keeps the total small. The client asks exactly when the server said there would be
something to do:

```text
after a settlement      when the client's work gesture ends (~0.7 s)
while walking           when the server's arrival time arrives
while waiting to grow   when the soonest crop in the field is ripe (capped at 5 minutes)
waiting for supply/funds/storage/space   not at all - retryAfterMs is 0, and the panel's own actions
                        (a purchase, a manual unload, opening the sheet) are what wake it
hidden tab              nothing: the loop stops while the tab is hidden and resumes on visible
```

Measured on staging for one real cycle (a one-cell carrot field, V16.2.2D2 smoke): 8 steps carried the
actor from an empty field to a harvested and replanted one - `LOAD`, `TRAVELLING`, `PLANT` (13 growth
waits while the crop ripened, re-asked 20 s at a time by the *smoke harness*; the browser sleeps the
whole countdown and would have asked once), `HARVEST`, `TRAVELLING`, `LOAD`, `TRAVELLING`, `PLANT`. No
step read a whole farm list it did not need, and nothing ran between steps.
