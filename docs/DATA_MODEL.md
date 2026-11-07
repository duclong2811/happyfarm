# Data Model

This document defines conceptual D1 entities. Exact SQL belongs in migrations.

## ID conventions
Use opaque stable IDs for player/farm/transaction/request entities. Use stable semantic IDs for static definitions (`crop_carrot`, `item_carrot_seed`). Never use display names as keys.

## Core tables
### players
- id PK
- auth_issuer
- auth_subject
- display_name
- status
- created_at
- updated_at

Constraints: `UNIQUE(auth_issuer, auth_subject)`. Never assume `auth_subject` is globally unique across identity providers.

The authenticated player ID is resolved server-side from a verified authentication context containing issuer and subject. A client-supplied `playerId` is never proof of identity.

### farms
- id PK
- owner_player_id FK -> players
- name
- level
- xp
- created_at
- updated_at
Indexes: owner_player_id

### farm_members
- farm_id FK
- player_id FK
- role
- created_at
PK/UNIQUE: (farm_id, player_id)
Indexes: player_id

`role` uses the stable constrained set `OWNER`, `EDITOR`, `HELPER`, `VISITOR`. Enforce it in application validation and, where practical in D1/SQLite, with a `CHECK` constraint.

### Farm ownership invariants
- Every farm has exactly one owner. `farms.owner_player_id` is the canonical ownership reference.
- The canonical owner has exactly one corresponding `farm_members` row with role `OWNER`.
- A farm must never exist without an owner or with multiple `OWNER` memberships. Use transaction boundaries plus database constraints, including a unique/partial index for the OWNER role where practical.
- `farms.owner_player_id` and the matching `farm_members` row must always be updated together.
- Ownership transfer is unsupported in Phase 1. Until an explicit transfer use case exists, attempts to change `owner_player_id` or remove/change the OWNER membership are rejected.

### Farm creation transaction
`CreateFarm(actor)` derives the player from verified authentication context and performs the following in one database transaction:

1. Validate the authenticated player.
2. Insert the farm with that player as `owner_player_id`.
3. Insert the matching `farm_members` row with role `OWNER`.
4. Create all required initial farm metadata/state, including the farm's starter land tiles.
5. Commit.

If any step fails, roll back the entire transaction. A partially created farm must never be observable.

### farm_tiles
- farm_id FK
- x integer
- y integer
- terrain_type
- tile_state
- version INTEGER NOT NULL DEFAULT 1
- updated_at
UNIQUE: (farm_id, x, y)
Indexes: farm_id

Coordinates must be validated against implementation configuration constants `MIN_TILE_X`, `MAX_TILE_X`, `MIN_TILE_Y`, and `MAX_TILE_Y`. These bounds must support the intended logical world and must not be replaced by an unnecessarily small hard-coded limit. A tile may be mutated only when it belongs to land currently unlocked by the farm.

#### Starter land

An existing tile row *is* unlocked land (`UnlockedLandPolicy`), so a farm with no tile rows has no
plantable land. `CreateFarm` therefore inserts a `12 x 12` square of `SOIL` tiles anchored at the
origin (`(0,0)` through `(11,11)`), all at `tile_state = IDLE` and `version = 1`, in the same
transaction as the farm row and its `OWNER` membership. `INITIAL_LAND_SIZE` in `packages/domain`
is the single source of the side length (and, since ADR 0021, the size of one plot cohort);
`createInitialFarmTiles` is the only producer. A farm is never observable with a partial starter
square. Reading that land back requires the authenticated `GET /farms/:farmId/tiles` route, which
returns each tile's authoritative `version`.

The rendered world is deliberately much larger than the farm and is never stored: the reserved
catalogue field is `36 x 36` tiles and the island is `62 x 62`, but only a tile the farm actually
owns has a row. See ADR 0021.

`terrain_type` uses the initial stable enum-like values `GRASS`, `SOIL`, `WATER`, and `BLOCKED`. Terrain and mutable tile state are separate concepts. Phase 1 uses the minimal `tile_state` value `IDLE`; later states require an explicit schema/game-data change. Runtime validation and database constraints where practical must reject arbitrary client-provided terrain or state strings.

#### Farm expansion

Each purchased plot adds a deterministic `12 x 12` cohort of fresh `SOIL` tiles. Plot order, price,
currency, and required player level come from validated game data. Only the farm owner may buy the
server-selected next contiguous plot. Wallet debit, ledger row, all tile inserts, and idempotency
record commit atomically; a tile row remains the single representation of unlocked land.

Each successful tile state mutation increments `version` monotonically by one. Operations that require optimistic concurrency accept a validated `expectedVersion` and conceptually update with:

```sql
UPDATE farm_tiles
SET tile_state = ?,
    version = version + 1,
    updated_at = ?
WHERE farm_id = ?
  AND x = ?
  AND y = ?
  AND version = ?;
```

If no row is updated, return the stable `CONFLICT_STALE_STATE` error. Client versions are not required for operations that cannot affect authoritative mutable tile state.

Planting is the documented exception: `PlantCrop` accepts `expectedTileVersion` as an optimistic
guard on the tile row it is about to occupy, but it does not rewrite that row and therefore does
not increment `version`. Crop occupancy is canonical in `crop_instances`, whose
`UNIQUE(farm_id,tile_x,tile_y)` is what actually prevents double planting. A tile's `version`
therefore tracks terrain mutation only, and stays at `1` across an arbitrary number of plant,
harvest, and replant cycles.

### crop_instances
- id PK
- farm_id FK
- tile_x
- tile_y
- crop_definition_id
- planted_at
- planted_by_player_id FK
- version
- created_at
- updated_at

`crop_instances` is the single source of truth for crop occupancy. Do not duplicate crop identity or occupancy on `farm_tiles`. `UNIQUE(farm_id,tile_x,tile_y)` prevents concurrent double planting while Phase 2A crop rows represent active crops.

Crop definition IDs reference the validated game-data registry, not a fake D1 table. `planted_at` is assigned from server time. Growth percentage, stage, maturity, and `mature_at` are derived and are not persisted.

A crop definition's level requirement (`requiredLevel`, absent meaning level 1) is part of that game-data registry and is enforced when a crop is planted. It is not stored per row and is deliberately not applied to reads, so a crop already in the ground keeps reporting its growth even if a later curve would have locked it.

#### Planting settlement

Since Phase 5 every planting costs exactly one seed, and a crop definition names that seed
(`seedItemDefinitionId`, a `SEED` item in the same registry). The seed is resolved from the crop
definition the server looked up, never from the command. `PlantCrop` prepares the removal through
the centralized inventory service and passes the expected inventory row to the repository, which
spends the seed, inserts the crop, and finalizes idempotency in one D1 batch. The batch's final
statement commits the receipt only when the crop row exists *and* the seed row sits at the
post-removal quantity and version, so a failure anywhere rolls back all three. A replay returns the
stored crop and spends nothing further; a plant that loses a race is refused with
`INSUFFICIENT_ITEMS` or `CONFLICT_STALE_STATE`, never with a negative stack.

Uprooting (`UPROOT_CROP`) is the opposite: `DELETE FROM crop_instances` plus the idempotency record
in one batch, and no inventory, currency, or experience write at all.

Constraints: at most one active crop per valid tile; definition ID validated by application/game-data.
Indexes: farm_id; (farm_id,tile_x,tile_y)

### tree_instances
- id PK (`treeinst_*`)
- farm_id FK
- tile_x
- tile_y
- tree_definition_id
- planted_by_player_id FK
- planted_at
- last_harvested_at nullable
- version
- created_at
- updated_at

`tree_instances` is the single source of truth for tree occupancy. `UNIQUE(farm_id,tile_x,tile_y)`
prevents two trees on one tile, and the `(farm_id,tile_x,tile_y)` foreign key to `farm_tiles` means a
tree can only stand on unlocked land. Only `planted_at`, `last_harvested_at`, and `version` carry
lifecycle state: readiness, phase, remaining time, and growth stage are derived from those plus the
definition's `firstReadySeconds`/`regrowSeconds` (see `docs/decisions/0014-trees-and-repeating-harvests.md`).
`last_harvested_at` is null until the first harvest, which is the only difference between first growth
and regrowth.

### tree_harvest_settlements
- actor_player_id
- operation (`HARVEST_TREE`)
- request_id
- farm_id FK
- tree_instance_id
- tree_version (the revision the cycle started from)
- tree_definition_id
- item_definition_id
- quantity, max_quantity
- created_at
UNIQUE: (tree_instance_id, tree_version)

One settled cycle per row, and the uniqueness is what makes "one cycle, at most one reward" a
database fact rather than a convention. The `BEFORE INSERT` trigger refuses a settlement whose actor
does not own the farm, whose tree is not at that exact revision, or whose reward would exceed the
player's stack, and the `AFTER INSERT` trigger credits the fruit and advances the tree's
`last_harvested_at` and `version` in the same statement pair. The tree is never deleted by a harvest.

### Cross-occupancy between crops and trees

`crop_instances` and `tree_instances` each prevent two of their own rows on a tile. The pair
`tree_instance_requires_free_of_crop` and `crop_instance_requires_free_of_tree` (both added by
`0008_tree_instances.sql`) extend that across the two tables in both directions, so one tile holds at
most one occupant no matter how the two plantings interleave.

### animal_instances / building_instances
Follow the same pattern: stable instance ID, farm ID, definition ID, logical position, authoritative state anchors/timestamps, version, creator, timestamps.

### inventory_items
- player_id FK
- item_definition_id
- quantity
- updated_at
- version
UNIQUE: (player_id, item_definition_id)
Constraint: quantity is an integer from 0 through 2,147,483,647. Each player/item pair has one authoritative stack. Mutations are created through the centralized inventory service; gameplay systems do not issue ad hoc quantity updates.

Item definition IDs are validated against static game data and intentionally have no fake D1 foreign key. Crop harvest item references are validated against that registry at game-data load time.

### starter_grants
- player_id
- grant_key
- item_definition_id
- item_quantity
- currency_id
- gold_amount
- transaction_id (nullable: a gold-free receipt never moved currency)
- request_id (nullable, same rule)
- created_at
PRIMARY KEY: (player_id, grant_key)
FK: player_id -> players(id)

The one-time starter package receipt (Phase 5, widened in ADR 0020). The primary key is what makes
the grant happen once per player and per package version: a repeated onboarding pass, a second farm,
a reconnect, a retried request, or two racing requests all match the existing row and credit nothing.
The receipt *is* the command -- an `AFTER INSERT` trigger credits the seed stack, creates the wallet
when it is missing, and appends one `economy_ledger` row in the same statement -- so there is no
window in which a player holds the package without the record of having received it, or the reverse.
The item, the quantity, the currency, and the amount come from validated game data, and no route
accepts any of them.

`grant_key` is the package version (`starter_package_v1`). Rows carried over from the pre-package
seed economy keep their own key (`starter_seed_v1`) and a `gold_amount` of 0, so a player who
received seeds before the package existed is not treated as having received the package.

### harvest_settlements
- actor_player_id
- operation + request_id
- farm_id
- crop_instance_id UNIQUE per harvest operation
- crop_version + crop_definition_id
- item_definition_id
- quantity + max_quantity
- created_at

The settlement row is an immutable receipt and concurrency claim. Its database trigger atomically increments inventory and removes the matching authoritative crop. The settlement and generic idempotency row commit in one D1 batch; any failure rolls back all effects. Concurrent additions use an atomic upsert rather than a read/modify/write sequence.

### wallets
- player_id FK
- currency_id
- balance
- created_at
- updated_at
- version
PRIMARY KEY/UNIQUE: (player_id, currency_id)

Balances are safe integers in the inclusive range `0..9,007,199,254,740,991`. Phase 3C uses race-safe lazy creation at zero balance and version 1. Every successful authoritative mutation increments the version and appends its ledger row in the same transaction. Static currency metadata is validated through game data and is not duplicated in D1.

### economy_ledger
- id PK
- player_id FK
- currency_id
- delta
- reason
- reference_type
- reference_id
- request_id
- balance_before
- balance_after
- created_at
Indexes: player_id+created_at; request_id
Never delete or rewrite normal ledger history as part of routine gameplay.

The ledger records transaction ID, exact integer delta, stable reason/reference, request ID, balance before/after, expected wallet version, and timestamp. A database check enforces `balance_after = balance_before + delta`; update/delete triggers make normal history append-only. Corrections use compensating entries rather than editing history.

`reason` is one of `SHOP_BUY`, `SHOP_SELL`, `FARM_EXPANSION` (land, referencing a plot), or
`STARTER_GRANT` (the one-time starter package, referencing the player). Each reason has exactly one
reference kind, enforced by a database check and mirrored by `referenceTypeForReason`, so a row
cannot claim to be a purchase while citing a player or the reverse.

### player_progression
- player_id PK/FK
- level
- xp
- progression_version
- created_at
- updated_at

PK/FK: `player_id` -> `players(id)`, `ON UPDATE RESTRICT ON DELETE RESTRICT`. Constraints: `level` is an integer from 1 through 10,000, `xp` is an integer from 0 through `Number.MAX_SAFE_INTEGER`, and `progression_version` is at least 1.

`level` is a cache of the level curve applied to `xp`, not an independent value. The curve lives in `packages/game-data` and the arithmetic in `packages/domain`; `assertProgression` refuses a row where the two disagree rather than writing the disagreement forward. The trigger `player_progression_monotonic_update` rejects any update that would lower `xp`, lower `level`, or leave `progression_version` unchanged, so progression cannot be moved into an earlier state by a later code path. Rows are created lazily by the first experience award, exactly as `wallets` rows are created by the first settlement; a player who has never earned experience has no row and reads as level 1.

### quest_progress (post-MVP)
- player_id
- quest_definition_id
- state
- progress_json or normalized fields
- claimed_at nullable
- updated_at
UNIQUE: player + quest definition + applicable cycle/version

### idempotency_keys
- actor_player_id
- request_id
- operation
- status
- payload_fingerprint
- resource_id nullable
- response_json or stored response metadata
- created_at
- expires_at nullable
UNIQUE: (actor_player_id, request_id, operation)

Only successful high-value commands are recorded: planting, harvest, shop settlement, farm expansion,
and uproot. A retry by the same actor with the same operation, request ID, and payload fingerprint
returns the original result after current resource access is re-authorized where the command names a
protected farm resource. Reusing that identity with a different payload returns
`IDEMPOTENCY_CONFLICT`. Failed validation is not recorded and may be corrected and retried.

### audit_events
- id PK
- actor_type
- actor_id
- action
- resource_type
- resource_id
- reason nullable
- metadata_json minimized/non-sensitive
- created_at
Indexes: actor_id+created_at; resource_type+resource_id

## Relationships
Player -> owns many Farms.
Farm <-> Players through farm_members.
Farm -> tiles/crops/trees/animals/buildings.
Player -> inventory/wallet/progression/ledger.

## Foreign keys and deletion behavior
Foreign-key enforcement must be enabled for D1 operations wherever supported by the runtime and migration environment. Every migration must declare the intended action for each foreign key; do not rely on an unspecified default.

- Player records are not hard-deleted during normal gameplay. Use status/soft-delete semantics. Player deletion is rejected while owned farms exist unless an explicit administrative workflow safely transfers or deletes those farms. Player references that could orphan ownership or history use `RESTRICT`/`NO ACTION`.
- Farm deletion is an explicit destructive administrative operation. Farm-owned dependent state must be removed consistently in one controlled transaction. Migrations may use explicit `ON DELETE CASCADE` for strictly farm-owned rows, while ownership/history references use restrictive behavior as appropriate.
- Farm memberships may be removed normally except for the OWNER membership. OWNER removal is rejected until an ownership-transfer workflow atomically updates both ownership references.

## Concurrency
High-value entities should expose version/state guards where useful. Durable Object ordering can reduce concurrency inside one active farm, but database mutations still require constraints/transactions/idempotency appropriate to the operation.

## Migration rules
- Every schema change gets a new migration.
- Never modify an already-applied migration in place.
- Migrations must be deterministic and reviewable.
- Destructive changes require explicit migration/rollback strategy and data impact note.
- Declare foreign-key deletion/update behavior explicitly and verify that foreign-key enforcement is active where supported.
- Add indexes intentionally based on query patterns; do not index every field automatically.

## Work areas (V16.2.2A)

A Work Area is a **player-named group of cells** a future Job may be asked to work. It is
orchestration metadata only: not ownership, not a land-use decision, not a placement reservation and
not occupancy. A cell in an area is still free for any crop, tree, building or node the ordinary rules
allow, and creating an area costs no gold and writes no `farm_tiles` row.

| Table | Columns | Notes |
| --- | --- | --- |
| `work_areas` | `id` (`workarea_<uuid>`), `farm_id` FK, `zone_kind`/`zone_id`, `kind`, `display_name`, `version`, `created_by_player_id` FK, `created_at`, `updated_at` | `kind` is `FARM \| ORCHARD \| FORESTRY \| MINING \| LIVESTOCK \| AQUACULTURE` by CHECK; the name is 1-40 characters; indexes `(farm_id, created_at, id)` and `(zone_id, created_at, id)` |
| `work_area_cells` | `work_area_id` FK, `x`, `y` | membership is explicit rows, never a rectangle; PK `(work_area_id, x, y)`; `work_area_id` cascades on delete; `(work_area_id, y, x)` serves the index-only membership read |

- Identity is the id. A display name is player text: trimmed, NFC-normalised, and duplicates are
  allowed, because two areas may honestly share one.
- The zone columns are a *location*, never authority (ADR 0027). They exist so a future expansion
  island or shared ground is another row rather than a redesign.
- Membership is bounded server-side (256 cells) and validated against the ground's capabilities;
  overlap between areas is permitted by design.
- Reads: `GET /farms/:id/work-areas` (names and counts) and `GET /farms/:id/work-areas/:workAreaId`
  (membership). Writes are `POST` create (idempotent), rename, cells and delete (version-guarded);
  reads require farm membership, writes require OWNER.

## Actors and jobs (V16.2.2B)

The durable *configuration* of automation. **A job is not an execution**: creating one plants
nothing, harvests nothing, moves nobody and writes no inventory, experience, gold or warehouse row.
There is no cargo, route, activity or simulation state in these tables.

| Table | Columns | Notes |
| --- | --- | --- |
| `actors` | `id` (`actor_<uuid>`), `owner_player_id` FK, `kind`, `control_mode`, `zone_kind`/`zone_id`, `version`, `created_at`, `updated_at` | `kind` is `MAIN_CHARACTER \| NPC_WORKER \| VEHICLE \| SHIP` by CHECK (only the first exists today); `control_mode` is `PLAYER_CONTROLLED \| AUTO_CONTROLLED`; **`UNIQUE (owner_player_id) WHERE kind = 'MAIN_CHARACTER'`** is "exactly one Main Character per player" |
| `actor_jobs` | `id` (`job_<uuid>`), `actor_id` FK CASCADE, `farm_id` FK CASCADE, `work_area_id` FK **RESTRICT**, `kind`, `target_definition_id`, `priority`, `enabled`, `auto_purchase_supplies`, `version`, timestamps | `kind` is the work-area vocabulary; `priority` is dense 1..24 (the domain's `MAX_JOBS_PER_ACTOR`); `enabled` is 0/1; `auto_purchase_supplies` is 0/1 (migration 0025, default 0 - an assignment never starts spending gold because a build shipped) and is the only policy the Auto supply ladder reads; indexes `(actor_id, priority, id)` and `(work_area_id, id)` |
| `actor_auto_state` | `actor_id` PK FK CASCADE, `anchor_kind` (`WAREHOUSE \| MARKET \| CELL`), `anchor_x`/`anchor_y`, `travel_kind`, `travel_x`/`travel_y`, `travel_arrives_at`, `version`, `updated_at` | Where an Auto-driven actor **is** (the last walk's anchor) and where it is **walking to**, with the time the server will consider it arrived. One row per actor, one guarded upsert per transition, no per-frame position, no path, no waypoint, no event log. The anchors are the only position state in the game (migration 0026) |

- An actor is not a player. `owner_player_id` is identity, and the actor's own id is what a job
  references - so a later slice's NPCs, carts and ships are new rows, not a re-identification.
- Activity (`IDLE`/`TRAVELLING`/`WORKING`/`HAULING`/`WAITING_FOR_STORAGE`) and the resolver's wait
  reasons are **not** persisted: only a working executor can produce the first, and a stored wait
  reason would go stale against the next read. `control_mode` is stored because V16.2.2D1's Auto switch
  writes it, and it is written by control alone - it moves no cargo, no assignment, no gold and no XP.
- **D1 can PLAN; D1 does not EXECUTE.** The plan is derived per read from the actor, its cargo, its
  assignments, its areas' cells, the farm's crops/trees/constructions, the zone's node states, the
  wallet and the warehouse. No table holds a plan, a step, a route, an activity or a simulation
  watermark.
- **D2 executes the replanting crop family**, and `actor_auto_state` is the whole of what it persists
  between steps: an anchor, a walk and an arrival time. `harvest_settlements.destination` (0026,
  default `WAREHOUSE`) is what lets one settlement rule feed either container: `CARGO` credits the
  actor's cargo through the same trigger, and the cargo capacity trigger is the authority on whether it
  fits.
- A job's target is a stable game-data id (`crop_*`, `tree_*`, `resource_*`) validated against the
  served catalogues; a translated label is never stored as authority.
- `work_area_id` is `ON DELETE RESTRICT`: an area named by a job cannot be deleted, and
  `DeleteWorkArea` refuses first with `WORK_AREA_IN_USE` so the player is told to remove the job.
- Reorder replaces the actor's whole order atomically under the actor's version; delete renumbers the
  survivors in the same transaction, so priorities are always dense and duplicate-free.
- Reads: `GET /farms/:id/workers` (the owner's Main Character and its jobs). Writes: create
  (idempotent), target, enabled, order, delete (version-guarded). All require OWNER.

## Actor cargo (V16.2.2C)

A **separate container** from the Home Warehouse. `inventory_items` is what is stored;
`actor_cargo_items` is what is being carried. Nothing moves between them except the one authoritative
transfer, and nothing about existing stock changes: every row that existed before this slice is, and
stays, warehouse inventory.

| Table / column | Notes |
| --- | --- |
| `actors.cargo_capacity` | Cargo units the actor can carry. Defaults to the game-data starter (30, provisional); a backpack, cart or ship is a different number for the same code |
| `actors.cargo_version` | The container's **own** version, separate from the actor's configuration version, bumped by every cargo mutation |
| `actors.cargo_transfer_id` | The request id of the transfer that last moved the container - the marker that makes one transfer provable, so a losing concurrent unload cannot pay out twice |
| `actor_cargo_items` | PK `(actor_id, item_definition_id)`; `quantity` 1.. (a zero row should be deleted); FK `actor_id` cascades; index `(actor_id, item_definition_id)`. Triggers `cargo_capacity_guard_insert`/`_update` `RAISE(ABORT, 'cargo_full')` |

- The unit is the warehouse's unit: one item is one cargo unit. Weight and volume are a later
  evolution, deliberately not invented now.
- Only physical stackables may be carried: `CARGO_ITEM_CATEGORIES` in the domain is the explicit
  boundary, and the grant primitive refuses anything outside it. Gold and experience are not items.
- The transfer is all-or-nothing and idempotent: one transaction moves every carried stack into the
  warehouse, or none of it, with the receipt that makes a replay a no-op. If the destination refuses,
  the cargo stays on the actor - the state a future executor reads as waiting for storage.
- Reads: `GET /farms/:id/cargo`. Writes: `POST /farms/:id/cargo/unload` (request id + expected cargo
  version). There is no grant route; authorized by farm ownership, like the rest of the worker panel.
- **Transitional**: manual production still settles to the warehouse while the cargo/transfer
  foundation is proven; the execution slices migrate those paths deliberately.

### Bidirectional cargo (V16.2.2C.6)

Both directions now exist, and both are one transaction with a receipt:

| Operation | Route | Effect |
| --- | --- | --- |
| LOAD | `POST /farms/:id/cargo/load` | `inventory_items` decreases by exactly the row state the caller read; `actor_cargo_items` grows; the container version advances; an emptied warehouse row is removed |
| PURCHASE | `POST /farms/:id/cargo/purchase` | the ordinary shop settlement (wallet + `SHOP_BUY` ledger row + receipt) with the goods landing in `actor_cargo_items` instead of `inventory_items` |
| UNLOAD | `POST /farms/:id/cargo/unload` | V16.2.2C, unchanged |

- **No new tables and no new columns**: LOAD reuses `actors.cargo_transfer_id` as its per-request
  marker, and a purchase reuses the existing cargo row plus the existing economy settlement. No
  migration exists for this slice.
- LOAD's guard is the cargo version *and* the exact warehouse row (quantity and version), so a
  concurrent sale fails the whole load rather than crediting cargo from a subtraction that did not
  happen; the cargo capacity trigger remains the authority on whether the goods fit.
- Only supply categories (`SEED` today) may be bought into cargo; the destination is always the
  authenticated owner's Main Character, and no route accepts an owner, a capacity or a price.
- Ordinary `POST /shop/buy` and all manual production still settle to the Warehouse.
