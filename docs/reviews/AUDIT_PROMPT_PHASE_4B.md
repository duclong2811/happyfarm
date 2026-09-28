# Independent audit request: HappyFarm Phase 4B (crop catalogue and level-gated unlocks)

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

Phase 4B: crops can require a player level, planting is refused below it, and the client builds its
planting control from a server-served crop catalogue instead of a compiled-in list.

Phase 4A (experience and levels) is **staged but not committed**; the Phase 4B changes are the
unstaged working tree above it. This is deliberate, so do not treat the split as an accident. Auditing
Phase 4B therefore means auditing a tree that also contains Phase 4A; the Phase 4A audit is a separate
request (`docs/reviews/AUDIT_PROMPT_PHASE_4A.md`).

Artifacts to attach to the conversation (all of them, not a summary):

1. The **unstaged** diff, which is exactly Phase 4B because Phase 4A is staged. Four Phase 4B files
   are new and untracked, so record them first:

   ```text
   git add -N .
   git diff > happyfarm-4b.diff
   ```

   `git add -N` only marks the new files as "intent to add" so they appear in `git diff`; it does not
   touch the Phase 4A index entries. Do **not** send `git diff --cached` (that is Phase 4A), and do
   not `git add -A` before capturing the diff.
2. The full current contents of these files, because a diff hides their surroundings:
   - `packages/domain/src/crop.ts`
   - `packages/application/src/crops.ts`
   - `packages/application/src/progression.ts` (the `storedLevel` helper the gate uses)
   - `packages/application/src/ports.ts`
   - `packages/game-data/src/crops/index.ts`
   - `workers/api/src/runtime.ts`
   - `workers/api/src/handler.ts`
   - `packages/contracts/src/index.ts`
   - `apps/web/src/main.ts`
   - `apps/web/src/labels.ts`
   - `tests/domain/crop-unlock.test.ts`
   - `tests/application/plant-crop.test.ts`
3. `docs/decisions/0009-crop-unlocks-by-level.md`.

Commits `dc036be`, `24c2d3d`, and the staged Phase 4A tree are already audited (or awaiting their own
audit); their findings are in `docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md`, the two Phase 3.6
reviews, and `docs/reviews/AUDIT_PROMPT_PHASE_4A.md`. Do not re-audit the economy, the development
authentication bridge, or the renderer. Only report an issue there if Phase 4B introduces or exposes
it.

## Invariants this phase must not break

Judge each one and say how you verified it:

1. A crop's level requirement is authoritative game data. No route accepts a level, an experience
   total, a threshold, or a requirement from a client, and no client value reaches the comparison.
2. The level the gate compares is derived from the actor's own stored experience — not from the row's
   cached `level` column, not from another player's row, and not from the request.
3. `PlantCrop` remains the only path that creates a crop row, and the gate is inside it. A refused
   plant writes nothing: no crop, no idempotency record, no consumed id.
4. The rule is fail-closed. Any level that is not a real level locks the crop rather than unlocking
   it.
5. Reading is never gated. `GET /farms/:farmId/crops` and the crop projector report every planted
   crop, including one a retuned curve would no longer let the player plant.
6. `GET /crop-definitions` is a pure projection: it reads no database, mutates nothing, reveals no
   player state, and returns only the six documented fields.
7. The client holds no crop list, computes no threshold, and does not treat a disabled `<option>` as
   a security boundary.
8. Production authentication is untouched (`workers/api/src/index.ts` still fails closed), and the
   development bootstrap still creates only the configured player — no farm, wallet, inventory, crop,
   experience, or unlock.

## Specific questions to answer

1. Trace every way a `crop_instances` row can come into existence in `workers/api`. Is `PlantCrop`
   genuinely the only one, and can the gate be reached after a row is written by any ordering of the
   existing steps?
2. `PlantCrop.execute` checks ownership, tile, unlocked land, terrain, tile version, occupancy, and
   the definition before it reads progression. Is that ordering deliberate in every case, or does it
   let a level-gated crop reveal something about a farm the actor cannot plant on? Which errors can a
   non-member, or a member planting on a locked coordinate, observe, and is that consistent with what
   those checks existed for before this phase?
3. `storedLevel` derives the level from `xp` and never reads the `level` column. Construct the rows
   where the two must disagree, including one the `player_progression` monotonic trigger permits but
   the domain would refuse (`assertProgression`), and say what each one does at the gate. Is there a
   row where the gate is stricter or looser than `GET /progression` reports the same player, and does
   that matter?
4. `isCropUnlocked` is `Number.isSafeInteger(level) && level >= requiredLevelFor(definition)`. Is
   that total and fail-closed for every `number`, including `-0`, `Number.MIN_VALUE`, values past
   `MAX_SAFE_INTEGER`, `NaN`, and both infinities? Is `requiredLevelFor` itself safe against a
   malformed `requiredLevel` (zero, negative, fractional, `NaN`, `Infinity`) reaching the domain from
   game data or from a repository implementation?
5. The requirement is read from game data, which the ADR argues is a module constant for the life of
   a deployment and therefore needs no version guard. Is that argument sound for this codebase, given
   that a deployment can change game data and D1 rows persist across deployments? Name the worst
   outcome if it is wrong, and whether the read-not-gated decision contains the damage.
6. `ListCropDefinitions.execute` maps `CropDefinition` to a view. Is the mapping exhaustive in the
   right direction — can a field be added to the domain type and silently *not* reach the client, or
   reach it without being validated? Does `CropDefinitionDTOSchema` reject every field the server
   does not own?
7. The handler maps `CROP_LEVEL_REQUIRED` to 403 in `errorStatus`. Is every other code's status
   unchanged, is the new code reachable from exactly one place, and does the failure envelope still
   carry no level, no curve, and no server detail? Is `CROP_LEVEL_REQUIRED` also present in the
   application error union and the contracts enum, and would a mismatch between the two be a compile
   error or a runtime surprise?
8. In `apps/web/src/main.ts`, does `renderCrops` or `ensurePlantableSelection` ever decide a crop is
   unlocked from anything other than the server's `level` and `requiredLevel`? Can the option-skipping
   optimization (`renderedCropOptions`) leave the control showing a stale enabled or disabled state
   after a level change, a sign-out, or a farm switch? What happens when the catalogue is empty, and
   when the player's level is unknown?
9. Are the new tests able to fail? Identify any test that would still pass with the rule it claims to
   protect broken. In particular: does `tests/application/plant-crop.test.ts` "derives the level from
   experience rather than trusting the stored level column" fail against a gate that reads
   `progression.level` instead of `levelForXp(xp)`? Does the handler test fail if the route is not
   registered, and does it check the positive direction (a level-2 player really can plant wheat)?
10. Is anything in the diff a second source of truth for the crop list, the level curve, or the
    requirement? The phase deleted `PLANTABLE_CROPS` and re-pointed `tests/web/farm-assets.test.ts`
    at the game-data registry: is the remaining chain (game data → model manifest → shipped file)
    complete, and is there any other place a crop id, a level, or a requirement is written down
    twice?

## Method

- Read the diff and the full files before judging anything. Say when you are inferring behaviour
  instead of reading it.
- You have no Cloudflare runtime, and native `workerd` cannot start on this host. Do not claim you
  ran a live Worker or parallel D1 contention. If a question needs that, say it is unverifiable from
  the artifacts and describe exactly what a human would have to run to settle it.
- Prefer a defect with a concrete failing scenario over a style preference. Do not report naming,
  formatting, or documentation wording.
- The repository's own review is `docs/reviews/PHASE_4B_IMPLEMENTATION_REVIEW.md`. Read it, then try
  to falsify it.

## Severity

- P0: a security, economy, or data-integrity defect, or a crash on a normal path.
- P1: a logic defect a player would hit.
- P2: a robustness defect that is visible or costly but not exploitable.
- P3: a correctness nit with no realistic user impact.

## Output format

1. Verdict: PASS, PASS WITH FIXES, or FAIL, with one sentence of justification.
2. Findings table: severity, finding, the file and line it lives at, and the concrete scenario that
   triggers it.
3. For each finding, the minimal fix you would make. If the code is correct, say that plainly instead
   of inventing a finding.
4. Answers to the ten questions above, in order, each with the evidence you used.
5. Anything you could not verify from the artifacts, and what would settle it.
