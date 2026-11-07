# V16.2.2B - Actor + Job spine

Date: 2026-10-04. Verdict: **V16_2_2B_ACTOR_JOB_SPINE_COMPLETE**.

The second automation slice: the durable configuration of *who* could work, *where*, *what* for and in
*what order*. **Nothing executes.** Creating a job plants nothing, harvests nothing, moves nobody and
writes no inventory, experience, gold or warehouse row - and there is no Auto switch, no cargo, no
route, no offline simulation and no NPC.

## 1. Actor model chosen

**A durable `actors` row**, created lazily for the farm owner's Main Character.

```text
Actor { id actor_<uuid>, owner_player_id, kind, control_mode, zone_kind/zone_id, version, timestamps }
```

## 2. Why durable rather than derived

A derived id (`actor_<player-uuid>`) would have worked today and been a trap tomorrow. The actor is
where the *next* slices put things that are not the player's: a control mode an Auto switch toggles, a
`simulation_at` watermark, an activity, eventually a position. Hanging those on `players` would mix
account state with game-entity state, and turning a derived id into a row later would mean
re-pointing every job that already referenced it. One lazily-created row costs one indexed read per
panel open and removes that migration entirely. The row is also what makes "exactly one Main
Character" a database constraint rather than a convention.

## 3. Main Character uniqueness

```sql
CREATE UNIQUE INDEX idx_actors_one_main_character ON actors(owner_player_id) WHERE kind = 'MAIN_CHARACTER';
```

Partial, so the NPCs a later slice adds are not capped at one per player. `ensureMainCharacter` is
`INSERT OR IGNORE` followed by a read-back, so a repeated login, a second tab, a refreshed guest
session and two simultaneous first fills all converge on one row - verified by a concurrent test and
by the staging smoke reading the panel twice.

## 4. Control vs activity

| Concept | Stored? | Meaning |
| --- | --- | --- |
| `control_mode` | **yes**, default `PLAYER_CONTROLLED` | who decides next: the player or a future executor. The column the Auto switch will write. |
| `ActorActivity` (`IDLE`/`TRAVELLING`/`WORKING`/`HAULING`/`WAITING_FOR_STORAGE`) | **no** | runtime state only a working executor can produce. Named in the domain so nothing overloads control with it. |
| `enabled` on a job | separate | "skip this assignment for now", not "the actor is auto". |

The three are deliberately independent: an `AUTO_CONTROLLED` actor with nothing actionable is idle, a
`PLAYER_CONTROLLED` actor can be working, and a disabled job is still configured.

## 5. Job model

```text
Job { id job_<uuid>, actor_id, farm_id, work_area_id, kind, target_definition_id, priority, enabled, version, timestamps }
```

WHO (actor) / WHERE (work area) / WHAT (profession + stable game-data target) / ORDER (priority) /
ELIGIBLE (enabled) / VERSION (concurrency). No travel, cargo, position, duration or reward lives here:
a job is intent, and execution state belongs to the slice that executes.

## 6. Job types

`FARM | ORCHARD | FORESTRY | MINING | LIVESTOCK | AQUACULTURE` - the *same* list a Work Area is named
with, which is what makes compatibility equality instead of a translation table. `LIVESTOCK` and
`AQUACULTURE` are storable as *area kinds* but cannot be assigned yet: there is no livestock system
and no fishing automation, and a job for work the game cannot describe would be a lie.

## 7. Target representation

A stable game-data id and nothing else: `crop_*` for FARM, `tree_*` for ORCHARD, `resource_*` for
MINING and FORESTRY. Two gates, both server-side: the id must have the profession's shape
(`jobTargetFitsShape`) and the definition must exist in the catalogue the world is served from
(`cropDefinitions.findById`, `treeDefinitions.findById`, `resourceCatalogue.findDefinition`). The
client never sends a label, and the server resolves the display key for the wire.

## 8. Area compatibility

`jobKindMatchesArea(kind, area.kind)` - the professions must be the same word, so a MINING job can
only name a MINING area. A client cannot bypass it, and the area must also belong to the route's
farm, or the answer is `WORK_AREA_NOT_FOUND` (a wrong farm teaches nothing).

## 9. Priority / reorder model

Dense integers from 1, bounded by `MAX_JOBS_PER_ACTOR` (24).

- **Create** appends after the highest existing priority.
- **Reorder** sends the actor's *whole* order as ids; the server accepts it only when it is exactly a
  permutation of the actor's jobs (`planJobReorder`) and then writes 1..N in one batch under the
  actor's version guard.
- **Delete** renumbers the survivors in the same transaction (priority = how many jobs are ahead of
  it, + 1), so a delete can never leave a gap for a later create to fall into.

The staging smoke caught exactly that gap: after deleting the first of three jobs the survivors kept
2 and 3, and a new job would have taken priority 2 from the wrong place. The delete now renumbers and
the create appends after the highest priority, both verifiable in the API tests.

## 10. Enabled / disabled

`enabled` is a stored flag with its own command, so an assignment can be ignored without being
deleted. It is not the actor's Auto state: nothing in this slice starts or stops work.

## 11. Work area delete protection

`actor_jobs.work_area_id` is `ON DELETE RESTRICT`, and `DeleteWorkArea` asks first:

```text
WORK_AREA_IN_USE (409): "This area is assigned to a job. Remove the job first."
```

No cascade silently deletes configuration. The API test deletes a referenced area (refused), deletes
the job, and then deletes the area (succeeds).

## 12. Authority

```text
authenticated player -> farm membership (OWNER) -> the farm owner's Main Character -> the farm's areas
```

There is no route parameter for an owner, a player or a control mode, and no client-supplied id grants
anything: a job in another farm answers `JOB_NOT_FOUND`, and a non-owner (including an EDITOR) gets
`NOT_AUTHORIZED` before any actor is created.

## 13. Idempotency / concurrency

- **Create** is idempotent on `requestId` through the existing receipt table, written in the same
  transaction as the job; the same request id with a different payload is `IDEMPOTENCY_CONFLICT`.
- **Target / enabled / delete** are `expectedVersion`-guarded; a stale edit is `CONFLICT_STALE_STATE`
  and the current row is returned by the next read.
- **Reorder** is guarded by the *actor's* version, so two tabs cannot interleave into an order neither
  asked for; a reorder that is not a permutation is `JOB_REORDER_MISMATCH`.
- **Actor creation** is idempotent by the partial unique index, not by a check-then-insert.

## 14. DB schema / indexes

`database/migrations/0023_actors_and_jobs.sql` (additive):

```text
actors       PK actor_<uuid>; owner_player_id FK; kind CHECK; control_mode CHECK; zone_kind/zone_id;
             version; timestamps
             UNIQUE (owner_player_id) WHERE kind = 'MAIN_CHARACTER'   -- exactly one Main Character
             idx_actors_owner (owner_player_id, created_at, id)
actor_jobs   PK job_<uuid>; actor_id FK CASCADE; farm_id FK CASCADE;
             work_area_id FK **RESTRICT**; kind CHECK; target_definition_id; priority CHECK 1..24;
             enabled CHECK 0/1; version; timestamps
             idx_actor_jobs_actor_priority (actor_id, priority, id)   -- the ordered read
             idx_actor_jobs_work_area (work_area_id, id)              -- the delete guard
```

No cargo, routes, simulation events, employment or ship tables.

## 15. Query plans (measured on staging)

```text
Main Character lookup   SEARCH actors USING INDEX idx_actors_one_main_character (owner_player_id=?)
Jobs by actor, ordered  SEARCH actor_jobs USING INDEX idx_actor_jobs_actor_priority (actor_id=?)
Work-area reference     SEARCH actor_jobs USING COVERING INDEX idx_actor_jobs_work_area (work_area_id=?)
```

Every read is bounded to one player's or one area's own rows; there is no global scan. Jobs for one
actor come back in index order, with no temp sort - the query a future executor asks.

## 16. Management UI

A **Workers** module in the existing panel rail. One actor is shown - "Main Character", with its
control state as a *label* (there is no Auto button, because there is no Auto yet) - above the
assignment list: `N. <target> / <area>`, an enabled/disabled state, and ↑ ▼ / enable-disable / remove
controls that are thumb-sized. **Assign job** opens the flow the brief asks for: choose the type (a
profession with nothing to assign is shown but not choosable), choose a target from the definitions
the world ships, choose one of that type's areas, assign. The panel says in its own copy that
assignments are configuration and that nobody works them yet.

## 17. D1 behaviour

Reads happen when the worker panel is opened and after a mutation - never on boot, never on the growth
poll, never in the frame, pointer or movement loops. Opening it costs two bounded reads (the panel and
the farm's area names, both already existing routes). The V16.2.1A optimization is untouched: no new
poll, no new timer, no per-frame query.

## 18. Existing-save behaviour

An existing save gains its actor the first time the panel is opened and nothing else changes: no
inventory, warehouse, wallet, experience, `farm_tiles`, crops, trees or node rows are written, and no
farm has to be recreated. The migration is additive and the API test asserts each of those tables
before and after.

## 19. Tests

```text
tests/domain/job.test.ts                 actor kinds/control, job kinds, target shape, order, versions
tests/integration/actor-job-migration.test.ts  additive on a live save; one Main Character; RESTRICT; cascades; CHECKs
tests/contracts/job-contract.test.ts     contract/domain vocabularies and bounds agree; request shapes strict
tests/api/actor-job-loop.test.ts         the whole loop through the real handler (12 tests)
tests/web/workers-panel.test.ts          target choice, compatible areas, order arithmetic + hot-path guard
```

The API suite covers: one Main Character across repeated and concurrent reads; the actor existing for
an old save without touching anything; a job with **no economic or world effect** (crops, trees,
resource actions and node states all still zero; gold, seeds, ledger and progression unchanged);
dense deterministic order; reorder; a non-permutation order refused; a stale reorder refused;
enable/disable and stale edits; target update and an unknown or wrong-shape target; area/kind mismatch;
livestock refused; a foreign area refused; the work-area delete guard and its release; idempotent
replay and `IDEMPOTENCY_CONFLICT`; non-owner refusal (including EDITOR); the 24-job cap; and
renumbering after a delete.

## 20. Gates

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         164 files, 1602 tests passed   (was 159 / 1564)
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27
git diff --check              clean
```

## 21. Migration

`0023_actors_and_jobs.sql`, applied to `happy-farm-staging` only (8 statements). Remote is now
`0001` - `0023`; `actors` and `actor_jobs` were empty before the smoke test created its own.

## 22. Staging deployment

```text
Worker:      happy-farm-staging
Version ID:  db1e499e-fe7b-45b1-8d60-25598b55b4df   (04:33:34Z)
Bundle:      assets/index-*.js from the same build
Rollback:    cbd296ca-1586-4a0e-b701-f6d62e99366d   (04:27:36Z, before the renumber fix)
```

## 23. Remote smoke

```text
GET  /api/session                    200  guest
GET  /farms/:id/workers              200  actor MAIN_CHARACTER / PLAYER_CONTROLLED, same id on a second read
POST /farms/:id/work-areas           201  "East Field" on (9,26),(10,26)
POST /farms/:id/jobs                 201  priority 1, target key crop.carrot.name
GET  /api/wallet                     100 gold before and after  (no economic effect)
GET  /api/inventory                  10 carrot seeds before and after
POST /farms/:id/jobs                 201  second job, priority 2
POST .../enabled  (disable, enable)  200, 200
POST /jobs/order                     200  order reversed
POST .../delete (referenced area)    409  WORK_AREA_IN_USE
POST .../delete job                  200
POST .../delete area afterwards      200
POST /api/shop/buy                   200  Market unaffected
POST /farms/:id/crops                201  planting unaffected - on a cell that a work area names
GET  /api/warehouse                  200
```

A second guest then verified the renumbering: three jobs (1,2,3) -> delete the first -> survivors
`1,2` -> a new job appends at `3`, with no collision.

## 24. Files changed

```text
packages/domain/src/actor.ts, job.ts          new
packages/domain/src/ids.ts, errors.ts, index.ts
packages/application/src/jobs.ts              new (six use cases)
packages/application/src/ports.ts, errors.ts, index.ts
packages/application/src/work-areas.ts        the delete guard
packages/contracts/src/index.ts               actor/job DTOs, requests, error codes
workers/api/src/d1-repositories.ts            D1ActorRepository, D1ActorJobRepository
workers/api/src/handler.ts                    six routes, wiring, error statuses
workers/api/src/runtime.ts, index.ts, dev-index.ts
database/migrations/0023_actors_and_jobs.sql  new
apps/web/src/workers/model.ts                 new (pure)
apps/web/src/panels.ts, main.ts, api.ts, index.html, styles.css, i18n.ts
tests/domain/job.test.ts, tests/integration/actor-job-migration.test.ts,
tests/api/actor-job-loop.test.ts, tests/web/workers-panel.test.ts   new
tests/api/{fishing,forestry,mining}-loop, tests/api/work-area-loop,
tests/integration/farm-uniqueness-repair, tests/web/work-area-editor   migration list / assertion updates
docs/design/AUTOMATION_LOGISTICS.md, docs/CONTEXT_INDEX.md, docs/DATA_MODEL.md, this file
```

## 25. Git status

The mixed working tree is preserved: nothing committed, stashed, reset or force-pushed, and no
historical WIP touched.

## 26. Deferred items

- **No execution**: no Auto switch, no movement, no planting/harvesting/mining/forestry automation,
  no cargo, no routes, no offline simulation, no NPCs, no wages, no vehicles or ships.
- **Control mode is stored but never changed** by any route in this slice; the Auto switch belongs
  with the executor.
- **Activity is not stored**: it arrives with the executor that can produce it.
- **Livestock and aquaculture jobs** are refused rather than stored; they arrive with their systems.
- **`MAX_JOBS_PER_ACTOR` is 24**, enforced by the domain, the contract and the table's CHECK.
- **EDITOR/HELPER access** to worker configuration is undecided and pre-refused (OWNER only), like the
  rest of Home Island editing.
- **The panel is HTTP-smoke-tested, not browser-tested**: its rendering and touch feel still need a
  manual pass.

## Explicit answers

| Question | Answer |
| --- | --- |
| Is Main Character represented as exactly one logical Actor? | YES |
| Can one Actor have multiple ordered Jobs? | YES |
| Does creating a Job execute work? | NO |
| Does creating a Job move the Character? | NO |
| Does creating a Job change inventory/XP/Gold? | NO |
| Can a referenced Work Area be deleted? | NO |
| Can Job be disabled without deleting it? | YES |
| Does growth polling query Jobs? | NO |
| Does idle gameplay poll Jobs? | NO |
| Were Cargo/Routes implemented? | NO |
| Was Auto execution implemented? | NO |
| Was offline simulation implemented? | NO |
| Were NPCs implemented? | NO |
| Was production deployed? | NO |

Final verdict: **V16_2_2B_ACTOR_JOB_SPINE_COMPLETE**.
