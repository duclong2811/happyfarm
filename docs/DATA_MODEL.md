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
4. Create all required initial farm metadata/state.
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

### crop_instances
- id PK
- farm_id FK
- tile_x
- tile_y
- crop_definition_id
- planted_at
- last_watered_at nullable
- version
- created_by
- created_at
- updated_at
Constraints: at most one active crop per valid tile; definition ID validated by application/game-data.
Indexes: farm_id; (farm_id,tile_x,tile_y)

### tree_instances / animal_instances / building_instances
Follow the same pattern: stable instance ID, farm ID, definition ID, logical position, authoritative state anchors/timestamps, version, creator, timestamps.

### inventory_items
- player_id FK
- item_definition_id
- quantity
- updated_at
UNIQUE: (player_id, item_definition_id)
Constraint: quantity >= 0 unless a specific design says otherwise.

### wallets
- player_id FK
- currency_type
- balance
- updated_at
UNIQUE: (player_id, currency_type)

### economy_ledger
- id PK
- player_id FK
- currency_type
- delta
- reason
- reference_id nullable
- request_id nullable
- balance_before
- balance_after
- created_at
Indexes: player_id+created_at; request_id
Never delete or rewrite normal ledger history as part of routine gameplay.

### player_progression
- player_id PK/FK
- level
- xp
- progression_version
- updated_at

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
- response_hash or stored response metadata
- created_at
- expires_at nullable
UNIQUE: (actor_player_id, request_id, operation)

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
