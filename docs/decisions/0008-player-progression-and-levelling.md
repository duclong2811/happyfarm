# ADR 0008: Player progression, levels, and experience

Status: Accepted (pending independent security/architecture audit before commit)

## Problem

Every reward the game pays out until now has been an item or currency. Phase 4 introduces
experience: a second kind of permanent, never-decreasing player state that must be awarded inside
the same atomic boundary as the harvest that earned it, must never be client-authored, and must not
be paid twice by a retry.

Three questions needed deciding: where the curve lives, how an award becomes durable, and how a
stored level stays consistent with the experience it is derived from.

## Decisions

### The curve is game data; the arithmetic is domain

- `packages/game-data/src/progression/index.ts` holds the numbers: `{ maxLevel: 50, xpStep: 120 }`.
  `packages/domain/src/progression.ts` holds the arithmetic and knows nothing about the values.
- The curve is triangular: reaching level `n + 1` from `n` costs `n * xpStep`, so the total to reach
  level `L` is `xpStep * (L - 1) * L / 2`. At the shipped values that is 147,000 experience to the
  level-50 cap.
- `levelForXp` is a binary search over the curve rather than a closed-form inverse. The comparison
  stays exact in integers, and the loop is bounded by the level cap instead of the experience total.
- Experience amounts per crop live in `CropDefinition.harvest.xp` — domain type, zod schema, and the
  `GameDataCropDefinitions` mapping — so a reward cannot be introduced without a definition to
  justify it. Application code never hardcodes an award.

### Level is derived from experience and never accepted as input

- `PlayerProgression.level` is a **cache** of `levelForXp(xp)`, stored so reads do not recompute it.
  `assertProgression` refuses a row where the two disagree, because such a row could not have been
  produced by this curve and awarding against it would write the corruption forward.
- No command accepts a level, an experience total, or a threshold from a client. `GET /progression`
  is a projection; the harvest is the only path that writes experience, and the amount comes from
  the crop definition of the crop that was actually harvested.
- An over-large award is refused in the domain (`PROGRESSION_LIMIT_EXCEEDED`) rather than clamped,
  so a settlement can never silently pay less than it reported.

### The award is part of the harvest settlement, not a command of its own

- `HarvestSettlementRepository.settleHarvestAtomically` takes an `XpAward` and writes it in the same
  D1 batch as the settlement receipt, the inventory addition, the crop deletion, and the
  idempotency record. Either the crop is harvested and the experience is paid, or neither happened.
- There is deliberately no separate "award experience" endpoint. An award that could be requested on
  its own would be a second way to earn experience, and a retry would have to be defended against
  twice. Inside the settlement, the existing harvest idempotency record already covers it: a replayed
  harvest returns the stored award rather than recomputing one.
- The stored response is the award as it was at the time of the original call. A replay therefore
  reports the level the player had then, not the level they have now — recomputing it would report a
  level the response never caused.

### Rows are created lazily, and conflicts are detected against the pre-award state

- A progression row is created by the first award, exactly as a wallet row is created by the first
  settlement. "No row" is a normal state, not an error, and the development bootstrap is still
  required to create only the player.
- The settlement seeds the row with `INSERT OR IGNORE` and applies the award with a guarded update,
  both inside the batch.
- The concurrency guard tests the state the caller *read*, not the state it expects to produce.
  Experience and the progression version only ever increase, so a caller whose read has been
  overtaken can never match the current row. An after-state check cannot tell such a caller apart
  from one whose own award already landed, because both predict the same experience total and the
  same next version — and a stale caller with a *larger* reward would then settle onto a running
  total and silently swallow the experience in between.
- SQLite cannot fail an `UPDATE` that matches no rows, so the guard is a `CASE` that yields `NULL`
  when the predicate fails; the batch then aborts on a `NOT NULL` or harvest-idempotency constraint.
  The D1 adapter maps those messages to `PROGRESSION_CONFLICT` (409) and the use case re-reads and
  retries, up to `PROGRESSION_ATTEMPTS`.
- A database trigger makes `xp`, `level`, and `progression_version` unable to move backwards, so even
  a future code path that forgets the guard cannot mutate progression into an earlier state.

## Consequences

- Progression correctness rests on one invariant — the settlement is atomic and the guard tests the
  read revision — instead of on every caller being careful.
- Read routes stay side-effect free: `GET /progression` for a player who has never earned experience
  reports level 1 and writes nothing.
- A lost race costs a round trip rather than experience, because the whole batch rolls back and the
  retry runs the same command against fresh state.
- The level cap is a data value. Raising it changes `maxLevel` in game data and nothing else; the
  domain arithmetic and the schema bounds (`MAX_PROGRESSION_LEVEL`) still have to be raised together,
  which is why the contract exports the bound it validates against.
- **A curve change has to rewrite the cached level in the same deployment.** The stored `level` is a
  cache of `levelForXp(xp)` under the definition that wrote it, and `assertProgression` refuses a row
  where the two disagree. That is the right reading of a corrupt row, but it also means retuning
  `xpStep` or lowering `maxLevel` — which ADR 0009 explicitly contemplates — leaves every row written
  under the old curve disagreeing with the new one. The next harvest for each of those players is then
  refused with `INTERNAL_ERROR` instead of awarding experience, and the player cannot earn their way
  out of it, because experience is only awarded by the harvest that is now failing. Reads are
  unaffected while the cache is stale (`GET /progression`, the planting gate, and the harvest's own
  response all derive the level from `xp`), so the impact is confined to the write path.

  A retune therefore ships with a D1 step, and that step has to lift the monotonic guard to run:
  `player_progression_monotonic_update` aborts any update where `NEW.level < OLD.level`, which is
  exactly what lowering the cap does. The whole rewrite goes in one migration file, which D1 (and the
  development runner) commits as a single transaction, so no reader ever sees the trigger missing:

  ```sql
  DROP TRIGGER player_progression_monotonic_update;
  UPDATE player_progression SET level = <levelForXp(xp) under the new curve>, updated_at = <now>;
  -- the verbatim DDL from database/migrations/0005_player_progression.sql
  CREATE TRIGGER player_progression_monotonic_update
  BEFORE UPDATE ON player_progression
  WHEN NEW.xp < OLD.xp OR NEW.level < OLD.level OR NEW.progression_version <= OLD.progression_version
  BEGIN
    SELECT RAISE(ABORT, 'player progression cannot regress');
  END;
  ```

  The `level` clause of the guard is worth keeping rather than deleting. Experience is the only value
  that can never go backwards, but `assertProgression` refuses a row whose level disagrees with its
  experience, so a write path that lowered the level without lowering `xp` would strand that player's
  harvest in exactly the way a retune does. Lifting the guard for the one procedure that has to lower
  the cache, and putting it straight back, keeps that detector without blocking the retune.
  `tests/integration/progression-migration.test.ts` pins all three states: the plain rewrite aborts
  with `player progression cannot regress`, the rewrite with the guard lifted commits, and the guard
  is enforced again afterwards.
- Farm expansion and unlocks, the rest of Phase 4, are not covered here. `player_progression` is the
  state they will read, not the feature itself.
