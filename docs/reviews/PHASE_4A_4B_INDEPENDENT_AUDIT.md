# Phase 4A + 4B independent audit

Auditor: an independent reviewing agent working from the artifacts listed in
`docs/reviews/AUDIT_PROMPT_PHASE_4A_4B.md`. It did not write either commit.
Date: 2026-09-28
Revisions audited: `4e7b89c` (Phase 4A), `0857e93` (Phase 4B), baseline `24c2d3d`.
Section 6 is a second pass over the uncommitted follow-up fixes on top of `0857e93`.

Environment: Windows. Native `workerd` cannot start here (`0xc0000005`), so there was no live Worker,
no parallel D1 workload, no browser, and no Vite build. What was run: `tsc --noEmit`,
`eslint --max-warnings=0`, the per-file test runner (273 tests, 33 files, after section 6 added one), the end-to-end development
smoke suite against the real development entrypoint on the Node host (112 checks), and a standalone
probe that replays `settleHarvestAtomically`'s four statements against real SQLite (`node:sqlite`,
the same engine the Node host uses) to observe which constraint fires and what rolls back. Section 5
lists what none of that can settle.

## 1. Verdict

- **`4e7b89c` (Phase 4A): PASS WITH FIXES.** The award is atomic with the harvest, the concurrency
  guard tests the read revision and I confirmed in real SQLite that every stale shape aborts the
  whole batch, and `levelForXp(xp)` is the only level anywhere on a read path; the fixes are one P2
  consequence of the cached-level rule, the P2 remedy that could not run (section 6), and two P3 bounds.
- **`0857e93` (Phase 4B): PASS WITH FIXES.** The gate reads the actor's own row and derives the level
  from `xp`, reads are ungated, the catalogue is a pure projection, and the client holds no crop list;
  the fix is one P3 hole in the unlock rule's own fail-closed direction. No P0, P1, or P2 was found in
  this commit.

## 2. Findings

| # | Severity | Commit | Finding | Lives at | Trigger |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 | `4e7b89c` | A curve retune strands every existing player's harvest. The stored `level` is a cache of `levelForXp(xp)` under the definition that wrote it, and the award path refuses a row where the two disagree. Retuning `xpStep` or lowering `maxLevel` — which ADR 0009 explicitly contemplates — makes every row written under the old curve disagree with the new one, so `createXpAward` throws and every harvest for those players returns `INTERNAL_ERROR` (500) instead of awarding experience. The player cannot earn their way out, because the only thing that awards experience is the harvest that is now failing. | `packages/application/src/harvest.ts:162-168`, `packages/domain/src/progression.ts:105-117`, `packages/domain/src/progression.ts:125-150` | Change `xpStep` from 120 to 240 in `packages/game-data/src/progression/index.ts` and deploy. A player stored as `xp = 200, level = 2` now has `levelForXp(200) = 1`, so `assertProgression` refuses and the harvest 500s until `level` is rewritten in D1. |
| 2 | P3 | `0857e93` | `isCropUnlocked` failed open for a requirement below the level every player starts at. | `packages/domain/src/crop.ts:70` (before this audit) | A `CropDefinition` with `requiredLevel: 0` (or negative) reached the rule from any repository implementation: `level >= 0` unlocked the crop for every player. Measured, not inferred: the new test printed `expected true to be false`. Game data rejects such a value at load (`packages/game-data/src/crops/index.ts:21`), so this needs a second implementation, not shipped data. |
| 3 | P3 | `4e7b89c` | The harvest replay's stored-award validation accepted a level below 1 and a cap below 2, so a corrupt or hand-edited `response_json` was echoed with HTTP 200 in a shape `PlayerProgressionDTOSchema` rejects, instead of the `INTERNAL_ERROR` the validator exists to produce. | `packages/application/src/harvest.ts:66-83` | `UPDATE idempotency_keys SET response_json = '{"harvest":{...},"progression":{"xpAwarded":4,"leveledUp":false,"progression":{"level":0,"xp":4,"xpIntoLevel":4,"xpForNextLevel":120,"maxLevel":0}}}'`, then replay the harvest. Measured: the replay resolved before the fix (`expected promise to reject ... but it resolved`). |
| 4 | P3 | `4e7b89c` / `0857e93` | The level ceiling is written in four modules and nothing tied them together: game data (`maxLevel` and `requiredLevel` capped at 10,000), the contract (`MAX_PROGRESSION_LEVEL`), and the migration `CHECK (level BETWEEN 1 AND 10000)`. ADR 0008 names the coupling; no test asserted it. | `packages/contracts/src/index.ts:121`, `packages/game-data/src/progression/index.ts:19`, `packages/game-data/src/crops/index.ts:21`, `database/migrations/0005_player_progression.sql:16` | Raise `maxLevel` to 20,000 in game data alone: the suite stayed green, and the same deploy would (a) serve `maxLevel: 20000` to a client whose `PlayerProgressionDTOSchema` rejects it, discarding the whole progression read, and (b) abort the settlement on the database `CHECK` once a player passed level 10,000. |
| 5 | P3 | docs (uncommitted) | The audit prompt asserted a fact about the diff that is not true, in a sentence written to stop an auditor from looking: "`workers/api/src/index.ts` ... was not modified by either commit". `4e7b89c` modified it — two lines, adding `gameDataProgressionDefinition` to the handler dependencies. Production still fails closed (the authenticator is `UnconfiguredAuthenticator` and is untouched), so no invariant is broken, but an auditor trusting the sentence would not check the production entrypoint. | `docs/reviews/AUDIT_PROMPT_PHASE_4A_4B.md:76-77` | `git diff --stat 24c2d3d 4e7b89c -- workers/api/src/index.ts` |

| 6 | P2 | `4e7b89c` / docs (uncommitted) | Finding 1's recorded remedy could not run. ADR 0008 told a retune to ship "a D1 step that rewrites `level` from `xp` for every row", but `player_progression_monotonic_update` aborts any update where `NEW.level < OLD.level`, and lowering the cap is exactly a level decrease. So the retune that causes finding 1 also had no documented way out: the step aborts with `player progression cannot regress`. Measured, not inferred. | `docs/decisions/0008-player-progression-and-levelling.md:93-94` (before this fix), `database/migrations/0005_player_progression.sql:26-33` | Replay a retune on real SQLite (`node:sqlite`, migrations 0001 + 0005): seed `level 32, xp 60000, progression_version 7`, then `UPDATE player_progression SET level = 10, progression_version = 8` → `ABORTED: player progression cannot regress`; the same statement with the trigger dropped commits, so the `CHECK` band is not what refuses it. |

## 3. Minimal fix per finding

1. **Finding 1 — documentation and a decision, not a silent code change.** The refusal is exactly what
   the stated invariant asks for ("a stored row where the two disagree is refused, never written
   forward"), and the test at `tests/domain/progression.test.ts:106` pins it deliberately. What is
   missing is the other half of the rule: a curve change has to rewrite the cache. I added that
   consequence to `docs/decisions/0008-player-progression-and-levelling.md` and a pointer to it in
   `0009-crop-unlocks-by-level.md`. The engineering alternatives are (a) ship the retune with a D1
   step that lifts the monotonic trigger around the rewrite (finding 6 — the plain form aborts), or
   (b) stop refusing on a level-only disagreement: derive the current level in `createXpAward` from
   `xp` (as `storedLevel` already does on every read) and let the guarded `UPDATE` heal the cache.
   (b) alone does not free the harvest either, because the healed level is still below the cached one
   the trigger compares against (section 6), and it rewrites an invariant the team wrote down, so I did
   not take it unilaterally.
2. **Finding 2 — implemented.** `isCropUnlocked` now requires the requirement itself to be at least 1
   (`packages/domain/src/crop.ts:70-73`), so a requirement that is not a level locks the crop instead
   of unlocking it. An ordinary requirement above the floor still compares numerically, which keeps the
   existing fractional-requirement expectations. New test: `tests/domain/crop-unlock.test.ts`, "locks a
   crop whose requirement is below the level every player starts at" — it failed before the fix.
3. **Finding 3 — implemented.** `assertStoredAward` now enforces the same floors
   `PlayerProgressionDTOSchema` does: `level >= 1`, `maxLevel >= 2`, `level <= maxLevel`
   (`packages/application/src/harvest.ts:83-89`). Deliberately not added: re-deriving `levelForXp(xp)`,
   because a stored award written under an older definition must stay replayable after a curve change —
   the replay path has to survive a retune that the write path refuses (finding 1). New test:
   `tests/application/harvest-crop.test.ts`, "refuses to echo a stored award that is not a valid
   progression" — it failed before the fix.
4. **Finding 4 — implemented as a test.** `tests/game-data/schema.test.ts` now asserts
   `playerProgression.maxLevel <= MAX_PROGRESSION_LEVEL` and, for every shipped crop,
   `requiredLevel <= MAX_PROGRESSION_LEVEL`. Raising any of the four bounds alone now fails the suite.
5. **Finding 5 — implemented.** The sentence now states what the commit actually did and asks the
   auditor to confirm the entrypoint still fails closed.

6. **Finding 6 — implemented as a documented procedure plus a test.** ADR 0008's retune step now lifts
   the monotonic guard inside the one transaction that does the rewrite, and says why the guard's
   `level` clause stays. `tests/integration/progression-migration.test.ts` pins all three states: the
   plain rewrite aborts, the rewrite with the guard lifted commits, and the guard is enforced again
   afterwards.

## 4. Answers to the fifteen questions

**1. Can the batch commit while `xp` is not exactly `xpBefore + xpAwarded`?** No, and I checked the
interleavings rather than reading the comment. The guard is statement 3 (`d1-repositories.ts:632-648`)
and the award is statement 4 (`d1-repositories.ts:652-663`); both test the identical predicate
(`player_id`, `xp = xpBefore`, `progression_version = expectedProgressionVersion`), and no statement
between them writes `player_progression`. Probe results against real SQLite, replaying the four
statements with the schema from migrations 0001-0003 and 0005:
- first award from no row: committed, `xp = 4 = 0 + 4`, `progression_version = 2`;
- two awards that read the same revision: the second aborted with `completed harvest idempotency
  requires settlement`, the whole batch rolled back (`harvest_settlements` count stayed 1, `xp` stayed
  4) — which the harness test also asserts;
- a stale caller whose own reward is *larger* (24 against a row at 4): aborted, total unchanged;
- a caller whose expected version is *ahead* of the stored row (`xp = 0`, `progression_version = 5`):
  aborted, nothing written;
- `INSERT OR IGNORE` when the row already exists: a no-op, and the guard then compares against the
  existing row (the second-award case above).
`UPDATE` matching zero rows genuinely commits silently — I confirmed that too — so the guard is
load-bearing, and the only reason a mismatch aborts is the `CASE` yielding `NULL`. Two *serialized* D1
batches are covered by this; genuinely parallel writers are not (section 5).

**2. Is `level = levelAfter` consistent with `xp = xpAfter`?** Yes by construction: both come from
`createXpAward` (`packages/domain/src/progression.ts:125-150`), where `xpAfter = progression.xp +
xpAwarded` and `levelAfter = levelForXp(definition, xpAfter)`. The curve cannot change between the read
and the write: `gameDataProgressionDefinition` is a module constant in the isolate serving the request,
handed to the use case once (`workers/api/src/runtime.ts:50-56`, `index.ts`, `dev-index.ts`). Across a
deployment it can change, and then the *stored* row (written under the old curve) is one
`assertProgression` refuses — finding 1. The row the settlement writes is always one `assertProgression`
accepts, because `createXpAward` computed it with the same definition it just validated against.

**3. Which constraint fires, and is every one mapped?** The mapper
(`d1-repositories.ts:668-680`) covers three messages, and I measured which is reachable:
- `completed harvest idempotency requires settlement` (`0003_inventory_and_harvest.sql:75-91`) is the
  one that actually fires when the guard yields `NULL`. BEFORE INSERT triggers run before column
  constraints in SQLite, so the comment at `d1-repositories.ts:628-631` is correct.
- `NOT NULL constraint failed: idempotency_keys.actor_player_id` is reached only with that trigger
  absent — I dropped it in the probe and got exactly this message. Defence in depth, and mapped.
- `player progression` (the monotonic trigger, `0005_player_progression.sql:26-33`) is defensive on this
  path: `createXpAward` refuses a disagreeing row before SQL, and the update only ever increases `xp`
  and the version.
Not mapped, and therefore surfacing as a 500 with `INTERNAL_ERROR`: `invalid harvest settlement`
(`harvest_settlement_validate`), a `CHECK` failure on the bounds (reachable only if finding 4's coupling
breaks), and `FOREIGN KEY constraint failed`. Each of those is a genuine internal error rather than a
lost race, so a 500 is the right answer; nothing is swallowed. One technique caveat: the mapping is
substring matching on the D1 error message, which I could not exercise on real D1 (section 5).

**4. Can the retry loop end without applying or reporting?** No. Each of at most
`PROGRESSION_ATTEMPTS = 8` iterations ends in `return` or a `throw`
(`packages/application/src/harvest.ts:158-211`): `PROGRESSION_CONFLICT` continues; any other error
looks for a completed request id and replays it, or reports `CROP_ALREADY_HARVESTED`, or re-checks
capacity, or rethrows. It cannot pay twice or pay while the crop survives: a rejected attempt rolls the
whole batch back (measured above and asserted in `tests/integration/progression-migration.test.ts`), and
a committed attempt is one transaction containing the receipt, the inventory addition, the crop
deletion (all three in the `AFTER INSERT` trigger) and the award. Eight lost races is not reachable in
practice; the caller sees `PROGRESSION_CONFLICT` (409) and `apps/web/src/labels.ts` has no label for
that code, so the page shows the raw code — cosmetic, and the same as for other rare codes.

**5. Is the replay validation strict enough?** After finding 3, yes for the fields that matter:
`xpAwarded` is a positive safe integer, `leveledUp` a boolean, and the five progression fields are
non-negative safe integers with `1 <= level <= maxLevel` and `maxLevel >= 2`. Deliberately absent: any
re-derivation of `levelForXp(xp)`, because that would make every stored award unreadable after a curve
change — and the whole point of the replay is to survive exactly that. Nothing can throw an unexpected
type out of `replay` (`harvest.ts:225-243`): the JSON parse, the field checks and the id parsers are all
inside one `try`, and the catch throws `ApplicationError("INTERNAL_ERROR")`.

**6. Does `GET /progression` write, and read only the actor?** It writes nothing: for a player with no
row it substitutes `emptyProgression` (`packages/application/src/progression.ts:82-83`), and
`tests/api/handler.test.ts:421-426` asserts both the level-1 answer and that `player_progression` still
holds zero rows afterwards. It reads `actor.playerId` only, and the spoofed
`?playerId=&level=&xp=` query changes nothing (handler test and smoke). Do the read and the gate ever
disagree? No, because they are the same two functions: the gate derives through `storedLevel`
(`progression.ts:63-70`) and the read through `progressionView`/`levelProgress`; both call
`levelForXp(xp)` and neither reads `player_progression.level`. For the three cases asked: a missing row
→ both say level 1; a row whose cache disagrees → both report the derived level (and the harvest path
refuses it); a row the trigger permits but the domain refuses (e.g. `xp = 400` with `level` left at 1) →
both still report the derived level 3, and again only the write path refuses. The cached column is
never anyone's answer.

**7. Every way a `crop_instances` row can exist, and what a refusal can observe.** One insert path:
`d1-repositories.ts:371`, inside `D1CropRepository.plantAtomically`, whose only caller is
`PlantCrop` (`packages/application/src/crops.ts:196`). A repo-wide search for `INSERT INTO
crop_instances` finds only that statement outside tests. The gate (`crops.ts:164-172`) is after the
definition lookup and before `createCropInstance` and before `this.ids.newCropInstanceId()`
(`crops.ts:175-176`), so no row, no idempotency record, and no consumed id — the test compares both row
counts and asserts the tile is still empty. No ordering reaches the write first. Observable errors, in
order: farm missing → `RESOURCE_NOT_FOUND`; not an OWNER (including a non-member) → `NOT_AUTHORIZED`,
before any tile is read; a member on a coordinate outside the farm → `RESOURCE_NOT_FOUND`, on a
non-SOIL tile → `TILE_NOT_PLANTABLE`, on a stale version → `CONFLICT_STALE_STATE`, on an occupied tile
→ `TILE_OCCUPIED`; then `CROP_DEFINITION_NOT_FOUND`, then `CROP_LEVEL_REQUIRED`. That is the pre-phase
order with the gate appended last, so no existing check changed meaning or precedence — consistent with
what those checks existed for.

**8. Is `isCropUnlocked` total and fail-closed, and is `requiredLevelFor` safe?** For levels, total and
fail-closed for every `number`: `-0` is a safe integer but `-0 >= 1` is false, `Number.MIN_VALUE` and
anything past `MAX_SAFE_INTEGER` are not safe integers, `NaN` fails every comparison, and both
infinities fail `level >= required` for any finite requirement. `tests/domain/crop-unlock.test.ts`
enumerates them. For the requirement, `requiredLevelFor` returned `definition.requiredLevel ?? 1`
verbatim, which was fail-open for zero and negative (finding 2, measured) while `NaN`, `+Infinity` and
a fractional value behaved safely (NaN locked, Infinity locked, 2.5 compared as written — the existing
test pins 2 locks / 3 unlocks). Now the requirement must be at least 1 to unlock anything. The bounds
are consistent: game data caps `requiredLevel` at 10,000 (`crops/index.ts:21`), the contract at
`MAX_PROGRESSION_LEVEL = 10_000` (`contracts/src/index.ts:121,169`), the database at
`CHECK (level BETWEEN 1 AND 10000)`, and the progression schema at `max(10_000)` — finding 4 fixed the
missing test. Note the ceiling is not the same as *reachability*: a requirement above the curve's
`maxLevel` (50) is still permanently unplantable, and what prevents that is
`tests/game-data/schema.test.ts:198`, not the schema.

**9. Is "no version guard because game data is a module constant" sound?** Yes for what it claims. The
requirement is read from the module the Worker itself enforces (`runtime.ts:118-146`), never from a
client, and a deployment swaps the data and the rule together, so within a deployment there is nothing
to guard. If the argument were wrong, the worst outcome would be a crop unlocked for a player the
deployment did not intend — but the requirement and the level both come from the server, so the
"wrong" case can only be a stale *client* view, which is not authoritative anywhere. The
"reads are not gated" decision does contain that damage: a crop in the ground keeps reporting growth and
can still be harvested, so a retune cannot strand planted crops. The part the ADR does *not* contain is
finding 1: a retune strands the *write* path, because the cached level was written under the old curve —
and that failure has nothing to do with gating reads.

**10. Does `ListCropDefinitions` map every field, and does the handler leak?** Six domain fields map
one-to-one to six DTO fields (`crops.ts:267-282`), and `requiredLevel` is resolved through
`requiredLevelFor`, so "no requirement" is always present and never inferred from a missing key. A
field added to the domain type would *not* reach the client and would not be a compile error — the DTO
is built by hand — but `tests/api/handler.test.ts:346-355` asserts the exact key set of every entry, so
an accidental addition or omission fails a test; `displayNameKey` is deliberately not sent (the client
has its own labels). `CropDefinitionDTOSchema` is `.strict()`, and
`tests/contracts/validation.test.ts:106-134` enumerates injected `playerId`, `level`, and other fields
it must reject. Every game-data bound equals its DTO bound (duration 31,536,000; quantity 1,000,000;
xp 1,000,000; requiredLevel 10,000), so a served entry can satisfy the contract — the one coupling that
was not enforced is the progression curve, which is finding 4. `CROP_LEVEL_REQUIRED` was added to the
existing 403 group (`handler.ts:162-165`) and nothing else changed status; `failure()` emits only
`{ code, requestId }` (`handler.ts:194-197`), and the `ApplicationError` message that names both levels
is never serialized (`handler.ts:419-424`), so no level, curve, or server detail leaves the process.

**11. Does the client decide anything itself, and can the option cache go stale?** `cropIsLocked`
compares only `state.progression.level` (server-derived) against `definition.requiredLevel`
(server-provided), and with an unknown level it locks nothing, deliberately
(`apps/web/src/main.ts:163-172`). `ensurePlantableSelection` uses the same predicate, and `renderCrops`
builds every option from the catalogue. The skip signature includes the whole `[id, requiredLevel]`
list, the level, and the current selection (`main.ts:188-196`), so a level change cannot leave a stale
enabled/disabled state; a farm switch changes the selection and a different account changes both the
level and the catalogue, and both change the signature. There is no sign-out control on the page at
all — the token input is re-read on the next call — and the poll (`main.ts:591-601`) stops early when
the token is empty, so the level can go from unknown to known and not back. With an empty catalogue the
select is disabled and shows "Sign in to load crops" (`main.ts:200-208`). One consequence worth naming:
the poll re-renders but never re-reads the catalogue or the progression, so a level gained from another
tab appears after the next action rather than within 2 seconds.

**12. Any second source of truth?** The client keeps a model manifest, `CROP_MODEL_IDS`
(`apps/web/src/render/assets.ts:14`), which is deliberately client-owned and is not a plantability list;
`tests/web/farm-assets.test.ts` fails when game data gains a crop without a model, and
`tests/integration/crop-model-assets.test.ts` fails when a model is declared without a shipped file, so
the chain game data → manifest → file on disk is complete. `labels.ts` holds cosmetic names with raw-id
fallbacks. `PLANTABLE_CROPS` is gone (searched: no hit in `apps/**`). The four 10,000 ceilings are the
one real duplication and were untied — finding 4, now asserted. No threshold or curve arithmetic exists
in the client: `progressionSummary` divides two server numbers and clamps.

**13. Can the new tests fail?** Where I could, I measured rather than reasoned:
- `isCropUnlocked` zero/negative and the tampered stored award: both new tests **failed before the
  fix** (`expected true to be false`; `expected promise to reject ... but it resolved`) and pass after.
- `derives the level from experience rather than trusting the stored level column`
  (`tests/application/plant-crop.test.ts:234-249`) seeds `level = 25, xp = 0` and asserts wheat is
  refused. A gate reading `progression.level` would see 25 ≥ 2 and plant, so the test discriminates —
  read, not executed against the mutated gate.
- `serves the crop catalogue and gates planting by the level it reports`
  (`tests/api/handler.test.ts:320-379`) hits the real route (it would 404 if unregistered), pins the
  exact key set, and checks both directions — level 1 refused, level 2 planting `crop_wheat` with 201
  while `crop_corn` stays 403. Discriminating.
- `rejects an award computed from a state that has already moved on`
  (`tests/integration/progression-migration.test.ts`) asserts the observable invariant — rejection,
  unchanged `xp`, still one settlement row — so any guard that lets the stale award commit fails it. I
  could not re-run it against the *old* after-state guard, because that shape was never committed; I did
  build the naive after-state variant in the probe and it fails even the first award, which shows how
  much of the mechanism is the guard's *placement* rather than its predicate.
- The smoke check at `harness/smoke.mjs:378-403` (outside the repo) writes `xp = 120, level = 2`
  straight into D1 and asserts `/progression` reports level 2 and wheat then plants. That discriminates
  "the gate reads a different row or table", but **not** "the gate reads the cached column instead of
  `xp`", because it writes the two consistently — the unit test above is the one that covers the column.
  I did not run the smoke against a mutated gate.
- `PROGRESSION_ATTEMPTS` exhaustion is still uncovered: it needs eight consecutive lost races and a fake
  settlement, and no test drives it.

**14. Does the migration enforce what the code assumes, and does 4B need one?** The foreign key, the
`CHECK`s and the monotonic trigger are present and tested, including the deletion refusal and three
regression cases (`tests/integration/progression-migration.test.ts`). One state the trigger permits and
the domain refuses: a row whose cached `level` disagrees with `levelForXp(xp)` while still satisfying
`NEW.level >= OLD.level` — the plant-crop test inserts `level = 25, xp = 0` successfully. SQL cannot
recompute the curve, which is why the migration header says so and `assertProgression` exists; the
consequence is that the cached column can be wrong, and every read path already ignores it. The trigger
also does not cover `INSERT`, so the first write of a row is unconstrained by it (bounded by the
`CHECK`s, and read paths derive anyway). `0857e93` adds no migration and needs none: `requiredLevel` is
game data, not stored player state, and the gate writes nothing.

**15. Client behaviour the server does not enforce?** None found, and each is refused server-side:
planting a locked crop by hand → `CROP_LEVEL_REQUIRED` 403 (handler test and smoke); naming a level, xp,
or player in the plant or harvest body → the strict request schemas reject the body (400), with the
injected-field cases enumerated in `tests/contracts/validation.test.ts`; an unknown crop id → 404
`CROP_DEFINITION_NOT_FOUND` (`crops.ts:152-161`); `GET /crop-definitions` without a token → 401
(`tests/api/handler.test.ts:357-359`); `GET /progression` with `?playerId=&level=&xp=` → the actor's own
row; harvesting a crop above the player's level that is already in the ground → allowed, because reads
are not gated (invariant 7, and the only thing that keeps a retune from stranding planted crops). A
disabled `<option>` is the one boundary the UI shows and does not own, and the ADR says so.

## 5. Not verifiable from the artifacts

- **True parallel D1 contention.** Native `workerd` cannot start on this host, and the Node host
  serializes batches, so the guard is verified against interleavings built from sequential calls plus
  real-SQLite statement replay — not against two Workers contending inside D1. To settle it: deploy a
  development Worker (or run on Linux/WSL) and issue two harvests on one farm simultaneously, asserting
  that the stored `xp` equals the sum of both awards and that exactly one idempotency row exists per
  request. This is outstanding condition 5 of `docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md`, now
  with one more table relying on it.
- **The D1 error-message contract.** Findings 1 and 3 aside, the whole `PROGRESSION_CONFLICT` mapping
  depends on D1 surfacing SQLite's `RAISE` text (and `NOT NULL constraint failed: ...`) inside
  `error.message`. That held for the economy path in Phase 3, but it was never verified against real
  D1. To settle it: run one stale-award harvest against a deployed Worker and check for a 409 rather
  than a 500.
- **`npm run build` (Vite).** It cannot run here, so the `main.ts` change (option building) is
  type-checked and lint-clean but never bundled.
- **No browser was driven.** The planting control and the progression panel were never observed
  rendering. The manual pass: bootstrap, create a farm, confirm `Carrot`, `Wheat (level 2)`,
  `Corn (level 3)` with the last two disabled, harvest carrots to 120 xp, and confirm wheat becomes
  selectable after the next action without a reload.
- **The smoke suite and the per-file runner are local harness code**, not `vitest` (which cannot spawn
  here), so test *counts* come from that runner. 273 tests pass in 33 files (272 before section 6 added
  the retune-procedure test), `tsc --noEmit` and
  `eslint --max-warnings=0` are clean, and the smoke suite passes 112/112 — before and after this
  audit's fixes.
- Documentation, including both ADRs, was written by the implementing agent; I read it as claims to
  check, not as evidence, and every claim used above was re-derived from code, tests, or the probe.

## 6. Re-audit of the follow-up fixes

Second pass, against the working tree on top of `0857e93` (11 modified files, 2 new). The three
falsification targets from the re-audit request, in order. Everything below was measured on this
machine. Method: a copy of the repository in `%TEMP%` (sources and `tests/`, `node_modules` junctioned)
with `HAPPY_FARM_ROOT` pointed at it, so a source file can be reverted to `HEAD` or mutated without
touching the audited tree; the audited tree was never modified to run a mutant.

### (a) Do the fixes close exactly the findings they claim, and add no new hole?

| Finding | Fix under test | Mutation | Result | Verdict |
| --- | --- | --- | --- | --- |
| 2 (unlock failed open) | `packages/domain/src/crop.ts:70-73` | revert `crop.ts` to `HEAD` | `tests/domain/crop-unlock.test.ts` → 1 failed, `expected true to be false` at the new assertion; `tests/application/harvest-crop.test.ts` stayed 17/17, so the two fixes do not mask each other | closes it |
| 3 (replay echoed an invalid award) | `packages/application/src/harvest.ts:83-89` | revert `harvest.ts` to `HEAD` | `refuses to echo a stored award that is not a valid progression` → `expected promise to reject with { code: "INTERNAL_ERROR" } but it resolved`; `crop-unlock.test.ts` stayed 6/6 | closes it |
| 4 (four untied ceilings) | `tests/game-data/schema.test.ts:206-217` | raise the game-data caps to 20,000 and set `maxLevel` 10,001 / `requiredLevel` 12,000 | new assertion failed: `expected 10001 to be less than or equal to 10000` | closes it, with the redundancy below |
| 5 (prompt asserted a false fact) | `docs/reviews/AUDIT_PROMPT_PHASE_4A_4B.md` | read the new text | it now names the two lines `4e7b89c` added to `workers/api/src/index.ts` and still asks the auditor to confirm the entrypoint fails closed | closes it |
| 1 (retune strands harvests) | recorded in ADR 0008, no code change | re-derive the refusal on real SQLite | `assertProgression` refuses `level 32, xp 60000` under a cap-10 curve (`INVALID_PROGRESSION`), so the harvest 500s | recorded correctly, **but the remedy was not executable — finding 6** |

Fixes 2–5 add no new hole, and each closes exactly its finding and nothing else: in both mutation runs
the sibling test file stayed green, so the attribution is clean rather than a cascade.

**Finding 4's crop loop has no detection power of its own.** `tests/game-data/schema.test.ts:199`,
which predates this audit, already asserts every `requiredLevel <= playerProgression.maxLevel`, and the
new line 213 asserts `playerProgression.maxLevel <= MAX_PROGRESSION_LEVEL`. Those two together already
give `requiredLevel <= MAX_PROGRESSION_LEVEL`, which is what the new loop at line 215 asserts, so the
loop can never be the assertion that fires. The mutant shows it: the failure surfaced at line 213 and
the loop was never reached. The real new coverage is line 213 — nothing else tied `maxLevel` to the
contract bound. The loop is harmless and local, but it is not the guard it looks like.

### (b) Is finding 1's severity right, and would the ADR-level alternative weaken the invariant?

**Severity stands at P2.** It fires only when the curve data changes, it never loses or duplicates
value, it is loud (HTTP 500), and it is confined to the write path — reads keep working. What this pass
changed is the cost of the remedy, not the severity of the bug.

Measured, with the row written under `{maxLevel: 50, xpStep: 120}` (`level 32, xp 60000,
progression_version 7`; 60,000 sits in level 32's band, which starts at `cumulativeXpForLevel(32)` =
59,520) and read under the retuned `{maxLevel: 10, xpStep: 120}`:

- `progressionView(B, 60000)` → `{ level: 10, xp: 60000, xpIntoLevel: 54600, xpForNextLevel: 0, maxLevel: 10 }`.
- `storedLevel(B, row{level: 32})` → `10`; `storedLevel(B, row{level: 10})` → `10`;
  `storedLevel(B, row{level: 999, xp: 60000})` → `10`. The cached column is never consulted.
- `createXpAward(B, row, 4, ...)` → `INVALID_PROGRESSION | Stored level does not match stored experience`.

**Would option (b) — derive the current level in `createXpAward` from `xp` instead of refusing a
level-only disagreement — weaken "level is always `levelForXp(xp)`" on any read path? No, and the
measurement above is the falsification attempt.** Every read path derives and none reads the column:
`progressionView` (`packages/application/src/progression.ts:44-53`) takes `xp` only; `storedLevel`
(`:63-70`) calls `levelForXp(definition, stored.xp)` and refuses only when that call throws on the
experience itself; `GetProgression.execute` (`:80-85`) returns `progressionView(...)`. Three different
cached levels — 32, 10, and a nonsense 999 — all produce the same derived answer, so the column cannot
leak into a read path. The write path would stay consistent too, because the guarded `UPDATE` writes
`award.levelAfter`, which `createXpAward` computes as `levelForXp(definition, xpAfter)`
(`packages/domain/src/progression.ts:139-149`): the row is consistent again after any successful award.

**Option (b) nevertheless does not free a retuned player's harvest, which is why I did not take it.**
Deriving gives `currentLevel = 10`, `levelAfter = 10` for a 4-xp award, and the settlement then issues
the same guarded statement it issues today, with `NEW.level = 10` against `OLD.level = 32`:

```text
UPDATE player_progression SET level=?, xp=?, progression_version=progression_version+1, updated_at=?
  WHERE player_id=? AND xp=? AND progression_version=?
-> ABORTED: player progression cannot regress
```

`settleHarvestAtomically` maps that message to `PROGRESSION_CONFLICT`
(`workers/api/src/d1-repositories.ts:671-677`), so `HarvestCrop`'s eight-attempt loop
(`packages/application/src/harvest.ts:165-210`) would re-read, recompute the same award, and abort eight
times before giving up, and the client would receive HTTP 409
(`workers/api/src/handler.ts:185-186`) — told to retry a conflict that can never resolve, where today
it gets an honest 500. So (b) is safe for the invariant on both sides but insufficient alone as a
retune fix; it has to be paired with finding 6's trigger change. The opposite argument is real too: (b)
makes a retune self-heal on the next harvest, with no deployment-order step an operator can forget.
The refusal (b) would delete is pinned on purpose by `tests/domain/progression.test.ts:106` ("refuses a
stored row this curve could not have produced"), so (b) is a team decision, not a bug fix.

### (c) Can the newly added tests fail against the bug they target?

| Added test | Target | Measured |
| --- | --- | --- |
| `tests/domain/crop-unlock.test.ts` "locks a crop whose requirement is below the level every player starts at" | `requiredLevel <= 0` unlocking the crop for everyone | **Fails.** With `crop.ts` at `HEAD`: `expected true to be false`, line 69. |
| `tests/application/harvest-crop.test.ts` "refuses to echo a stored award that is not a valid progression" | a replay echoing `level 0` / `maxLevel 0` | **Fails.** With `harvest.ts` at `HEAD`: `expected promise to reject with { code: "INTERNAL_ERROR" } but it resolved`. |
| `tests/game-data/schema.test.ts` "keeps every shipped level ceiling inside the bound the API contract validates against" (line 213) | a game-data ceiling above `MAX_PROGRESSION_LEVEL` | **Fails.** Caps raised and `maxLevel` 10,001: `expected 10001 to be less than or equal to 10000`. The crop loop at line 215 cannot fail alone (see (a)). |
| `tests/api/handler.test.ts` `ProgressionEnvelopeSchema.parse(...)` on both `GET /progression` bodies | a served progression shape the client's validator rejects | **Fails, with a caveat.** Serving `maxLevel: 1` → `Too small: expected number to be >=2` at `data.progression.maxLevel`. The caveat: the `toEqual` literal this replaced fails on the same mutant (50 ≠ 1), so the wrapper adds contract coupling, not detection power, for these two assertions. It is not what catches a wrong number. |
| `tests/integration/progression-migration.test.ts` "keeps the monotonic guard while a retune rewrites the cached level" (added in this pass) | a retune procedure that cannot run, or that leaves the guard down | **Fails, both halves.** Deleting the `DROP TRIGGER` step → `player progression cannot regress`; deleting the `CREATE TRIGGER` restore → `expected [Function] to throw an error matching /regress/i`. |

So four of the five can fail against the bug they target, measured by mutation; the handler test's
added value is coupling rather than detection, and it is not counted as catching a bug.

### Still not verifiable

Unchanged from section 5, and still why several statements above are argued rather than executed: true
parallel D1 contention (native `workerd` cannot start here, `0xc0000005`), the D1 error-message
contract (the `PROGRESSION_CONFLICT` mapping depends on D1 surfacing SQLite's `RAISE` text inside
`error.message`; observed only against `node:sqlite`), `npm run build` (the bundler cannot spawn here),
and any browser behaviour. New in this pass: the retune procedure is verified against `node:sqlite` and
the development migration runner, not against `wrangler d1 migrations apply`.
