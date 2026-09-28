# Independent audit request: HappyFarm Phase 3.6C (3D farm rendering from authoritative state)

You are an independent reviewer. You did not write this code. Your job is to find defects, not to
confirm that the work is good. A finding of "nothing wrong" is only useful if you can say what you
checked and what you could not check.

## Project

Browser farm game at `C:\Project\HappyFarm`. Cloudflare-native and server-authoritative:

- TypeScript monorepo: `packages/{domain,application,contracts,game-data}`, `workers/api`,
  `apps/web` (plain TypeScript + Vite, no React), `tests/`.
- Cloudflare Workers + D1 in production. Development uses a Node host for the same Worker
  entrypoint because the native `workerd` runtime crashes on this Windows machine.
- The client is not authoritative about economy, inventory, time, rewards, or player identity.

## What to audit

Phase 3.6C: the 3D view now renders the real farm and crop state instead of bare land.

Artifacts to attach to the conversation (all of them, not a summary):

1. `git diff fbdb693 HEAD` (or, if 3.6C has not been committed yet, the working tree against
   `fbdb693`: `git add -A && git diff --cached fbdb693`), saved as a single unified diff.
2. The full current contents of these files, because a diff hides their surroundings:
   - `apps/web/src/render/view-model.ts`
   - `apps/web/src/render/scene.ts`
   - `apps/web/src/render/layout.ts`
   - `apps/web/src/main.ts`
   - `apps/web/index.html`
   - `tests/web/farm-view-model.test.ts`
3. `docs/decisions/0007-renderer-foundation-and-plain-typescript-client.md`.

Also relevant for the contract shapes: `packages/contracts/src/index.ts` (the `FarmTileDTO` and
`CropStateDTO` definitions).

Commit `fbdb693` is the Phase 3.6A renderer foundation. Commit `dc036be` holds the audited economy,
development authentication, and playable development UI. Do not re-audit the economy or the
authentication bridge; another review covers those, and their findings are already recorded in
`docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md`. Only report an economy or authentication issue if
Phase 3.6C introduces or exposes it.

## Invariants this phase must not break

Judge each one and say how you verified it:

1. The renderer never fetches and never decides anything about the game. It receives render
   descriptors, not contract DTOs.
2. Growth is display only. `growthProgress` and `mature` come from the server; maturity is never
   derived from a client clock, and a wrong or tampered local clock cannot make a crop look ripe.
3. A crop is drawn only when the server also returned its tile as unlocked land, so a stale or
   unknown crop row cannot make the client invent land.
4. Selection is one piece of state. The 2D grid and the 3D view read and write the same value, and
   the renderer reports only a coordinate, not a game action.
5. `layout.ts` and `view-model.ts` stay pure: no three, no DOM, no clock, no network.
6. Nothing outside `apps/web/src/render/` imports `three`, and only `FarmSceneHandle` crosses into
   `main.ts`.
7. Production authentication is untouched. `workers/api/src/index.ts` still fails closed.

## Specific questions to answer

1. Does the view model ever let a crop appear on land the server did not return, or let a crop
   disappear while the server still reports it planted? Check the duplicate-coordinate rules and
   the case where `crops` contains a coordinate that `tiles` does not.
2. Is the growth-to-height mapping monotonic and correctly clamped for the full input range,
   including `growthProgress` of exactly 0, exactly 1, negative, greater than 1, and non-finite?
   Does a just-planted crop render as a visible sprout?
3. Are the tile slab and the crop mesh positioned correctly relative to the ground and to each
   other? Trace the geometry construction, the scale, and the vertical placement, including the
   selection ring's height above the tile surface. Look for a dimension that is applied twice.
4. Is picking correct? Consider a click that hits a crop rather than the slab, a click that hits
   nothing, a canvas whose CSS size differs from its buffer size, and a device pixel ratio greater
   than 1. Does the raycaster use the same camera the frame was drawn with?
5. Does the scene leak GPU resources or DOM listeners across repeated `setState` calls, repeated
   `createFarmScene` calls, or `dispose()` followed by a new scene on the same canvas? Distinguish
   what `dispose()` actually releases from what it leaves to garbage collection, and whether that
   distinction is documented and acceptable here.
6. Does `main.ts` keep a single source of truth for selection and farm state? Look for a path where
   the 3D view shows state the 2D grid does not, or where a selection survives a farm change and
   points at a tile that no longer exists.
7. Does anything in the new client code treat the browser as authoritative about time, rewards,
   inventory, balance, or identity?
8. Are the new tests meaningful? Identify any test that would still pass if the rule it claims to
   protect were broken, and any rule in `view-model.ts` that has no test.

## Method

- Read the diff and the full files before judging anything. Say when you are inferring behaviour
  instead of reading it.
- You have no browser and no Cloudflare runtime. Do not claim you rendered anything. If a question
  needs a running WebGL context or D1, say that it is unverifiable from the artifacts and explain
  exactly what a human would have to do to settle it.
- Prefer a defect with a concrete failing scenario over a style preference. Do not report naming,
  formatting, or documentation wording.

## Severity

- P0: a security, economy, or data-integrity defect, or a crash on a normal path.
- P1: a logic defect a player would hit.
- P2: a rendering, resource, or robustness defect that is visible or costly but not exploitable.
- P3: a correctness nit with no realistic user impact.

## Output format

1. Verdict: PASS, PASS WITH FIXES, or FAIL, with one sentence of justification.
2. Findings table: severity, finding, the file and line it lives at, and the concrete scenario that
   triggers it.
3. For each finding, the minimal fix you would make. If the code is correct, say that plainly
   instead of inventing a finding.
4. Answers to the eight questions above, in order, each with the evidence you used.
5. Anything you could not verify from the artifacts, and what would settle it.