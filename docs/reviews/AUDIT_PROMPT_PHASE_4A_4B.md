# Independent audit request: HappyFarm Phase 4A + 4B (experience, levels, level-gated crops)

You are an independent reviewer. You did not write this code. Your job is to find defects, not to
confirm that the work is good. A finding of "nothing wrong" is only useful if you can say what you
checked and what you could not check.

## Project

Browser farm game at `C:\Project\HappyFarm`. Cloudflare-native and server-authoritative:

- TypeScript monorepo: `packages/{domain,application,contracts,game-data}`, `workers/api`,
  `apps/web` (plain TypeScript + Vite, no React), `tests/`.
- Cloudflare Workers + D1 in production. Development uses a Node host for the same Worker
  entrypoint because the native `workerd` runtime crashes on this Windows machine
  (`access violation 0xc0000005`), so no live Worker and no parallel D1 contention can be run here.
- The client is not authoritative about economy, inventory, time, rewards, progression, or player
  identity. Identity comes from a verified bearer credential; the server decides `playerId`.

## What to audit

Two commits on top of `24c2d3d` (Phase 3.6C, already audited):

- **`4e7b89c` — Phase 4A, experience and levels.** Harvesting awards experience, and a level is
  derived from that experience. Adds `packages/domain/src/progression.ts` (curve arithmetic),
  `packages/application/src/progression.ts`, `database/migrations/0005_player_progression.sql`,
  the award inside `D1HarvestSettlementRepository.settleHarvestAtomically`, the `progression` member
  on the harvest response, `GET /progression`, and a progression panel in the development UI.
- **`0857e93` — Phase 4B, level-gated crops and the crop catalogue.** A crop definition can require a
  player level; `PlantCrop` refuses below it with the new `CROP_LEVEL_REQUIRED` (403);
  `GET /crop-definitions` serves the catalogue from game data; the client's planting control is built
  from that catalogue instead of a compiled-in list; the `requiredFarmLevel` field that used to throw
  `INVALID_INPUT` in `CropStateProjector` is gone.

Audit them together and in order. Phase 4B reads the progression state Phase 4A introduced and is its
first gameplay reader: a defect in the settlement shows up as a wrong unlock, and a defect in the
gate shows up as experience that bought nothing.

## Artifacts to attach (all of them, not a summary)

1. Both commits as unified diffs:

   ```text
   git diff 24c2d3d 4e7b89c > happyfarm-4a.diff
   git diff 4e7b89c 0857e93 > happyfarm-4b.diff
   ```

2. The full current contents of these files, because a diff hides their surroundings:
   - `packages/domain/src/progression.ts`
   - `packages/domain/src/crop.ts`
   - `packages/application/src/progression.ts`
   - `packages/application/src/harvest.ts`
   - `packages/application/src/crops.ts`
   - `packages/application/src/ports.ts`
   - `database/migrations/0005_player_progression.sql`
   - `workers/api/src/d1-repositories.ts` (the whole file: the settlement and the progression
     repository are the parts that matter)
   - `workers/api/src/runtime.ts`
   - `workers/api/src/handler.ts`
   - `packages/contracts/src/index.ts`
   - `packages/game-data/src/progression/index.ts`
   - `packages/game-data/src/crops/index.ts`
   - `apps/web/src/main.ts`
   - `tests/domain/progression.test.ts`
   - `tests/domain/crop-unlock.test.ts`
   - `tests/application/plant-crop.test.ts`
   - `tests/application/harvest-crop.test.ts`
   - `tests/integration/progression-migration.test.ts`
   - `tests/api/handler.test.ts`
3. `docs/decisions/0008-player-progression-and-levelling.md` and
   `docs/decisions/0009-crop-unlocks-by-level.md`.
4. The two implementation-side reviews, which you should try to falsify rather than trust:
   `docs/reviews/PHASE_4A_IMPLEMENTATION_REVIEW.md` and
   `docs/reviews/PHASE_4B_IMPLEMENTATION_REVIEW.md`.

Do not re-audit the economy, the development authentication bridge, or the renderer unless these two
commits introduce or expose something there. `workers/api/src/index.ts` is production's fail-closed
entrypoint: `4e7b89c` added `gameDataProgressionDefinition` to the handler dependencies there — two
lines, no change to the authenticator — and `0857e93` did not touch it at all. Confirm that the
entrypoint still fails closed rather than assuming it from the file being mostly unchanged.

## Invariants these commits must not break

Judge each one and say how you verified it:

1. Experience is awarded **only** inside the harvest settlement. There is no second write path to
   `player_progression`, and no level, experience total, award amount, threshold, or crop requirement
   is ever accepted from a client.
2. `level` is always `levelForXp(xp)` for the definition in use. A stored row where the two disagree
   is refused, never written forward and never returned as valid.
3. Experience never decreases, and every settled award advances `progression_version`. A stale or
   concurrent award fails the **whole** batch — settlement receipt, inventory addition, crop
   deletion, and idempotency record included — or none of it happened.
4. A replayed harvest returns the award the original call stored, including the level at that
   moment, and cannot pay experience twice.
5. The planting gate compares the actor's own authoritative level against authoritative game data,
   and a refused plant writes nothing at all: no crop row, no idempotency record, no consumed id.
6. The unlock rule is fail-closed. Any level that is not a real level locks the crop rather than
   unlocking it.
7. Reads are never gated. `GET /progression` is a pure projection that writes nothing, and
   `GET /farms/:farmId/crops` reports every planted crop, including one a retuned curve would no
   longer let the player plant.
8. `GET /crop-definitions` is a pure projection of game data: no database read, no mutation, no
   player state, and only the documented fields.
9. The client reimplements nothing. It computes no curve and no threshold, holds no crop list, and
   does not treat a disabled `<option>` as a security boundary.
10. Production authentication is untouched, and the development bootstrap still creates only the
    configured player — no farm, wallet, inventory, crop, experience, or unlock.

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
   there a failure that maps to something else, and would it surface as an internal error or be
   swallowed?
4. Trace the retry loop in `HarvestCrop.execute`. Can it terminate without either applying the award
   or reporting a failure? Can any attempt pay experience twice, pay it while the crop survives, or
   delete the crop without paying? Is `PROGRESSION_ATTEMPTS = 8` a bound reachable in practice, and
   what does the caller see when it is?
5. The idempotency record stores the whole harvest response as JSON and `replay` re-validates it
   before returning. Is that validation strict enough that a corrupt or hand-edited stored award
   cannot be echoed to a client as a valid progression? Look for a field accepted without a bound
   check, and for anything that could throw an unexpected error type out of `replay`.
6. Does `GET /progression` for a player with no row write anything, and does it read only the
   authenticated actor? Does the level it reports ever disagree with the level the planting gate
   uses for the same player at the same moment — for a missing row, for a row whose cached `level`
   disagrees with its `xp`, and for a row the monotonic trigger permits but the domain refuses?
7. Trace every way a `crop_instances` row can come into existence in `workers/api`. Is `PlantCrop`
   genuinely the only one, and can the gate be reached after a row is written by any ordering of the
   existing steps? Which errors can a non-member, or a member planting on a locked coordinate,
   observe, and is that consistent with what those checks existed for before this phase?
8. Is `isCropUnlocked` total and fail-closed for every `number` — `-0`, `Number.MIN_VALUE`, values
   past `MAX_SAFE_INTEGER`, `NaN`, both infinities? Is `requiredLevelFor` itself safe against a
   malformed `requiredLevel` (zero, negative, fractional, `NaN`, `Infinity`, above the level
   ceiling) reaching the domain from game data or from a repository implementation, and is the
   game-data bound consistent with `CropDefinitionDTOSchema` and with `player_progression`?
9. The requirement is read from game data, which the ADR argues is a module constant for the life of
   a deployment and therefore needs no version guard. Is that argument sound for this codebase, given
   that a deployment can change game data while D1 rows persist? Name the worst outcome if it is
   wrong, and whether the "reads are not gated" decision contains the damage.
10. Does `ListCropDefinitions` map every field in the right direction — can a field be added to the
    domain type and silently *not* reach the client, or reach it without being validated? Does
    `CropDefinitionDTOSchema` reject every field the server does not own, and does the handler map
    `CROP_LEVEL_REQUIRED` to 403 without changing any other code's status or leaking a level, a
    curve, or server detail in the failure envelope?
11. In `apps/web/src/main.ts`, does `renderCrops`, `cropIsLocked`, or `ensurePlantableSelection` ever
    decide that a crop is unlocked from anything other than the server's `level` and
    `requiredLevel`? Can the option-skipping optimization (`renderedCropOptions`) leave the control
    with a stale enabled or disabled state after a level change, a sign-out, or a farm switch, and
    what happens when the catalogue is empty or the level is unknown?
12. Is anything in the diff a second source of truth for a crop id, a level, a threshold, or a
    requirement — the client, the model manifest, the contract, the game-data schema, the migration
    `CHECK`? Is the remaining chain complete: game data → shipped model → file on disk?
13. Are the new tests able to fail? Identify any test that would still pass with the rule it claims
    to protect broken. In particular: does `tests/integration/progression-migration.test.ts` "rejects
    an award computed from a state that has already moved on" fail against a guard that tests the
    *after*-state? Does `tests/application/plant-crop.test.ts` "derives the level from experience
    rather than trusting the stored level column" fail against a gate that reads `progression.level`
    instead of `levelForXp(xp)`? Does the handler test fail if the catalogue route is not
    registered, and does it check the positive direction (a level-2 player really can plant wheat)?
    Does the end-to-end smoke check fail if the gate stops reading the same row `GET /progression`
    reports?
14. Does the migration enforce what the code assumes — the foreign key, the bounds, the monotonic
    trigger — and is there a state the trigger still permits that the domain would refuse? Does
    `0857e93` add any migration, and does it need one?
15. Is any of the client's behaviour a boundary the server does not also enforce? Enumerate what a
    hand-written request could do that the UI does not offer, and confirm the server refuses each.

## Method

- Read the diffs and the full files before judging anything. Say when you are inferring behaviour
  instead of reading it.
- You have no Cloudflare runtime, and native `workerd` cannot start on this host. Do not claim you
  ran a live Worker or a parallel D1 workload. If a question needs true parallelism or a browser,
  say it is unverifiable from the artifacts and describe exactly what a human would have to run to
  settle it.
- Prefer a defect with a concrete failing scenario over a style preference. Do not report naming,
  formatting, or documentation wording.

## Severity

- P0: a security, economy, or data-integrity defect, or a crash on a normal path.
- P1: a logic defect a player would hit.
- P2: a robustness defect that is visible or costly but not exploitable.
- P3: a correctness nit with no realistic user impact.

## Output format

1. Verdict per commit (`4e7b89c`, `0857e93`): PASS, PASS WITH FIXES, or FAIL, each with one sentence
   of justification.
2. Findings table: severity, finding, the file and line it lives at, the commit it belongs to, and
   the concrete scenario that triggers it.
3. For each finding, the minimal fix you would make. If the code is correct, say that plainly instead
   of inventing a finding.
4. Answers to the fifteen questions above, in order, each with the evidence you used.
5. Anything you could not verify from the artifacts, and what would settle it.
