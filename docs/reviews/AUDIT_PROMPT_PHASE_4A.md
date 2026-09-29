# Independent audit request: HappyFarm Phase 4A (player experience and levels)

You are an independent reviewer. You did not write this code. Your job is to find defects, not to
confirm that the work is good. A finding of "nothing wrong" is only useful if you can say what you
checked and what you could not check.

## Project

Browser farm game at `C:\Project\HappyFarm`. Cloudflare-native and server-authoritative:

- TypeScript monorepo: `packages/{domain,application,contracts,game-data}`, `workers/api`,
  `apps/web` (plain TypeScript + Vite, no React), `tests/`.
- Cloudflare Workers + D1 in production. Development uses a Node host for the same Worker
  entrypoint because the native `workerd` runtime crashes on this Windows machine.
- The client is not authoritative about economy, inventory, time, rewards, progression, or player
  identity.

## What to audit

Phase 4A: harvesting now awards experience, and a level is derived from that experience. There is no
separate "award experience" command — the award is part of the harvest settlement.

Artifacts to attach to the conversation (all of them, not a summary):

1. The Phase 4A commit as a single unified diff:

   ```text
   git diff 24c2d3d 4e7b89c > happyfarm-4a.diff
   ```

   `24c2d3d` is the Phase 3.6C commit it sits on.
2. The full current contents of these files, because a diff hides their surroundings:
   - `packages/domain/src/progression.ts`
   - `packages/application/src/progression.ts`
   - `packages/application/src/harvest.ts`
   - `database/migrations/0005_player_progression.sql`
   - `workers/api/src/d1-repositories.ts` (the whole file; the settlement and the progression
     repository are the parts that matter)
   - `packages/contracts/src/index.ts`
   - `packages/game-data/src/progression/index.ts`
   - `tests/integration/progression-migration.test.ts`
   - `tests/domain/progression.test.ts`
3. `docs/decisions/0008-player-progression-and-levelling.md`.

Commits `dc036be` (Phase 3, 3.5A, 3.5B) and `24c2d3d` (3.6A–3.6C) are already audited; their
findings are in `docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md` and the two Phase 3.6 reviews. Do
not re-audit the economy, the development authentication bridge, or the renderer. Only report an
issue there if Phase 4A introduces or exposes it.

## Invariants this phase must not break

Judge each one and say how you verified it:

1. Experience is awarded **only** inside the harvest settlement. There is no second write path to
   `player_progression`, and no level, experience total, award amount, or threshold is ever accepted
   from a client.
2. `level` is always `levelForXp(xp)` for the definition in use. A stored row where the two disagree
   is refused, never written forward and never returned as valid.
3. Experience never decreases, and every settled award advances `progression_version`. A stale or
   concurrent award fails the **whole** batch — settlement receipt, inventory addition, crop
   deletion, and idempotency record included — or none of it happened.
4. A replayed harvest returns the award stored by the original call, including the level at that
   moment, and cannot pay experience twice.
5. `GET /progression` is a pure projection for the authenticated actor. It creates no row, writes
   nothing, accepts no identity or levelling input, and reveals nothing about another player.
6. Domain progression codes (`INVALID_PROGRESSION`, `PROGRESSION_LIMIT_EXCEEDED`) are not part of the
   API error vocabulary and never reach a client.
7. Production authentication is untouched: `workers/api/src/index.ts` still fails closed, and the
   development bootstrap still creates only the configured player — no wallet, inventory, farm,
   crop, currency, or experience.
8. The client reimplements no part of the curve. `apps/web` formats what the server derived and
   computes only a display fraction.

## Specific questions to answer

1. `settleHarvestAtomically` guards the award with a `CASE` that yields `NULL` when
   `player_progression.xp` and `progression_version` do not match the values the caller read, and it
   places that guard **before** the `UPDATE`. Construct the interleavings this must reject. Is there
   any ordering, in one SQLite transaction or across two serialized D1 batches, in which the batch
   commits while the stored `xp` is not exactly `xpBefore + xpAwarded`? Consider two harvests that
   read the same revision, a caller whose expected version is *ahead* of the stored row rather than
   behind it, and the `INSERT OR IGNORE` seed when the row already exists.
2. The `UPDATE` writes `level = award.levelAfter` alongside `xp = award.xpAfter`. Is that pair
   internally consistent by construction? What happens if the level curve in game data changes
   between the caller's read and the write, and is the resulting row one `assertProgression` would
   accept?
3. Each failure mode of that guard reports a different SQL constraint. Enumerate them, say which one
   actually fires in each case, and confirm that every one is mapped to `PROGRESSION_CONFLICT`. Is
   there a failure of the guard that maps to something else and would surface to a client as an
   internal error or, worse, be swallowed?
4. Trace the retry loop in `HarvestCrop.execute`. Can it terminate without either applying the award
   or reporting a failure to the caller? Can any attempt pay experience twice, or pay it while the
   crop survives, or delete the crop without paying? Is `PROGRESSION_ATTEMPTS = 8` a bound that can
   be reached in practice, and what does the caller see when it is?
5. The idempotency record stores the whole response as JSON and `replay` re-validates it before
   returning. Is that validation strict enough that a corrupt, truncated, or hand-edited stored award
   cannot be echoed to a client as a valid progression? Look for a field that is accepted without a
   bound check, and for anything that could throw an unexpected error type out of `replay`.
6. Is `CropDefinition.harvest.xp` validated for every crop, and are zero, negative, non-integer, and
   absurdly large awards rejected before they reach the settlement? Does a missing `xp` on one crop
   fail game-data loading, or silently become zero?
7. Does the migration enforce what the code assumes — the foreign key, the bounds, the monotonic
   trigger — and is there a state the trigger still permits that the domain would refuse?
8. Does `GET /progression` for a player with no row write anything, and does it read only the
   authenticated actor?
9. Does anything in `apps/web` compute a threshold, decide a level, or accept a level or experience
   value as input? Is the displayed fraction derived only from server-provided numbers?
10. Are the new tests able to fail? Identify any test that would still pass with the rule it claims
    to protect broken. In particular: does
    `tests/integration/progression-migration.test.ts` "rejects an award computed from a state that
    has already moved on" fail against a guard that tests the *after*-state instead of the pre-award
    state? If it does not, say what test would.

## Method

- Read the diff and the full files before judging anything. Say when you are inferring behaviour
  instead of reading it.
- You have no Cloudflare runtime and, on this host, native `workerd` cannot start. Do not claim you
  ran a concurrent D1 workload. If a question needs true parallelism, say that it is unverifiable
  from the artifacts and describe exactly what a human would have to run to settle it.
- Prefer a defect with a concrete failing scenario over a style preference. Do not report naming,
  formatting, or documentation wording.

## Severity

- P0: a security, economy, or data-integrity defect, or a crash on a normal path.
- P1: a logic defect a player would hit.
- P2: a robustness defect that is visible or costly but not exploitable.
- P3: a correctness nit with no realistic user impact.

## Output format

1. Verdict: PASS, PASS WITH FIXES, or FAIL, with one sentence of justification.
2. Findings table: severity, finding, the file and line it lives at, and the concrete scenario that
   triggers it.
3. For each finding, the minimal fix you would make. If the code is correct, say that plainly
   instead of inventing a finding.
4. Answers to the ten questions above, in order, each with the evidence you used.
5. Anything you could not verify from the artifacts, and what would settle it.
