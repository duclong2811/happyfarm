# V16.2.1A - D1 read optimization

Date: 2026-10-04. Verdict: **V16_2_1A_D1_READ_OPTIMIZATION_DEPLOYED**.

This reduces the staging database's rows-read before the automation/logistics work, without changing
any gameplay rule, and confirms the growth poll was already the narrow one. Automation is still
design-only and was not implemented.

## 1. Exact root cause

The V16.2.1 baseline read ~4.54M rows/day against the 5M Free ceiling. Insights and the query plans
show it was **not** the 5-second poll. It was the client's `refreshFarm`, which re-read **all four
farm lists** (`tiles`, `crops`, `trees`, `constructions`) after every farm action - including actions
that can change only one of them:

- Two of those reads are whole-farm scans of the two biggest tables: the full `farm_tiles` list
  (**2,128,608 rows** in the window) and the full `farm_constructions` list (**1,772,309 rows**).
  Together, **86%** of the day's rows-read.
- Both ran a **non-covering `farm_id` index for the `WHERE`, then sorted the whole result** in a
  TEMP B-TREE. Measured on staging, a non-covering farm-scoped list read costs **two rows-read per
  returned row** - one index entry plus one table fetch. 144 tiles = 289 rows-read; 720 tiles = 1440;
  382 constructions = 764.

The 5-second growth timer was already correct: it reads `crop_instances` and `tree_instances` only,
only while the tab is visible, and never `farm_tiles` or `farm_constructions`. The premise that idle
gameplay re-reads all tiles every 5 s is **false in the current build** (and was false before this
change).

## 2. Hot endpoints

| Endpoint | Service | Repository | SQL | Tables | Rows returned |
| --- | --- | --- | --- | --- | --- |
| `GET /farms/:id/tiles` | `ListFarmTiles` | `D1FarmTileRepository.listByFarm` | farm tiles list | `farm_tiles` | one farm's tiles |
| `GET /farms/:id/constructions` | `ListFarmConstructions` | `D1ConstructionRepository.listByFarm` | `SELECT *` constructions | `farm_constructions` | one farm's objects |
| `GET /farms/:id/crops` | `GetFarmCrops` | `D1CropRepository.listByFarm` | crops list | `crop_instances` | one farm's crops |
| `GET /farms/:id/trees` | `ListFarmTrees` | `D1TreeRepository.listByFarm` | trees list | `tree_instances` | one farm's trees |
| `GET /session`, every `/api/*` | authenticator, authorization | player/identity/farm/member lookups | 1 row each | `player_identities`, `farms`, `farm_members` | 1 |

The first four are all reached by `refreshFarm`; the last three are per-request fixed overhead (one
row each) and are not the problem.

## 3. Hot SQL

```sql
SELECT farm_id, x, y, terrain_type, tile_state, version, updated_at
  FROM farm_tiles WHERE farm_id = ? ORDER BY y, x;

SELECT * FROM farm_constructions WHERE farm_id = ? ORDER BY created_at, id;
```

## 4. Query plans - before

```text
SEARCH farm_tiles USING INDEX idx_farm_tiles_farm_id (farm_id=?)
USE TEMP B-TREE FOR ORDER BY

SEARCH farm_constructions USING INDEX idx_farm_constructions_bounds (farm_id=?)
USE TEMP B-TREE FOR ORDER BY

SEARCH crop_instances USING INDEX idx_crop_instances_farm_id (farm_id=?)
USE TEMP B-TREE FOR ORDER BY

SEARCH tree_instances USING INDEX idx_tree_instances_farm_id (farm_id=?)
USE TEMP B-TREE FOR ORDER BY
```

## 5. Rows-read behavior - before (measured on staging)

```text
farm_tiles  (144-tile farm)         rows_read 289    144 returned
farm_tiles  (720-tile farm)         rows_read 1440   720 returned
farm_constructions (382 objects)    rows_read 764    382 returned
```

2x per returned row, plus a temp sort. Insights over the window: `farm_tiles` 2,128,608 rows /
3,851 calls; `farm_constructions` 1,772,309 / 2,325; then only single-row lookups.

## 6. Fix chosen

Two narrow changes, one on each side of the wire:

1. **Server (migration 0021)** - make the three farm-scoped list reads index-only and ordered: a
   covering index per list that matches the query's own `ORDER BY`. One rows-read per returned row,
   no temp sort.
2. **Client (`farm-refresh.ts` + `main.ts`)** - a refresh names the lists it needs. An action reads
   only the lists it can change; the growth timer reads crops and trees only; only opening a farm or
   pressing Refresh reads all four.

## 7. Why over the alternatives

- **A dedicated `/farm/growth` endpoint** would merge two small polls into one request but remove no
  farm-list rows - the poll was never the rows-read source. Not worth a contract change.
- **Removing the poll (Option B: timestamp snapshot + client interpolation)** was analysed. It would
  cut the timer's two small reads and one request, but it does not touch the 86% that is action-driven
  and it adds stale-state risk for maturity. The poll is kept: 5 s, visible-only, no overlap.
- **Raising the poll interval** masks nothing here, per the brief; it was not done.
- **Widening the reads** (e.g. a per-action combined response) would change contracts and server
  response shapes. A scope flag and an index change less and are provably safe.

## 8. Indexes added / changed

Added (covering, ordered - see `0021_farm_read_indexes.sql`):

```sql
CREATE INDEX idx_farm_tiles_farm_yx
  ON farm_tiles(farm_id, y, x, terrain_type, tile_state, version, updated_at);
CREATE INDEX idx_crop_instances_farm_yx
  ON crop_instances(farm_id, tile_y, tile_x, id, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at);
CREATE INDEX idx_tree_instances_farm_yx
  ON tree_instances(farm_id, tile_y, tile_x, id, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at);
```

Removed (strictly redundant - each new index has `farm_id` as its leading column):

```sql
DROP INDEX IF EXISTS idx_farm_tiles_farm_id;
DROP INDEX IF EXISTS idx_crop_instances_farm_id;
DROP INDEX IF EXISTS idx_tree_instances_farm_id;
```

Tradeoff: a covering index duplicates its table's columns for the rows a row owns, so it adds storage
and a small write cost on insert. The reads stay one farm's rows, so the files stay small, and dropping
the single-column indexes keeps the write cost from stacking. `farm_constructions` was **not** given
an index: its rows are only read on farm open / Refresh after the client fix, and its `SELECT *`
would need a near-copy of the table to be covered.

## 9. Migrations added / applied

`0021_farm_read_indexes.sql`, additive and staging-safe (indexes carry no player data). Applied to
**staging only**: 7 commands, success. Production was not touched. Remote is now `0001` - `0021`.

## 10. Client polling behavior - before / after

```text
before: 5 s tick, visible only, no overlap  ->  GET /farms/:id/crops + GET /farms/:id/trees
after:  5 s tick, visible only, no overlap  ->  GET /farms/:id/crops + GET /farms/:id/trees
```

Unchanged by design: the timer was already correct. What changed is how many rows those two reads
return (index-only, see below) and that the timer now routes through the same scoped refresh as
everything else (`GROWTH_REFRESH`), so a future edit cannot quietly widen it.

## 11. Client rendering behavior - before / after

Unchanged. A refresh re-reads only the lists in its scope and calls `refreshScene` exactly as before;
`refreshScene` still reprojects only when the farm's `farmPresentationSignature` changed, so a poll
that returns identical growth still rebuilds nothing (pinned by `farm-refresh-signature.test.ts`).
The scoping removes reads, not rendering work.

## 12. Correctness tests

- New `tests/web/farm-refresh-scope.test.ts` (10 tests): the growth scope reads crops+trees only;
  no action scope reads the built objects; only the two plant actions re-read tiles; a crop action
  never reads trees and vice versa; at most two lists per action vs four before; full scope reads all
  four; and source tests that `main.ts` reads each list in exactly one place (inside the scoped
  refresh), that `refreshGrowth` goes through `GROWTH_REFRESH`, and that all six action sites pass a
  scope.
- Existing `tests/web/polling.test.ts`: hidden tab reads nothing, no overlapping tick, cadence bounds.
- Existing `tests/web/farm-refresh-signature.test.ts`: unchanged growth does not rebuild the world.
- Existing maturity, harvest, free-land and warehouse coverage is unchanged and still green.

## 13. Performance evidence (local plan + staging rows-read, before/after)

Local SQLite plan (same schema, 144 rows):

```text
BEFORE: SEARCH farm_tiles USING INDEX idx_farm_tiles_farm_id (farm_id=?) | USE TEMP B-TREE FOR ORDER BY
AFTER:  SEARCH farm_tiles USING COVERING INDEX idx_farm_tiles_farm_yx (farm_id=?)
```

Staging, after migration:

```text
PLAN tiles: SEARCH farm_tiles USING COVERING INDEX idx_farm_tiles_farm_yx (farm_id=?)
PLAN crops: SEARCH crop_instances USING COVERING INDEX idx_crop_instances_farm_yx (farm_id=?)
PLAN trees: SEARCH tree_instances USING COVERING INDEX idx_tree_instances_farm_yx (farm_id=?)

                                        before   after
farm_tiles  (144-tile farm) rows_read      289     145
farm_tiles  (720-tile farm) rows_read     1440     720
farm_constructions (382) rows_read         764     764   (unchanged - covered by the client fix)
```

Request pattern for an idle visible player is unchanged at 2 requests / 5 s; the rows each returns are
now half for tiles and (for crops/trees) index-only.

## 14. Gate results

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         154 files, 1503 tests passed   (was 153 / 1493)
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27 models
git diff --check              clean
```

## 15. Staging deployment ID

```text
Worker:      happy-farm-staging
Version ID:  2bdb11b4-e26c-44f4-acb6-c0152f01ffd1
Bundle:      assets/index-DZFtkQIg.js
Rollback:    previous live version 879a109b-abea-4e81-9fe8-ceceb7871eed
```

## 16. Deployment timestamp

**2026-10-04T03:20:23Z** (`version 2bdb11b4-...`, created 2026-10-04T03:20:23.128Z). The D1
measurement window should start from this deploy, not from a rolling 24 h graph.

## 17. Remote smoke result

```text
GET  /                        200   serves the new bundle (index-DZFtkQIg.js)
GET  /api/session             200   guest cookie, kind GUEST
POST /api/farms               201   farm created
GET  /api/farms/:id/tiles     200   144 tiles
POST /api/shop/buy            200   carrot seeds bought
POST /api/farms/:id/crops     201   planted carrot on natural land at (9,26) - no land purchase
GET  /api/farms/:id/crops     200   1 crop, immature
GET  /api/warehouse           200   starter tier, capacity 1000
```

Growth and harvest on the same guest (server-authoritative, 300 s crop) are recorded in the deploy
run; the harvest endpoint code is unchanged by this task.

## 18. Expected D1 reduction

- `farm_tiles` list reads halve (2x -> 1x per row): the day's single largest query drops from ~2.13M
  to ~1.06M rows.
- `farm_constructions` list reads stop happening on farming actions (they now happen only when a farm
  is opened or Refresh is pressed): ~1.77M rows mostly removed.
- `crop_instances` / `tree_instances` (the growth tick) go index-only.

Order of magnitude, the two dominant queries fall from ~86% of the day to a small fraction, taking the
database well under the 5M Free ceiling. This must be confirmed by a clean post-deploy window; it is
not claimed from a mixed rolling graph.

## 19. What must still be measured in the Cloudflare dashboard

Record the deploy timestamp, then read `npx wrangler d1 info happy-farm-staging` and
`npx wrangler d1 insights` over a **window that starts after the deploy** (old 24 h vs new window
matter). Capture requests/min, rows-read/min, rows-written/min, Worker CPU, p50/p95, errors, 429/5xx.
The old baseline to beat is ~4.54M rows / 24 h.

## 20. Files changed

```text
database/migrations/0021_farm_read_indexes.sql          new
apps/web/src/farm-refresh.ts                            new
apps/web/src/main.ts                                    scoped refresh + growth delegation
tests/web/farm-refresh-scope.test.ts                    new
tests/api/{fishing,forestry,mining}-loop.test.ts        migration list + 0021
tests/integration/farm-uniqueness-repair.test.ts        migration list + 0021
docs/qa/V16_2_1A_D1_READ_OPTIMIZATION.md                new (this file)
docs/performance/D1_READ_AUDIT.md                       V16.2.1A follow-up note
docs/CONTEXT_INDEX.md                                   pointer
```

## 21. Git status

The working tree is still the mixed V16.2.1 snapshot plus these changes. Nothing was committed,
stashed, reset or force-pushed; Build Shop WIP, free-land work, Warehouse QA and the automation design
doc are preserved.

## 22. Remaining risks

- **Client scope correctness.** If a future action changes a list its scope omits, the page shows
  stale data until the next full load. The scope is derived from the persistence layer (harvest never
  writes `farm_tiles`; building updates its own list), and the source tests fail if a list read moves
  outside the scope, but the mapping must be revisited if an action gains a new side effect.
- **Covering-index write cost.** The three covering indexes add a little write work per inserted
  tile/crop/tree. Rows-written is ~12.5k/day, far under its own limit, and the dropped single-column
  indexes offset it.
- **`farm_constructions` `SELECT *`.** Left as-is; if construction counts ever grow large, an
  explicit column list plus a covering index is the next step.
- **Verification is query-plan + rows-read, not a full 24 h window.** The daily saving is expected,
  not yet measured.

## Explicit answers

| Question | Answer |
| --- | --- |
| Does idle visible gameplay still read all farm_tiles every 5s? | NO |
| Does hidden tab poll? | NO |
| Can crop/tree visuals advance without an economic DB write? | YES |
| Is harvest still server-authoritative? | YES |
| Was free natural land behavior changed? | NO |
| Was Warehouse behavior changed? | NO |
| Was Automation implemented? | NO |
| Was production deployed? | NO |
| Was staging deployed? | YES |

Final verdict: **V16_2_1A_D1_READ_OPTIMIZATION_DEPLOYED**.
