# ADR 0003: Crop simulation and planting idempotency

Status: Accepted

## Decision
- `crop_instances(farm_id, tile_x, tile_y)` is the only authoritative crop-occupancy record. Tiles do not store a crop ID or occupancy flag.
- Persist `planted_at` from server time. Derive progress, visual stage, and maturity from the validated definition and the current server time; no crop timers or background stage updates exist.
- For `growthStages = N`, stages are `0..N-1`. Before maturity, elapsed time maps deterministically across stages `0..N-2`; exact maturity enters stage `N-1`.
- Planting uses a guarded crop insert and a generic idempotency record in one atomic D1 batch. A database trigger aborts the batch if a completed plant result does not reference the actor's inserted crop.
- Idempotency is scoped by actor, operation, and request ID. Same fingerprint replays the original crop; a different fingerprint returns `IDEMPOTENCY_CONFLICT`. Validation failures are not recorded.

## Harvest boundary
Phase 2A calculates maturity and harvest eligibility only. It does not remove crops, grant items, mutate inventory, award XP, or settle currency. Atomic harvest settlement waits for the inventory/economy receiving systems.

## Definition integrity
Crop definition IDs are validated through the in-process game-data registry before persistence. They intentionally do not reference a nonexistent D1 definitions table.
