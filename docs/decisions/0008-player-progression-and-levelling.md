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
- Farm expansion and unlocks, the rest of Phase 4, are not covered here. `player_progression` is the
  state they will read, not the feature itself.
