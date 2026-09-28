# Phase 4A review (implementation-side)

Review date: 2026-09-28
Reviewer: the implementation agent, on its own Phase 4A working tree
Baseline: `24c2d3d` (`feat: add a glTF crop model pipeline to the 3D view`)
Scope: `packages/domain/src/progression.ts`, `packages/application/src/progression.ts`,
`packages/application/src/harvest.ts`, `packages/contracts/src/index.ts`,
`packages/game-data/src/{progression,crops}`, `database/migrations/0005_player_progression.sql`,
`workers/api/src/{d1-repositories,handler,runtime,index,dev-index}.ts`,
`apps/web/src/{progression,api,main}.ts`, and the tests and documentation the phase touched.
Method: full read of every changed file, plus the ten questions in
`docs/reviews/AUDIT_PROMPT_PHASE_4A.md` used as a checklist, then `tsc --noEmit`, `eslint
--max-warnings=0`, the full unit suite, and the end-to-end development-backend smoke test against the
real development Worker entrypoint on the Node host.

**This is not an independent audit.** It was written by the same agent that wrote the code, so it is
a record of what was checked rather than a second opinion. The independent review for Phase 4A is
still outstanding. Nothing in this file has been reviewed by anyone else.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P1 | The settlement's concurrency guard tested the state the award *produces* (`xp = xpAfter AND level = levelAfter AND progression_version = expectedProgressionVersion + 1`) rather than the state the caller *read*. Because experience and the version each advance by one per award, a caller that had been overtaken by exactly one award predicted precisely the state it found, so the guard passed, the guarded `UPDATE` matched no rows, and the batch still committed. A harvest whose award lost that race credited its inventory and deleted its crop while awarding **no experience at all**, silently and with a 200 response. | Fixed |
| 2 | P2 | Nothing tested the `progression` member through the real HTTP handler. `tests/api/handler.test.ts` covered the shop, wallet, and tiles envelopes, and `tests/integration/progression-migration.test.ts` exercised the repository directly, so a wiring regression in `handler.ts` — a dropped field, a mis-shaped envelope — would have shipped with a green suite. | Fixed |
| 3 | P3 | The verification harness asserted `host.appliedMigrations.length === 4` by number, so adding migration `0005` turned a passing check into a misleading failure ("all four migrations were applied -> expected 4, got 5") instead of verifying anything. | Fixed |

### Detail on the fixed findings

Finding 1 is the reason this review exists. The guard is the only thing standing between a retry and
a lost or duplicated reward, and it was checking the wrong revision. The fix tests the pre-award
state, which is unambiguous precisely because `xp` and `progression_version` only ever increase: a
caller whose read has been overtaken can never match the current row, whatever reward it is carrying.
The guard also had to move *before* the `UPDATE`, since after the update the pre-award values are
gone. The comment on the statement now explains why, so the next person does not "simplify" it back.

The test that caught it was already in the tree and is the one that discriminates: against the old
after-state guard, `rejects an award computed from a state that has already moved on` resolved
instead of rejecting. A second case was added for the shape the old guard happened to reject by
accident — a stale caller whose own reward is *larger* than the one that landed — because accepting
that one would swallow the difference between the awards rather than merely dropping one. The
invariant the pair now states is the one that matters: after a committed settlement, the stored `xp`
is exactly `xpBefore + xpAwarded`.

Fix 2 adds one handler-level test covering the empty read, the award on the harvest response, the
post-harvest read agreeing with it, a replay answered from the stored award with the crop gone, a
spoofed `?playerId=&level=&xp=` query, and the 401. Fix 3 derives the expected migration list from
`database/migrations` instead of hard-coding a count.

## Answers to the audit questions

**1. Can the batch commit while `xp` is not `xpBefore + xpAwarded`?** No, now. The guard and the
`UPDATE` test the identical predicate — `player_id`, `xp = xpBefore`, `progression_version =
expectedProgressionVersion` — inside one transaction, with no statement between them that touches
`player_progression`, so a guard that passes implies an `UPDATE` that matches one row and writes
`xpBefore + xpAwarded`. Two harvests that read the same revision are settled one at a time; the
loser's guard matches nothing, the `CASE` yields `NULL`, and the batch aborts. A caller whose
expected version is *ahead* of the row cannot be produced by the use case, which reads the row
immediately before computing the award, and would in any case fail the same predicate on `xp`. The
`INSERT OR IGNORE` seed cannot interfere: it is a no-op when the row exists, and when it creates the
row it leaves exactly `(level 1, xp 0, version 1)`, which is the state `emptyProgression` models for
a player with no row.

**2. Is the `level`/`xp` pair internally consistent?** Yes, by construction: `award.levelAfter` is
`levelForXp(xpAfter)` computed by `createXpAward` from the same definition the process holds, so the
written pair is one `assertProgression` would accept. A game-data change between the read and the
write is not reachable inside one Worker: definitions are module constants, so a deployment either
has the old curve or the new one, and a running isolate cannot see a curve mutate under it. A
*deployment* that changes the curve is the interesting case, and it is handled by refusal rather than
by writing the disagreement forward: an existing row whose cached level the new curve would not
produce fails `assertProgression` inside `createXpAward`, and `HarvestCrop` maps that to
`INTERNAL_ERROR` instead of settling. That makes a curve change a migration concern — existing rows
must be recomputed or the curve left alone — which is worth remembering before `xpStep` is ever
tuned in a live game.

**3. Which constraint fires in each guard failure, and are they all mapped?** One failure mode, two
possible reporters, both mapped. With `operation = 'HARVEST_CROP'` and `status = 'COMPLETED'`, the
`NULL` actor matches no settlement in `idempotency_harvest_requires_settlement`, so that trigger
aborts with `completed harvest idempotency requires settlement` — this is the one that actually
fires, because a `BEFORE INSERT` trigger runs before the `NOT NULL` check. If that trigger were ever
removed or narrowed, `NOT NULL constraint failed: idempotency_keys` fires instead. Both messages, and
the monotonic trigger's `player progression cannot regress`, are mapped to `PROGRESSION_CONFLICT`.
The monotonic trigger is unreachable on the matched path — the update it guards always strictly
increases `xp` — and is kept as defence for a future code path that forgets the guard. Two other
errors are deliberately *not* mapped, because neither is a progression condition: a
`FOREIGN KEY` failure from the settlement insert (an actor with no `players` row) and
`invalid harvest settlement` from the pre-existing `harvest_settlement_validate`. Both are unchanged
by this phase and both surface as `INTERNAL_ERROR` (500) rather than as a misleading 409.

**4. Can the retry loop terminate without paying or without reporting?** No. Every `continue` is
taken only on `PROGRESSION_CONFLICT`, and none of the effects of the failed attempt survive, because
the aborted batch rolls back the settlement receipt, the inventory addition, the crop deletion, and
the idempotency row together. An attempt therefore either returns the award or leaves the world
exactly as the previous attempt found it, which is why re-reading is a correct retry rather than a
second payout. Two exits exist after the loop: the non-conflict path re-reads the idempotency record,
and if a racing request with the same request ID won, it replays that result instead of reporting a
failure; otherwise it distinguishes an already-harvested crop (`CROP_ALREADY_HARVESTED`) from a
genuine error and re-throws the latter. Exhausting `PROGRESSION_ATTEMPTS = 8` throws
`PROGRESSION_CONFLICT`, which the handler renders as a 409 the client can retry — the honest answer
for a player who lost eight consecutive races, and not reachable by one player harvesting one crop.

**5. Is the replay validation strict enough?** It is strict about shape and about the fields that
could be used to assert a reward, and weaker than the contract about bounds. `assertStoredAward`
requires a positive safe-integer `xpAwarded`, a boolean `leveledUp`, and five non-negative
safe-integer progression fields, and `replay` separately re-checks that the stored `cropInstanceId`
matches `resourceId` and that both IDs still parse. It does **not** re-derive `levelForXp(xp)` or
apply `maxLevel`, so a hand-edited row could store a self-consistent-looking pair the curve would
not produce. That is not reachable through the API — the row is written only by the settlement, and
the stored result is never client-supplied — and the client would in any case reject an out-of-range
payload, because `PlayerProgressionDTOSchema` bounds `level` by `MAX_PROGRESSION_LEVEL` and is
strict. It is recorded as a known limit rather than a defect. `replay` also wraps everything in a
`try` that converts any failure into `INTERNAL_ERROR`, so a malformed stored result cannot escape as
an unexpected error type.

**6. Is the award amount validated, and can a crop silently have none?** Yes. `xp` is a required
strict `z.number().int().positive().max(1_000_000)` on `CropDefinitionSchema`, so a missing, zero,
negative, fractional, or absurd value fails game-data loading rather than defaulting to zero, and
`createXpAward` re-checks positivity and `MAX_XP_AWARD` in the domain before any statement is
prepared. The domain and schema maxima are separately declared (`MAX_XP_AWARD` and the literal in
the game-data schema) and currently agree at 1,000,000; the domain value is the one the settlement
enforces.

**7. Does the migration enforce what the code assumes?** The foreign key
(`ON UPDATE/DELETE RESTRICT`), the three `CHECK`s, and the monotonic trigger are all present and
covered by `tests/integration/progression-migration.test.ts`, including the deletion refusal and the
three regression cases. One state the trigger still permits is exactly the one the domain refuses: a
row whose cached `level` disagrees with `levelForXp(xp)` while still satisfying `NEW.level >=
OLD.level` (for example `xp 0 -> 400` with `level` left at 1). SQL cannot recompute the curve, which
is why the migration header says so explicitly and why `assertProgression` exists. That split is
deliberate: the database owns monotonicity, the domain owns the curve.

**8. Does `GET /progression` write anything, and read only the actor?** It writes nothing: for a
player with no row it reads `null` and substitutes `emptyProgression`, and the two handler-level
assertions in `tests/api/handler.test.ts` check both the level-1 answer and that
`player_progression` still has zero rows afterwards. It reads only `actor.playerId` from the
authenticated context, and the spoofed-query assertion confirms that `?playerId=`, `?level=`, and
`?xp=` change nothing.

**9. Does the client compute a threshold or accept a levelling input?** No threshold, and no input.
`progressionSummary` formats `level`, `xp`, `xpIntoLevel`, `xpForNextLevel`, and `maxLevel` exactly
as received and computes only `xpIntoLevel / xpForNextLevel` for the bar's width, clamped to `0..1`.
Two things that are not curve arithmetic but are worth naming: the detail string derives the next
level's *number* as `level + 1`, which is an ordinal and not a threshold, and the cap is recognised
from the server's own `level >= maxLevel` or a zero span rather than from a constant. `main.ts`
validates every response against the `@happy-farm/contracts` schemas before use, and it takes the
displayed state from `GET /progression` after a harvest rather than from the award, so the page
cannot drift from the server even if another harvest landed in between.

**10. Are the new tests able to fail?** The discriminating one is
`rejects an award computed from a state that has already moved on`: it fails against the after-state
guard, which is how finding 1 was found, and it passes against the pre-award guard. The companion
case for a stale larger award documents the same invariant for the shape the old guard rejected by
accident, so it is a regression guard for the *class* rather than for the instance. The
migration-level assertions are schema-level (`expect(() => insert.run(...)).toThrow(/CHECK/i)`), which
real mutation testing would like better than a behaviour-level equivalent. Still uncovered: the
`PROGRESSION_ATTEMPTS` exhaustion path, which needs a settlement that conflicts eight times in a row
and is not reachable from a test without a fake repository; and the client's rendering itself, which
only `tests/web/progression-summary.test.ts` reaches at the level of the pure summary.

## Not verified

- **True parallel concurrency was not exercised.** Native `workerd` cannot start on this Windows
  host (`0xc0000005`), and the Node host serialises batches rather than running them in parallel, so
  the guard is verified against *interleavings constructed from sequential calls*, not against two
  Workers contending inside D1. This is the same outstanding condition 5 from
  `docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md`, now with one more table relying on it. Settling
  it needs either a Linux/WSL runtime or a deployed development Worker, and the concrete action is:
  two harvests on one farm issued simultaneously, asserting that the stored `xp` equals the sum of
  both awards.
- `npm run build` (Vite) could not be run by the reviewing agent. `apps/web/src/progression.ts`
  imports only an erased type, so it adds no runtime dependency to the bundle; the new panel markup
  and CSS are static. Confirm on the next build.
- No browser was driven, so the Progression panel was not observed rendering. One manual pass is
  needed: bootstrap, harvest a carrot, and confirm the panel reads `Level 1` with `4 / 120 XP to
  level 2` and the status line reports `+4 XP`.
- The end-to-end smoke test was run against the real development Worker entrypoint on the Node host
  and passes 99/99 checks, including the persisted row, the replay, the spoofed query, and the 401.
  It exercises the API, not the browser client.
- The open findings from the Phase 3.6B and 3.6C reviews are unchanged and still open; this phase
  does not touch the renderer.

## Verdict

Complete for its stated scope, and it caught a real defect in itself: the settlement guard was
testing the predicted result instead of the read revision, which turned a lost race into silently
unpaid experience. Two P2/P3 gaps were closed with it. The suite is green at 32 files / 259 tests,
`tsc --noEmit` and `eslint --max-warnings=0` are clean, and the live development backend passes
99/99. Independent review, one manual browser pass, and a genuine parallel-D1 contention test are
the remaining gates.
