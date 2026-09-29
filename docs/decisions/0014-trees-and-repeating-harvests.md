# 0014 - Trees and repeating harvests

Status: implemented; migration `0008` and the repeating-harvest invariants are verified on the
staging D1 database (`happy-farm-staging`, 2026-09-29). A manual browser pass is still pending.
Phase: 6 (backend `6B.1`-`6B.5`, client `6C`).

## Context

Crops are one-shot producers: a seed is spent, the crop grows on server timestamps, one harvest pays
produce and experience, and the crop is removed. The farm needed a second pattern that pays
repeatedly from the same tile, and it needed one that does not make the crop path - which already
runs in production, with migrations, concurrency tests, and stored player state - any riskier.

Three shapes were considered:

* **A: extend `crop_instances`** with a nullable harvest anchor and per-cycle semantics.
* **B: a separate `tree_instances` aggregate** beside crops.
* **C: generalize both into one production entity** (`plant_instances`).

## Decision

**B.** Trees are their own table and their own use cases, and the crop path is untouched:

* `tree_instances` holds one row per planted tree: `id` (`treeinst_*`), `farm_id`, tile, definition,
  planter, `planted_at`, `last_harvested_at` (null until the first harvest), `version`, timestamps,
  `UNIQUE(farm_id, tile_x, tile_y)`, and foreign keys to `farms`, `farm_tiles(farm_id, x, y)`, and
  `players`.
* `tree_harvest_settlements` holds one receipt per settled cycle: `UNIQUE(tree_instance_id,
  tree_version)`, where `tree_version` is the revision the tree was at *before* the harvest.
* `0008_tree_instances.sql` also adds the two cross-occupancy triggers described below, and it does
  not modify any object created by `0001`-`0007`.

## Consequences

**Only three fields carry lifecycle state.** `planted_at`, `last_harvested_at`, and `version`, plus
the definition's two durations. Readiness, phase, remaining time, and growth stage are derived from
those on every read:

```text
cycleStart = last_harvested_at ?? planted_at
duration   = last_harvested_at === null ? firstReadySeconds : regrowSeconds
readyAt    = cycleStart + duration
ready      = serverNow >= readyAt
```

Nothing stores `nextHarvestAt`, `ready`, or a harvested-cycle count, so a duration change re-derives
consistently instead of stranding a cached answer - the failure mode that ADR 0008 documents for the
cached progression level. A ready tree stays ready: time away is not accumulated into further
cycles, so one ready tree is worth exactly one harvest however long the player was gone.

**A cycle is identified by a revision.** Harvesting takes `expectedTreeVersion` and the settlement
advances the tree's version in the same transaction that pays it, so `UNIQUE(tree_instance_id,
tree_version)` means one cycle can settle at most once while the next cycle is a different revision
and can be harvested again. Crops keep their simpler `UNIQUE(operation, crop_instance_id)` because a
crop has exactly one cycle.

**The database refuses a tile with two occupants.** `crop_instances` and `tree_instances` each carry
`UNIQUE(farm_id, tile_x, tile_y)`, and because SQLite cannot express a cross-table unique constraint,
`0008` adds a `BEFORE INSERT` trigger on each table that refuses the insert when the other table
already holds that tile. Whichever batch lands second sees the first row and aborts as a whole. The
application checks the same rule first so the player reads `TILE_OCCUPIED` rather than a storage
failure, but the database is what makes it true under a race.

**The reward stays server-owned.** A tree harvest reuses the crop harvest's settlement shape: the
fruit comes from the definition (never from the request), the inventory credit and the cycle advance
commit together, the experience award is computed from the stored progression row with a
pre-state guard and the same retry loop, and the whole batch is one D1 transaction. Idempotency uses
the shared `idempotency_keys` table with `PLANT_TREE`, `HARVEST_TREE`, and `REMOVE_TREE` receipts, so
a replay returns the original answer and a lost race rolls back rather than paying twice.

**Removing a tree pays nothing.** It is the crop uproot path's shape: authorize, replay, check the
revision, then delete the row and record one receipt. No fruit, no experience, no sapling refund.

**No generic repeating-producer framework.** The repeating part is genuinely small - two durations, a
derived countdown, and a per-cycle receipt - and the only other producers that exist are placeholders.
Extracting a shared abstraction now would mean rewriting a crop path that has production data for the
benefit of a second implementation that does not exist yet, so the timing helper lives in
`packages/domain/src/tree.ts` and the settlement mirrors the harvest one. If animals or machines later
show the same shape, the extraction will be driven by two real implementations instead of one guess.

## Client

The client renders only what the server projected: `phase`, `ready`, `readyAt`, `secondsUntilReady`,
`growthStage`, and `growthProgress`. It maps those to four visual stages (`SAPLING`, `GROWING`,
`READY`, `REGROWING`) and never decides maturity, never computes a reward, and never treats a local
countdown reaching zero as authorization - a countdown is display text, and the action it might
suggest is refused by the server if the server disagrees. Occupancy in the view model is
`SOIL && crop === null && tree === null`, so a tile holding a tree is never offered for planting.

## Alternative C, revisited

Option C remains the eventual shape if several producers end up sharing more than timing: one
`tile_occupancy` table keyed by `(farm_id, tile_x, tile_y)` is the additive path to multi-tile
footprints and to a single "what is on this tile" answer. It is deliberately not built now: it would
require backfilling every crop and tree row and changing both settlement paths, for a benefit no
shipped feature needs yet.
