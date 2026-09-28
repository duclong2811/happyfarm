# Phase 4B review (implementation-side)

Review date: 2026-09-28
Reviewer: the implementation agent, on its own Phase 4B working tree
Baseline: `24c2d3d` (`feat: add a glTF crop model pipeline to the 3D view`); Phase 4A is staged
above it and uncommitted, so the Phase 4B changes are the *unstaged* working tree on top of a staged
Phase 4A index.
Scope: `packages/domain/src/crop.ts`, `packages/game-data/src/crops/index.ts`,
`packages/application/src/{crops,progression,ports,errors}.ts`, `packages/contracts/src/index.ts`,
`workers/api/src/{runtime,handler}.ts`, `apps/web/src/{api,main,labels}.ts`, `apps/web/index.html`,
and the tests and documentation the phase touched.
Method: full read of every changed file, then `tsc --noEmit`, `eslint --max-warnings=0`, the whole
per-file unit suite (33 files), and the end-to-end development-backend smoke test against the real
development Worker entrypoint on the Node host (112 checks).

**This is not an independent audit.** It was written by the same agent that wrote the code, so it is
a record of what was checked rather than a second opinion. The independent review for Phase 4B is
still outstanding.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P2 | `CropDefinition.requiredFarmLevel` was a trap, not an unused field. It was type-checked in the domain type, the game-data zod schema, and the `GameDataCropDefinitions` mapping, but nothing set it — and `CropStateProjector.project` **threw** `INVALID_INPUT "Crop level requirements are not available in Phase 2A"` for any definition that did. A designer setting the field would have broken `POST /farms/:id/crops` replay, `GET /farms/:id/crops`, and the harvest path's projector for every crop of that definition. The phase turned it into a feature under a correct name (`requiredLevel`) and deleted the throw. | Fixed |
| 2 | P2 | The first `isCropUnlocked` was `level >= requiredLevelFor(definition)`, which unlocks every crop for `Number.POSITIVE_INFINITY` while its own doc comment claimed malformed levels lock. Infinity is not a level `levelForXp` can return, but the rule is the last line of defence and should not have a hole in the *unlocking* direction. Fixed with a `Number.isSafeInteger(level)` guard, and `tests/domain/crop-unlock.test.ts` now enumerates the malformed levels including both infinities. | Fixed |
| 3 | P2 | `apps/web/src/labels.ts` held `PLANTABLE_CROPS = ["crop_carrot", "crop_wheat", "crop_corn"]`, a second source of truth for the crop catalogue. Adding a crop to game data would have made it unplantable from the UI, and removing one would have left the UI offering a crop the server rejects. Deleted, and the planting control is built from `GET /crop-definitions`. `tests/web/farm-assets.test.ts` had been asserting the model manifest against that constant, so it now asserts it against the game-data registry, which is the source the constant was shadowing. | Fixed |
| 4 | P3 | An existing end-to-end smoke check, "the harvested tile accepts a new crop", replanted `crop_wheat` — which the new gate refuses for a level-1 player. It failed on the first run of the full smoke suite (`expected 201, got 403`). Rather than swap the crop for an ungated one, the check now awards level 2 first and asserts both halves of the contract: wheat becomes plantable, corn stays refused. The failure is the evidence that the gate changed observable behaviour. | Fixed |
| 5 | P3 | The new smoke checks reused `requestId: "smoke_plant_0005"`, which the replant check further down the same file already used. No state was corrupted — the refusal writes no idempotency record — but a duplicate request id across two scenarios makes a future failure ambiguous. Renumbered to `smoke_plant_locked_0001`, `smoke_plant_0006`, `smoke_plant_0007`. | Fixed |
| 6 | P3 | `requiredLevel` had no upper bound in game data while `CropDefinitionDTOSchema` caps it at `MAX_PROGRESSION_LEVEL` (10,000) and `player_progression.level` is checked against the same ceiling. A definition above the cap would have loaded cleanly, passed every server-side check, and then been rejected by the *client's* response validator — which would have discarded the whole catalogue, including the crops the player could plant, instead of failing at startup. Found on a second adversarial pass over the new contract; fixed by bounding the game-data schema at the same ceiling, with a test at 10,000 and 10,001. | Fixed |

No P0 or P1 was found. The two P2 defects are both in this phase's own new code (2) or in the field
this phase inherited (1); (3) and (4) are pre-existing duplication and behaviour-change fallout.

## What changed, and why

- **One reader, one interpreter, one enforcement point, one place to set it.** `requiredLevelFor` and
  `isCropUnlocked` in `packages/domain/src/crop.ts` are pure; game data sets the number;
  `PlantCrop.execute` enforces it. `packages/application` does not know what a crop's requirement is,
  only that the domain can answer whether a level satisfies it.
- **A new code, `CROP_LEVEL_REQUIRED` (403)**, because neither existing candidate was right:
  `NOT_AUTHORIZED` means "not allowed on this farm", and 400 would call a well-formed command
  malformed. The response body is still `{code, requestId}` — no level, no curve — because the client
  already has both numbers from `GET /progression` and the catalogue.
- **A read-only catalogue**, `GET /crop-definitions`, authenticated and projected from game data. No
  database read, no mutation, no player state, and only the six fields the planting control needs.
- **Reading stays ungated.** `CropStateProjector` lost the Phase 2A throw and gained a comment saying
  why: a crop already in the ground keeps reporting its growth even if a later curve locks it.
- **The client is still not authoritative.** It computes no threshold: `cropIsLocked` compares the
  server's level against the server's requirement, and disabling an `<option>` is presented as a
  courtesy, not a boundary.

## Answers to the audit questions

**1. Can any route accept a level, an experience total, or a crop requirement from a client?** No.
`POST /farms/:farmId/crops` still parses only `requestId`, `cropDefinitionId`, `x`, `y`, and
`expectedTileVersion` through the strict schema, and the new route takes no body at all.
`GetCropDefinitionsResponseSchema` and `CropDefinitionDTOSchema` are strict and reject the injected
fields `tests/contracts/validation.test.ts` enumerates, including `playerId` and `level`. The level
the gate compares is `storedLevel(this.progressionDefinition, await this.progression.find(actor.playerId))`
— the actor's own row, derived from stored experience.

**2. Is `PlantCrop` the only way a crop row is created?** Yes. `CropInstanceRepository.plantAtomically`
is the only insert path in the application layer, and `PlantCrop` is its only caller in
`workers/api`. The gate sits inside that call, before the record is built, so there is no ordering in
which a row is written and then refused.

**3. Can a refused plant leave partial state?** No, and the test asserts it rather than assuming it:
`refuses a crop above the player's level without writing anything` compares the `crop_instances` and
`idempotency_keys` counts before and after two refusals and finds them equal, then checks the tile is
still empty. The refusal is also ahead of `ids.newCropInstanceId()`, so no id is consumed, and ahead
of `plantAtomically`, so no settlement is attempted.

**4. Is the level read from experience rather than the cached column?** Yes: `storedLevel` calls
`levelForXp(definition, stored.xp)` and ignores `stored.level`. A row the curve could not have
produced throws `ApplicationError("INTERNAL_ERROR")` rather than being compared, so a damaged read
can never be the thing that grants access — it refuses instead. `derives the level from experience
rather than trusting the stored level column` seeds a row claiming level 25 with 0 experience and
asserts wheat is still refused. A player with no row reads as level 1, which is exactly what
`emptyProgression` and `GET /progression` report.

**5. Is `isCropUnlocked` total and fail-closed?** Yes, now. It is `Number.isSafeInteger(level) &&
level >= requiredLevelFor(definition)`, so `0`, negatives, fractions, `NaN`, both infinities, and any
integer beyond the safe range lock the crop — including for the crop with no requirement, since the
absent requirement resolves to level 1 and 0 is not a level. `tests/domain/crop-unlock.test.ts`
enumerates all of them against both a gated and an ungated definition.

**6. Does the catalogue read or write anything it should not?** `ListCropDefinitions.execute` calls
`this.definitions.list()` on the game-data-backed repository and maps six fields. `GameDataCropDefinitions.list()`
touches only the in-process registry. No `D1DatabaseLike` is reachable from the use case, the route
performs no read, and the handler test asserts the exact key set of every entry, so a seventh field
could not be added without failing.

**7. Is reading still ungated?** Yes. `CropStateProjector.project` has no level logic at all, and
`GetFarmCrops` calls it for every row `listByFarm` returns. The comment at the projector states the
rule so it is not "restored" later. Could a crop the player cannot plant today be *in* the ground?
Only if the curve was retuned after planting, which is the case the comment names.

**8. Does the client hold a crop list, a threshold, or treat a disabled option as a boundary?** It
holds no list: `PLANTABLE_CROPS` is deleted and `renderCrops` builds the options from
`state.cropDefinitions`, which comes from `GET /crop-definitions`. It computes no threshold:
`cropIsLocked` compares `state.progression.level` (server-derived) against `requiredLevel`
(server-provided). It does not claim to be a boundary: `docs/development.md` and the ADR both say the
server refuses either way, and the error label for `CROP_LEVEL_REQUIRED` exists precisely because the
client can be wrong.

**9. Can the new tests fail?** The discriminating ones:
- `refuses a crop above the player's level without writing anything` fails if the gate is removed
  (the plant succeeds) or moved after the write (the counts move).
- `unlocks wheat at level 2 and keeps corn locked until level 3` fails if the gate reads the cached
  column, if the requirement is off by one, or if the requirement is dropped from game data.
- `derives the level from experience rather than trusting the stored level column` fails only if the
  gate stops deriving; it is the one case a level-column read would pass and the xp read rejects.
- The handler test `serves the crop catalogue and gates planting by the level it reports` fails if
  the route is not wired, if the DTO gains a field, or if the gate is bypassed at the HTTP layer, and
  it checks the *positive* direction too: a level-2 player planting wheat gets 201.
- The smoke checks fail if the gate does not read the same row `GET /progression` reports, because
  the level comes from a direct database write rather than from the API.
Not covered: the client's own rendering. `renderCrops` is DOM code in `main.ts`, and this repository
has no DOM test harness, so what is verified is the shape of the data it consumes, not its output.

**10. Is production authentication untouched?** Yes. `workers/api/src/index.ts` was not modified in
this phase, the working-tree diff contains no change to `dev-auth.ts`, `dev-index.ts`, or
`dev-player-repository.ts`, and the smoke suite's production-isolation checks still pass, including
`POST /farms` with the dev token against the production entrypoint and `/__dev/bootstrap` returning
`RESOURCE_NOT_FOUND`. The bootstrap still creates only the player: nothing in this phase writes
`player_progression` outside the harvest settlement, and a refused plant writes nothing at all.

## Not verified

- **No browser was driven.** The planting control was not observed rendering. One manual pass is
  needed: bootstrap, create a farm, confirm the select reads `Carrot`, `Wheat (level 2)`,
  `Corn (level 3)` with wheat and corn disabled, harvest carrots to level 2, and confirm wheat becomes
  selectable without a reload. The re-render path (`refreshAccount` → `ensurePlantableSelection` →
  `render()` → `renderCrops`) is read but not executed.
- **`npm run build` (Vite) could not be run** by this agent, so the DOM change to `main.ts` is
  type-checked and lint-clean but not bundled. `renderCrops` uses only `document.createElement`,
  `replaceChildren`, and `select.value`, all already used elsewhere in the file.
- **True parallel D1 concurrency is still untested**, for the same Windows `workerd` reason as Phase
  4A. This phase adds no new concurrent write path — the gate only reads — so it does not widen that
  gap, but it does not close it either.
- The open findings from the Phase 4A review and the Phase 3.6 reviews are unchanged.
- Documentation was written by the implementing agent, including the ADR, and inherits its
  assumptions.

## Verdict

Complete for its stated scope, with no P0 or P1 found by the author. The phase removed a field that
would have thrown for every reader of a farm the moment it was used, closed an unlocking hole in its
own new rule, deleted the client's duplicate crop list, and replaced a client-side constant with a
server-served catalogue that the smoke suite now exercises end to end. `tsc --noEmit` and
`eslint --max-warnings=0` are clean, the suite is green at 33 files / 269 tests as reported by the
per-file harness runner (259 for Phase 4A plus this phase's 10 new cases), and the live development
backend passes 112/112. `vitest` itself still cannot run on this host, so the harness runner is the
only count available. Independent review and one manual browser pass are the remaining gates.
