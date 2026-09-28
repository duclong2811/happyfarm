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
plantable land. `CreateFarm` therefore inserts a `6 x 6` square of `SOIL` tiles anchored at the
origin (`(0,0)` through `(5,5)`), all at `tile_state = IDLE` and `version = 1`, in the same
transaction as the farm row and its `OWNER` membership. `INITIAL_LAND_SIZE` in `packages/domain`
is the single source of the side length; `createInitialFarmTiles` is the only producer. A farm is
never observable with a partial starter square. Reading that land back requires the authenticated
`GET /farms/:farmId/tiles` route, which returns each tile's authoritative `version`.

`terrain_type` uses the initial stable enum-like values `GRASS`, `SOIL`, `WATER`, and `BLOCKED`. Terrain and mutable tile state are separate concepts. Phase 1 uses the minimal `tile_state` value `IDLE`; later states require an explicit schema/game-data change. Runtime validation and database constraints where practical must reject arbitrary client-provided terrain or state strings.

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

Constraints: at most one active crop per valid tile; definition ID validated by application/game-data.
Indexes: farm_id; (farm_id,tile_x,tile_y)

### tree_instances / animal_instances / building_instances
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

Only successful planting and harvest commands are recorded. A retry by the same actor with the same operation, request ID, and payload fingerprint returns the original result after current resource access is re-authorized. Reusing that identity with a different payload returns `IDEMPOTENCY_CONFLICT`. Failed validation is not recorded and may be corrected and retried.

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
