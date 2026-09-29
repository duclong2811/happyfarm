# ADR 0009: Crop unlocks by player level

Status: Accepted (pending independent security/architecture audit before commit)

## Problem

Phase 4A made player level a real, server-derived, never-decreasing number. Phase 4B has to make it
mean something in the planting loop: crops a player has not reached should not be plantable, and the
client has to be able to say *why* one is not.

`CropDefinition` already carried a `requiredFarmLevel?: number` field — in the domain type, in the
game-data zod schema, and in the `GameDataCropDefinitions` mapping — but nothing set it, and
`CropStateProjector.project` actively **threw** `INVALID_INPUT "Crop level requirements are not
available in Phase 2A"` if a definition ever did set it. It was a trap, not a feature: the field
looked supported, was type-checked in three layers, and would have broken crop reads for every
player in the farm the moment a designer used it.

Three things needed deciding: what the field means, where the rule is enforced, and how the client
learns which crops exist.

## Decisions

### The field is renamed `requiredLevel` and means the *player's* level

- A farm has no level of its own, so `requiredFarmLevel` named the wrong thing. Progression is the
  single source of a level, and `packages/domain/src/progression.ts` is the only thing that computes
  one.
- `requiredLevelFor(definition)` resolves the optional field to a number, with **absent meaning
  level 1** — the level every player starts at. `isCropUnlocked(definition, level)` is the only rule
  that interprets it, and it is a pure function in `packages/domain/src/crop.ts`, so the decision is
  testable without a database or an HTTP request.
- `isCropUnlocked` requires `Number.isSafeInteger(level)` before comparing. A level that is not a
  real level — negative, fractional, `NaN`, infinite — locks the crop rather than unlocking it,
  because the failure that matters is granting access the player has not earned.
- The rule does not normalise a malformed *requirement*, because it does not have to: game data is
  validated by the zod schema at module load, and an unreadable requirement (`NaN`, fractional) fails
  closed anyway. `tests/game-data/schema.test.ts` is the boundary that forbids a requirement that is
  zero, negative, fractional, or above the level ceiling of 10,000 — the same ceiling
  `CropDefinitionDTOSchema` validates against and `player_progression.level` is checked against — so
  the domain rule never sees one in a running Worker, and a crop whose requirement the API contract
  would reject cannot reach a deployment.

### Unlocks are explicit game data, not a derived formula

- `packages/game-data/src/crops/index.ts` sets `requiredLevel: 2` on wheat and `requiredLevel: 3` on
  corn. Carrot sets nothing, so it is the starting crop.
- A formula — "unlock by experience yield", "unlock by duration" — would have been shorter and would
  have put a gameplay decision somewhere no designer would look. The explicit field is reviewable in
  one diff, and `tests/game-data/schema.test.ts` holds the invariants that keep it sane: a
  requirement is a positive whole number, within the level cap, and exactly one crop is available at
  level 1 so a new player is never stuck.

### The gate lives in `PlantCrop`, the single planting write path

- `PlantCrop.execute` reads the actor's progression after the ownership, tile, and definition checks
  and before `plantAtomically`, and throws `CROP_LEVEL_REQUIRED` when the crop is locked.
- The level is re-derived from the stored experience by `storedLevel`, not read from the row's cached
  `level` column, so a row whose cache disagrees with its experience cannot unlock anything. A player
  who has never earned experience is level 1, exactly as `GET /progression` reports.
- The requirement is read from game data, which is a module constant for the life of a deployment, so
  there is no version to guard here: the crop either is or is not unlocked for the whole deployment.
  Retuning the curve later can lock a crop a player could plant yesterday; it never affects a crop
  already in the ground, because reading is not gated. A curve change is not free in the other
  direction either: it also has to rewrite the cached level every progression row was written with,
  or the next harvest for those players is refused. ADR 0008 records that consequence and the data
  step it requires.
- A refusal writes nothing — no crop row, no idempotency record — so the request id stays usable
  once the player reaches the level. The gate sits ahead of id, fingerprint, and settlement work for
  the same reason.

### A new error code, `CROP_LEVEL_REQUIRED` (403)

- The existing codes were wrong for this: `NOT_AUTHORIZED` means "not allowed on this farm", and
  `INVALID_INPUT` (400) would call a well-formed command malformed.
- The failure envelope carries only `{code, requestId}` — no message, no number — so the refusal
  cannot leak a curve the client has not been shown. The client already knows its own level from
  `GET /progression` and the requirement from the catalogue, so it can explain the refusal itself.
- The `ApplicationError` message does name both levels, but only for logs and test assertions; it is
  never sent.

### The crop catalogue is served, not compiled into the client

- `GET /crop-definitions` (authenticated) returns every crop this deployment can plant:
  `{ cropDefinitionId, growthDurationSeconds, harvestItemDefinitionId, baseQuantity, harvestXp,
  requiredLevel }`. It is a pure projection of game data — no database read, no mutation, no player
  state — and `requiredLevel` is resolved to a number so the client never infers a rule from a
  missing field.
- The development UI had `PLANTABLE_CROPS = ["crop_carrot", "crop_wheat", "crop_corn"]` compiled
  into `apps/web/src/labels.ts`. A hardcoded list is a second source of truth that drifts silently:
  add a crop to game data and the client cannot plant it; remove one and the client offers a crop
  the server rejects. The list is deleted, and the planting control is built from the catalogue.
- **Locked crops are listed, not hidden.** The client disables the option and labels it
  `Wheat (level 2)`, which is the only way the UI can tell a player what to work towards. The server
  still refuses the command, since a disabled `<option>` is not a security boundary.

### Unlocks are permanent, and reading is not gated

- `CropStateProjector.project` no longer throws. A crop that is already planted keeps reporting its
  growth even if a later curve would have locked it, and `GET /farms/:id/crops` never filters by
  level. Gating a read would break a farm's history and could hide a crop from the only player who
  can harvest it.
- Expiring or consumable unlocks — a temporary boost, a rented plot — are deliberately out of scope.
  They need a different model (a timed entitlement, not a monotonic level) and a different storage
  decision, and nothing in this phase forecloses them.

## Consequences

- The level now gates gameplay, not just display: it is the first thing in the game a player has to
  earn before doing it, and the harvest settlement that pays experience is also what unlocks the
  next crop.
- The dead field is gone. There is one reader of `requiredLevel` (`requiredLevelFor`), one
  interpreter (`isCropUnlocked`), one enforcement point (`PlantCrop`), and one place a designer sets
  it (game data).
- The client's crop list can no longer drift from the server's. `tests/web/farm-assets.test.ts` now
  checks the model manifest against the game-data registry rather than against a client constant,
  and the chain is: game data → shipped model → file on disk.
- Farm expansion, the other half of Phase 4, remains open. `player_progression` is the state it will
  read, not the feature itself.
