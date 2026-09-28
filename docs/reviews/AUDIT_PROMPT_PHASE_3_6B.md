# Independent audit request: HappyFarm Phase 3.6B (glTF crop asset pipeline)

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

Phase 3.6B: crops no longer draw always-placeholder geometry. A crop draws a real glTF 2.0 binary
from `apps/web/src/assets/models/`, loaded through three.js `GLTFLoader`, with placeholder geometry
as the fallback. The phase also adds a manifest that maps a crop definition to a model, a committed
generator for the placeholder models, and a contract test that parses the shipped binaries.

Artifacts to attach to the conversation (all of them, not a summary):

1. `git add -A && git diff --cached fff29a6`, saved as a single unified diff. Phase 3.6B is
   uncommitted work sitting on top of `fff29a6`.
2. The full current contents of these files, because a diff hides their surroundings:
   - `apps/web/src/render/scene.ts`
   - `apps/web/src/render/assets.ts`
   - `apps/web/src/render/model-urls.ts`
   - `apps/web/src/vite-env.d.ts`
   - `apps/web/src/main.ts`
   - `apps/web/tools/generate-placeholder-models.mjs`
   - `tests/web/farm-assets.test.ts`
   - `tests/integration/crop-model-assets.test.ts`
   - `apps/web/index.html`
3. The three binaries themselves, attached as files:
   `apps/web/src/assets/models/crop_carrot.glb`, `crop_wheat.glb`, `crop_corn.glb`. Binary art cannot
   be reviewed in a diff. If the surface cannot carry binaries, run
   `npm run assets:generate --workspace @happy-farm/web` and say so.
4. `docs/decisions/0007-renderer-foundation-and-plain-typescript-client.md`.

Commit `fff29a6` is Phase 3.6C (rendering the authoritative farm and crop state in 3D), `fbdb693` is
Phase 3.6A (renderer foundation), and `dc036be` holds the audited economy, development
authentication, and playable development UI. Do not re-audit those. Their findings are already
recorded in `docs/reviews/PHASE_3_GPT56_INDEPENDENT_AUDIT.md` and
`docs/reviews/PHASE_3_6C_IMPLEMENTATION_REVIEW.md`. Only report an earlier-phase issue if Phase 3.6B
introduces or exposes it.

## Invariants this phase must not break

Judge each one and say how you verified it:

1. Models are appearance only. Adding a model changes what a crop looks like and nothing about what
   the game decides: not growth, not maturity, not reward, not identity, not balance.
2. A crop always draws something. No combination of "this build ships no model for the definition",
   "the model is still loading", and "the model failed to load" may blank a tile, throw into the
   refresh path, or stop the authoritative refresh from completing.
3. The authoring contract holds for every shipped model - one world unit tall, base on y = 0,
   footprint inside a 1 x 1 square centred on the origin - and the renderer's uniform-scale
   assumption is the same contract, with no second per-model tuning factor anywhere.
4. `assets.ts` stays pure: no three, no DOM, no clock, no network. An unknown crop definition
   resolves to "no model" rather than to a guess, because `CropDefinitionId` is an open pattern the
   server can extend at any time.
5. Maturity is still display only and server-derived. The emissive tint is applied to material
   clones, so a mature crop can never tint a growing crop that shares the same model.
6. No new authority or network path. Model URLs come from the bundler, never from a runtime string,
   and the renderer still never fetches authoritative state.
7. Nothing outside `apps/web/src/render/` imports `three`, and production authentication is
   untouched (`workers/api/src/index.ts` still fails closed).
8. Disposal releases what the phase allocates, and repeated refreshes do not grow GPU memory or the
   JS heap without bound.

## Specific questions to answer

1. Trace every path from `modelVariants` to what ends up in the scene graph. Can a crop draw
   nothing, or draw twice, when the same model serves several tiles and some of those tiles are
   mature while others are not?
2. Is the material-clone cache correct? Consider two crops of the same definition where one is
   mature: can the tint leak into the growing one, can a material be tinted twice, and is the cache
   key the right thing?
3. Trace `modelPlant` and the placeholder branch. Is the drawn base exactly on the tile surface at
   growth zero, at growth one, and for a model whose geometry is authored as the contract requires?
   Does `MIN_CROP_HEIGHT` mean the same thing for a placeholder cone and for a loaded model?
4. Are `loadingModels`, `unavailableModels`, `models`, and the `disposed` flag free of states that
   request forever, retry forever, report a result to a torn-down scene, or leak? Consider a load
   that completes after `dispose()`, and one that fails after `dispose()`.
5. Count what a single refresh allocates per planted tile, and say who owns it and when it is
   released. Is anything cloned per refresh that should be cached, or cached that should be cloned?
6. Do the two new tests fail when the rule they claim to protect is broken? Name any test that would
   still pass on a mutant, and any rule in the new code that has no test at all.
7. Is the contract test in `tests/integration/crop-model-assets.test.ts` a fair test of glTF 2.0, or
   does it encode the placeholder generator's specific buffer layout? State concretely what a real
   exporter (Blender, glTF-Transform) would have to produce for it to pass, and whether a legitimate
   real asset could fail it.
8. Does replacing a placeholder with real art require any code change, and does a test catch the
   cases where it would? Include the "declared without a file", "file without a declaration", and
   "file that violates the contract" cases.

## Method

- Read the diff and the full files before judging anything. Say when you are inferring behaviour
  instead of reading it.
- You have no browser and no Cloudflare runtime. Do not claim you rendered anything. If a question
  needs a running WebGL context, say that it is unverifiable from the artifacts and explain exactly
  what a human would have to do to settle it.
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