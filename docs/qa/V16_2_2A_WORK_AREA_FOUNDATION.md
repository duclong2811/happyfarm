# V16.2.2A - Work Area foundation

Date: 2026-10-04. Verdict: **V16_2_2A_WORK_AREA_FOUNDATION_COMPLETE**.

The first slice of the automation design: players can name groups of cells. Nothing works them yet -
no Jobs, no Actors, no Cargo, no offline simulation - and naming an area costs nothing.

## 1. Repository areas reused

| Area | Reused as |
| --- | --- |
| `packages/domain` (ids, errors, tile bounds, `FarmId`) | the work-area rules' home |
| `packages/application` (ports, `ApplicationError`, use-case style, `IdempotencyRepository`, `PayloadFingerprint`, `Clock`) | the five commands |
| `packages/contracts` (zod DTOs, `ErrorCode`, `ZoneRef`) | the wire shapes |
| `packages/game-data/src/world/geography.ts` (`classifyTile`, `volcanoZoneAt`, `tileToWorld`) | the ground-capability rule |
| `workers/api/src/handler.ts` wiring + all-seeing error map | the five routes |
| `workers/api/src/d1-repositories.ts` (batch + receipt patterns) | `D1WorkAreaRepository` |
| `apps/web` panel registry (`panels.ts`), `make()` DOM helper, i18n, scene overlay | the editor |
| Migration `0021` (the V16.2.1A lesson) | the membership index |

## 2. Domain model

```text
WorkArea {
  id                  workarea_<uuid>      stable identity; the name is never a key
  farm_id                                  authorization root
  zone_kind/zone_id                        where it stands (HOME_ISLAND today) - a location, not a permission
  kind                                     FARM | ORCHARD | FORESTRY | MINING | LIVESTOCK | AQUACULTURE
  display_name                             player text, trimmed + NFC, 1..40 code points
  version, created_by_player_id, created_at, updated_at
}
WorkAreaCell { work_area_id, x, y }        membership, explicit
```

A work area is not ownership, not a land-use decision, not a placement reservation and not occupancy.
A cell in an area is still free for any crop, tree, building or node the ordinary rules allow.

## 3. Kinds

`FARM | ORCHARD | FORESTRY | MINING | LIVESTOCK | AQUACULTURE`, deliberately the words
`CellCapability` already uses (plus ORCHARD, which asks for FARM ground because a production tree
grows on the same cell a crop does). No MIXED kind: a two-purpose area gives a future Job no
deterministic answer for a target. No element or specialisation restriction of any kind.

## 4. Naming rules

| Concern | Rule |
| --- | --- |
| Trim | leading/trailing whitespace removed before anything else |
| Normalisation | NFC, so two byte-different spellings of one name compare equal |
| Length | 1..40 **code points**, measured after trim (an emoji is one character) |
| Control characters | refused (`U+0000`-`U+001F`, `U+007F`) |
| Bidi overrides | refused (`U+202A`-`U+202E`, `U+2066`-`U+2069`) - they can make two names render identically |
| Duplicates | **allowed**. Identity is the id; two areas may honestly both be "East Field" |
| Identity | `workarea_<uuid>`, server-generated; the display name is never a database key |

## 5. Membership model

An explicit `(work_area_id, x, y)` row per cell. A rectangle is the editor's selection convenience
and is converted to cells before the request is sent; `x, y, w, h` is never stored. The list is
deduplicated and ordered by y then x, so the same selection always stores the same list.

## 6. Membership cap

**256 cells**, enforced in `packages/domain` (`MAX_WORK_AREA_CELLS`), repeated in the contract as the
request array's maximum, and stated in the client. A whole starter field is 144 cells, so 256 holds
the field a player is likely to name while keeping the set a bounded read. Exceeding it is
`WORK_AREA_TOO_MANY_CELLS` (400).

## 7. Overlap policy

**Overlap is allowed**, including between two areas of the same kind. A work area is orchestration
metadata, not occupancy: exclusivity would quietly turn membership into a soft land reservation, which
is exactly what free natural land removed. The server stores both; a future Job resolves a shared
target by its own priority rather than by forbidding honest overlap.

## 8. Terrain validation

`packages/game-data` gains `groundCapabilities(tile)`, the server-side slice of the client's
`CellCapability`, derived from the same `classifyTile` the renderer and the placement rules use:

| Kind | Ground it needs | Ground that carries it |
| --- | --- | --- |
| FARM, ORCHARD, LIVESTOCK | `FARM` | dry, unprotected land |
| FORESTRY | `FORESTRY` | dry land, and the volcano's wooded foothill |
| MINING | `MINING` | the volcano's steep flank |
| AQUACULTURE | `AQUACULTURE` | the shallow shelf outside the harbour approach |

Refused, with `WORK_AREA_CELL_INVALID` (400): ocean, the pond, the beach, the crater, protected
ground, a kind on ground that does not carry it, out-of-world coordinates and non-integers. This is
*capability* validation - it says nothing about who may name the ground, and the server never treats
an area as a claim on it.

## 9. Authority model

`actor → farm membership/role → permission → farm's own zone → area`. Reads (list, get) require
membership; every write requires **OWNER**, matching Home Island editing. The client never sends an
owner, a role, a zone or a server version it is trusted to be right about. An area belonging to
another farm answers `WORK_AREA_NOT_FOUND` (404), so knowing an id teaches nothing; a non-member's
read answers `NOT_AUTHORIZED` (403).

## 10. CRUD / API

| Route | Use case | Semantics |
| --- | --- | --- |
| `GET /farms/:id/work-areas` | `ListWorkAreas` | names + cell counts, one bounded read; membership is not loaded |
| `POST /farms/:id/work-areas` | `CreateWorkArea` | idempotent on `requestId`; free; returns the area with its cells |
| `GET /farms/:id/work-areas/:workAreaId` | `GetWorkArea` | the editor's load: the area and its cells |
| `POST /farms/:id/work-areas/:id/rename` | `RenameWorkArea` | version-guarded |
| `POST /farms/:id/work-areas/:id/cells` | `ReplaceWorkAreaCells` | replace-by-list, version-guarded |
| `POST /farms/:id/work-areas/:id/delete` | `DeleteWorkArea` | version-guarded; cells go with it |

Writes are POST, matching the existing handler's convention. Create carries `requestId` and is
idempotent through the existing receipt table; the three edits carry `requestId` for consistency and
rely on `expectedVersion` - a replay is refused as stale rather than silently reapplied.

## 11. DB schema / indexes

`database/migrations/0022_work_areas.sql` (additive):

```text
work_areas       PK workarea_<uuid>; farm_id FK; zone_kind/zone_id; kind CHECK; display_name CHECK 1..40;
                 version; created_by_player_id FK; created_at/updated_at
                 idx_work_areas_farm (farm_id, created_at, id)     -- the list read
                 idx_work_areas_zone (zone_id, created_at, id)     -- the same list, scoped by place
work_area_cells  PK (work_area_id, x, y); work_area_id FK ON DELETE CASCADE; x/y bounds
                 idx_work_area_cells_area_yx (work_area_id, y, x)  -- index-only membership read
```

No actors, jobs, cargo, routes or simulation tables. No existing row, column or constraint touched.

## 12. D1 query plans

```text
list areas (bounded to one farm, with counts)
  SEARCH area USING INDEX idx_work_areas_farm (farm_id=?)
  SEARCH cell USING COVERING INDEX sqlite_autoindex_work_area_cells_1 (work_area_id=?)

load one area's membership
  SEARCH work_area_cells USING COVERING INDEX idx_work_area_cells_area_yx (work_area_id=?)
  -- index-only, in membership order, no temp sort

membership validation
  no query at all: the ground is classified in code, from the island's own geography
```

There is deliberately no `farm_tiles` read anywhere in this feature.

## 13. Estate UI

A **Work Areas** module in the existing panel rail (`panels.ts` registry: one entry, one panel).
Opening it brings the camera to the estate view, because picking cells is map work. Inside: the
area list (name, kind, cell count) with Rename / Edit cells / Delete, a **New area** button, and an
editor with kind, name, a running "N selected" count, Save / Cancel / Clear.

## 14. Mobile selection behaviour

Two taps: the first adds the cell it hit and arms a corner; a second tap on a different cell fills the
rectangle between them; tapping the same cell twice removes it. The rectangle is converted to an
explicit cell list (bounded, sorted) before the request leaves the client, so the stored model is
never a rectangle. Clear resets the draft. All of this is the *same* tap path as the rest of the
estate view - pointer or finger - so no new gesture vocabulary was introduced.

## 15. Natural-land compatibility

V14.5.2 is untouched. Creating an area charges no Gold, buys no land, writes no ownership, restores
no Land Mode and requires no `farm_tiles` row: the API test creates "East Field" over cells that have
no tile row at all and asserts the wallet, the inventory, the ledger, `farm_tiles` and every other
table are byte-for-byte unchanged.

## 16. Existing gameplay compatibility

Manual play is unaffected with zero work areas: the same test plants a crop successfully with no area
present, and every farming/market/warehouse/growth test in the suite is unchanged and green. Harvest
settlement, cargo and automation are untouched by this slice.

## 17. Tests

```text
tests/domain/work-area.test.ts              kinds, naming, cells, cap, version, zone derivation
tests/contracts/work-area-contract.test.ts  bounds/kinds/zone agree with the domain; request shapes strict
tests/integration/work-area-migration.test.ts  additive on a live save; PK/FK/CHECK; cascade delete
tests/api/work-area-loop.test.ts            the whole loop through the real handler (13 tests)
tests/web/work-area-editor.test.ts          selection/naming/signature + the hot-path source guard
```

The API suite covers: create on rowless natural land with no Gold/inventory/ledger change; Unicode,
trimming, max length, empty/whitespace/over-long refusal; duplicate names and overlapping cells;
ocean/pond/crater/wrong-ground refusal and mining on the flank accepted; out-of-world coordinates and
the cell cap; rename + stale rename; membership replace + stale replace + bad ground; delete + stale
delete; idempotent create replay and `IDEMPOTENCY_CONFLICT` on a different payload; two racing renames
(one wins, one 409); non-owner and EDITOR refusal; a foreign farm's read refusal; and manual planting
with zero areas.

## 18. Performance evidence

- **0** work-area queries from boot, from the 5 s growth poll, from pointer movement and from
  character movement: the only read site is `loadWorkAreas`, called when the panel opens and after a
  mutation. Pinned by a source test that fails if `getWorkAreas(` appears anywhere else, or if
  `refreshFarm` / `refreshGrowth` / `refreshAccount` mention work areas.
- The list read is one bounded statement over the farm's own area rows.
- The membership read is an index-only scan in membership order.
- Validation is in-memory; it costs no D1 row.

## 19. Migration

`0022_work_areas.sql`, applied to staging only (0001-0021 were already applied). Production is not
configured and was not touched.

## 20. Local gates

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         159 files, 1547 tests passed   (was 154 / 1503)
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27
git diff --check              clean
```

## 21. Staging migration result

Applied to `happy-farm-staging` after all gates passed (7 statements). Verified afterwards:
`work_areas` and `work_area_cells` exist, both are empty, and the membership read plans as
`SEARCH work_area_cells USING COVERING INDEX idx_work_area_cells_area_yx (work_area_id=?)` - an
index-only scan in membership order, with no temp sort. Remote is now `0001` - `0022`.

## 22. Staging deployment

```text
Worker:      happy-farm-staging
Version ID:  b4c415d8-47e9-45ea-b842-8a27707d86de
Built:       2026-10-04T03:49:17Z
Bundle:      assets/index-BDzSn0bm.js + assets/index-BGd5F1yh.css
Rollback:    previous live version 2bdb11b4-e26c-44f4-acb6-c0152f01ffd1
```

## 23. Remote smoke

Guest session and farm load, then the whole work-area loop on a fresh guest:

```text
POST /farms/:id/work-areas  201  "Cánh đồng Đông" (Unicode) on cells (9,26) and (10,26), version 1
GET  /farms/:id/work-areas  200  1 area, cellCount 2
POST .../rename             200  "East Field", version 2
POST .../cells              200  3 cells, version 3
POST .../cells (stale)      409  CONFLICT_STALE_STATE
POST /farms/:id/work-areas  400  FARM area on ocean (500,500) refused
POST /farms/:id/work-areas  201  MINING area on the volcano flank (12,-12) accepted
POST .../delete             200  area and its cells gone
```

No Gold and no inventory moved (`100 gold`, `10 carrot seeds` before and after creating the area), and
the area's cells still had no `farm_tiles` row afterwards. Existing gameplay was then verified on a
second fresh guest: Market **BUY** `200`, plant on free natural land `201`, growth read, harvest,
Warehouse `200`.

Mobile UX (the two-tap rectangle on a phone, the panel's touch layout) was **not** manually tested.

## 24. Files changed

```text
packages/domain/src/work-area.ts            new
packages/domain/src/ids.ts                  workarea id
packages/domain/src/errors.ts               INVALID_WORK_AREA, WORK_AREA_TOO_MANY_CELLS
packages/application/src/work-areas.ts      new (five use cases)
packages/application/src/ports.ts           WorkAreaRepository, ground lookup, id generator
packages/application/src/errors.ts          four work-area codes
packages/contracts/src/index.ts             DTOs, requests, kinds, error codes
packages/game-data/src/world/geography.ts   groundCapabilities
workers/api/src/d1-repositories.ts          D1WorkAreaRepository
workers/api/src/handler.ts                  five routes + wiring + error statuses
workers/api/src/runtime.ts                  gameDataWorkAreaGround, CryptoIdGenerator
workers/api/src/index.ts, dev-index.ts      wire the port
database/migrations/0022_work_areas.sql     new
apps/web/src/work-areas/model.ts            new (pure editor logic)
apps/web/src/panels.ts, main.ts, api.ts, index.html, styles.css, i18n.ts   the panel
apps/web/src/render/{scene,materials}.ts    the draft overlay layer
tests/domain|contracts|integration|api|web  the five new test files
tests/api/{fishing,forestry,mining}-loop, tests/integration/farm-uniqueness-repair   migration list + 0022
docs/design/AUTOMATION_LOGISTICS.md, docs/CONTEXT_INDEX.md, docs/DATA_MODEL.md, this file
```

## 25. Git status

The working tree remains the mixed V16.2.1/V16.2.2 snapshot plus these changes. Nothing was
committed, stashed, reset or force-pushed; Build Shop WIP, free-land work, Warehouse QA and the
automation design doc are preserved.

## 26. Limitations / deferred work

- Nothing works an area: no Jobs, no Actors, no Cargo, no offline simulation, no auto-work switch.
- Deleting an area is unconditional because nothing references one yet. When Jobs exist, the same
  command grows one rule - refuse while an active Job names the area - and no table has to change.
- `MIXED` areas are deliberately absent; if a product need appears, it is a new kind with its own
  target-resolution rule, not a relaxation of the kind check.
- The zone is stored but not exposed on the wire; when shared ground exists, the DTO grows a zone
  field and the lookup already answers per farm.
- The editor's rectangle is not draggable: two taps fill it, and a large mistimed drag can be cleared
  with one button. A drag affordance is a polish pass, not a model change.
- Remote smoke was automated (HTTP); the panel's rendering and touch feel still need a browser pass.

## Explicit answers

| Question | Answer |
| --- | --- |
| Does Work Area imply land ownership? | NO |
| Does creating an Area cost Gold? | NO |
| Can valid rowless natural land belong to an Area? | YES |
| Can manual gameplay work with zero Work Areas? | YES |
| Does growth polling query Work Areas? | NO |
| Does Work Area creation start automation? | NO |
| Were Jobs implemented? | NO |
| Were Actors implemented? | NO |
| Was Cargo implemented? | NO |
| Was offline automation implemented? | NO |
| Was Land Mode restored? | NO |
| Was production deployed? | NO |

Final verdict: **V16_2_2A_WORK_AREA_FOUNDATION_COMPLETE**.
