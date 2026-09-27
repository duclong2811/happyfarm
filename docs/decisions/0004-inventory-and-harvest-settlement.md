# ADR 0004: Inventory and harvest settlement

Status: Accepted

## Decision
- `inventory_items(player_id, item_definition_id)` is the authoritative stack for each player/item pair. Quantities are bounded integers and are never client supplied.
- The application `InventoryService` validates item definitions and creates inventory additions. No generic HTTP inventory mutation endpoint exists.
- `harvest_settlements` is an immutable command receipt and claim on one crop instance. Its unique crop constraint prevents two request IDs from settling the same crop.
- A settlement trigger validates the current owner membership, crop identity/version/definition, and inventory capacity, then atomically upserts inventory and deletes the authoritative crop row.
- The settlement and generic idempotency result are committed in one D1 batch. Any failure rolls back the inventory addition, crop deletion, settlement receipt, and idempotency result.
- Inventory increments use an atomic SQLite upsert, preventing lost updates when distinct crops reward the same item concurrently.

## Definition integrity
Item definitions remain validated static game data rather than D1 rows. Crop definitions are checked against the item registry when game data loads, and application services validate the item again before creating a mutation.

## Replay and authorization
Harvest replay is scoped by actor, operation, request ID, and payload fingerprint. The farm and current permission are rechecked before a stored result is returned. Farm deletion therefore returns the normal missing-resource response rather than exposing stale protected data.

## XP decision
XP is intentionally deferred to the progression phase. Adding it now would create a second persistent reward system and broaden the atomic settlement boundary beyond the inventory foundation.
