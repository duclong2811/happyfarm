# Phase 3.6B review (implementation-side)

Review date: 2026-09-28
Reviewer: the implementation agent, on its own Phase 3.6B working tree
Baseline: `fff29a6` (`feat: render authoritative farm and crop state in the 3D view`)
Scope: `apps/web/src/render/scene.ts`, `apps/web/src/render/assets.ts`,
`apps/web/src/render/model-urls.ts`, `apps/web/src/vite-env.d.ts`, `apps/web/src/render/index.ts`,
`apps/web/src/main.ts`, `apps/web/tools/generate-placeholder-models.mjs`,
`apps/web/src/assets/models/crop_{carrot,wheat,corn}.glb`, `apps/web/index.html`,
`apps/web/package.json`, `tests/web/farm-assets.test.ts`,
`tests/integration/crop-model-assets.test.ts`, and the documentation touched by the phase.
Method: full read of every changed file, the eight questions in
`docs/reviews/AUDIT_PROMPT_PHASE_3_6B.md` used as a checklist, then `npm run typecheck`,
`npm run lint`, the whole test suite, `git diff --check`, and a byte-for-byte regeneration of the
committed models.

**This is not an independent audit.** It was written by the same agent that wrote the code, so it is
a record of what was checked rather than a second opinion. The independent review for Phase 3.6B is
still outstanding. Nothing in this file has been reviewed by anyone else.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P3 | A model that failed to load after the scene was disposed still called `onAssetProblem`, so a torn-down view could write an asset error onto the page status line. The success path already checked `disposed`; the failure path did not. | Fixed |
| 2 | P3 | The contract test asserts that every accessor's byte length equals its whole buffer view and that no two views overlap. That is the placeholder generator's layout, not a glTF 2.0 requirement: interleaved vertex attributes, or two accessors sharing one view, are valid glTF that `GLTFLoader` renders correctly and this test would reject. | Reported, not fixed |
| 3 | P2 | Every refresh clones a loaded model subtree once per planted tile (`clone(true)` in `modelPlant`). Nothing leaks, but the cost is per-refresh allocation churn on the hot path, and it grows with both farm size and model complexity. | Reported, not fixed |
| 4 | P3 | `three` and now `GLTFLoader` sit in the initial chunk even when the 3D view is never enabled, because `main.ts` imports `./render` statically and the view is only opt-in at the button. | Reported, not fixed |
| 5 | P3 | Carried forward from the 3.6C review: the renderer's coordinate domain is narrower than the contract's. `MIN_TILE_X`/`MIN_TILE_Y` are `-1_000_000` in `packages/contracts/src/index.ts`, but `layoutFarmTiles` rejects negative coordinates and computes `columns = maxX + 1`. | Reported, not fixed |
| 6 | P3 | Carried forward from the 3.6C review: a scene created after a previous one was disposed reuses the same canvas element, so two `WebGLRenderer`s share one WebGL context. | Reported, not fixed |

### Detail on the fixed finding

Finding 1 matters because `dispose()` is the caller saying "nothing here can still be reported on",
and the graph is rebuilt by the caller afterwards in the one place disposal is reachable at all. The
guard is one line, and it is deliberately placed after the cache bookkeeping so that a late failure
still marks the model unavailable rather than allowing a retry loop on a torn-down scene.

### Detail on the reported findings

Finding 2 is the one worth a decision before real art lands. The two assertions in
`tests/integration/crop-model-assets.test.ts` that create the constraint are
`expect(accessorBytes(accessor)).toBe(view?.byteLength)` and the non-overlap fold over
`bufferViews`. A Blender or glTF-Transform export is commonly interleaved, with `POSITION` and
`NORMAL` sharing one `bufferView` and a `byteStride`, or with two accessors pointing at the same
view. Such a file renders correctly through the loader the renderer actually uses, and would fail
this test. Two honest options:

- Keep the test as a check of *this pipeline's* art contract, and state the constraint in the
  authoring contract in `apps/web/tools/generate-placeholder-models.mjs`: "non-interleaved, one
  buffer view per accessor, no `byteStride`". Then a real asset must be re-exported to match.
- Relax the test to validate what the renderer depends on - bounds, triangle counts, component
  types, views inside the buffer - and drop the byte-length equality and non-overlap checks.

Changing either without a real exported model to test against would be guessing, so it is recorded
rather than changed.

Finding 3 is the same follow-up the 3.6A notes already name: an instance pool or `InstancedMesh`
behind `applyState`. Cloning is correct today and wrong later; the fix belongs in `scene.ts` alone.

Finding 4 is a bundle-size question, not a correctness one, and the recorded answer in ADR 0007 is
to code-split the 3D view rather than to shrink the art.

### Detail on the verified-correct case

`disposeModelResources` walks `variants.growing` and then `variants.ready`, and the two variants
share geometry on purpose (`readySource` is a `clone(true)` of the same subtree). Each geometry is
therefore disposed twice. three's `dispose()` is idempotent per resource - the second call dispatches
an event for a resource the renderer has already forgotten - and the materials are genuinely
distinct objects, because `toReadyMaterial` clones before tinting. Kept as is, recorded here so a
later reader does not have to re-derive that it is harmless.

## Answers to the audit questions

**1. Can a crop draw nothing, or draw twice?** No. `applyState` resolves one `variants` value per
crop and then either calls `tileMesh` (placeholder, one mesh) or `modelPlant` (one `Group` holding a
clone of either the growing or the ready variant, never both), and adds that one object to
`tileGroup`. Two tiles of the same definition each get their own clone, so one being mature cannot
change the other. Unverified in a browser: this is read, not rendered.

**2. Is the material-clone cache correct?** Yes. `toReadyMaterial` returns the cached clone on a hit
and clones once per source material otherwise, and it tints the clone, never the source. The growing
variant keeps the loader's original materials, so a mature tile cannot tint a growing tile. The
cache is created per model inside `prepareVariants`, so the key is a material object that only that
model owns; a per-model rather than per-scene cache costs one extra clone set if two models ever
shared a material object, which each parse does not, so it is not a defect.

**3. Are the model and placeholder positioned the same way?** Yes, and the contract is what makes
that true. The placeholder cone is unit height and is scaled by `height` and centred at
`baseY + height / 2`, so it spans `TILE_THICKNESS .. TILE_THICKNESS + height`. `modelPlant` puts the
model's origin at `TILE_THICKNESS` and scales it by `height`; because the contract puts the model's
base at `y = 0` and its height at one world unit, it spans exactly the same interval. `MIN_CROP_HEIGHT`
has the same meaning in both branches: the drawn height at zero growth, so a just-planted crop is a
sprout rather than a bare tile. The height *and* the footprint scale together, which is intended for
a sprout and is the reason footprint scale is not compensated.

**4. Are the model request states free of holes?** Almost; finding 1 was one. `requestModel` returns
early when the scene is disposed, the model is already loading, or it is already known unavailable,
so there is at most one request per model per session and a broken asset is not retried on every
two-second refresh. A load that succeeds after `dispose()` releases what it downloaded instead of
installing it. A load that fails after `dispose()` no longer reports to a dead scene. None of this is
unit-testable without a WebGL context; it is read.

**5. What does one refresh allocate?** Per unlocked tile, one slab `Mesh` sharing closure-owned
geometry and material. Per planted tile with a loaded model, one `Group` plus a full `clone(true)` of
the model subtree. Everything is owned by the scene graph under `tileGroup`, so the next `applyState`
drops it and the garbage collector reclaims it; geometry and materials are shared and owned by the
closure. So a refresh is allocation-churny, not leaky. Nothing that gets tinted is shared, and the one
thing cloned that could be cached is the model subtree, which is finding 3.

**6. Are the new tests meaningful?** `tests/web/farm-assets.test.ts` covers the manifest: a plantable
crop without a model, a duplicate id, an id violating the contract's pattern, an unknown definition
resolving to a guess, and a file-name/definition-id drift. A mutant that returned the input id
unconditionally fails the "resolves an unknown crop to no model" case, and a mutant that returned the
first id fails the "resolves a known crop to its own id" case, so both halves of the membership check
are covered. `tests/integration/crop-model-assets.test.ts` covers the shipped binaries: container
integrity, chunk alignment, four-byte alignment, triangle-only primitives with positions and
normals, the exact file set against the declared ids, and the vertex bounds recomputed from the
binary chunk. The bounds case is the one that caught a real defect during this phase - the wheat
model was 0.95 units tall and only the test noticed. Uncovered by design and stated in both files:
everything in `scene.ts` (needs a WebGL context) and `model-urls.ts` (a bundler feature plain Node
cannot resolve). The exact-set case is what closes that hole for the second one, because a file the
import path could no longer resolve fails the set equality.

**7. Is the contract test a fair glTF test?** No - see finding 2. It is a fair test of the art this
pipeline ships and a stricter test than glTF 2.0 requires.

**8. Does replacing a placeholder require a code change?** No. Swapping a file changes no code, and
the three failure modes are all caught: a declared id without a file (exact-set equality, plus a hard
build error from the `?url` import), a file without a declaration (exact-set equality), and a file
that violates the contract (the bounds, primitive, and accessor cases). Adding a new crop needs both
an entry in `assets.ts` and a file, and one of the two tests fails if only one of them happened.

## Verification actually run

- `npm run typecheck` passed and `npm run lint` passed (`--max-warnings=0`).
- The whole suite passed: 28 files, 224 tests, 0 failures. The two new files contribute 5 and 16.
- `node apps/web/tools/generate-placeholder-models.mjs` reproduces all three committed models
  byte for byte - sha256 identical before and after - so the generator and the artifacts cannot drift.
- `git diff --check` reported no whitespace errors.

## Not verified

- No browser was driven, so nothing was rendered. The model path, the fallback path, and the
  maturity tint are read, not observed. One manual pass is still needed: plant each of the three
  crops and confirm the real model replaces the cone, that a mature crop is tinted, and that a
  deliberately renamed or corrupted model file leaves the placeholder and reports on the status line.
- `npm run build` (Vite) could not be run by the reviewing agent, because the sandbox blocks
  `spawn`. `GLTFLoader` is a static import of `scene.ts` and the three models are `?url` imports, so
  the main chunk grows by the loader plus roughly 18 kB of models from the 629 kB / 163 kB gzip
  recorded at 3.6C. Confirm on the next `npm run build`, and expect the chunk-size warning to stand.
- Anything needing a real WebGL context: picking accuracy, the frame cost of rebuilding the scene
  graph every two seconds on a loaded farm, and the clone churn in finding 3.
- Phase 3.6B does not address the Phase 3 audit's condition 5 - a real `workerd`/D1 contention test
  for parallel wallet writes and duplicate request ids - which remains blocked by the native
  `workerd` crash on this Windows machine. Conditions 1 to 3 of that audit are landed and were
  re-read here: the development proxy bounds and abandons an oversized body, each local migration
  commits with its tracking row or rolls back, and dynamic path segments decode through
  `decodePathSegment` into `INVALID_INPUT` rather than a 500.

## Verdict

Complete for its stated scope. One P3 was found and fixed, three findings are reported with a
decision owed on the contract test and on the per-refresh clone, two are carried forward from 3.6C,
and the suite is green at 28 files / 224 tests with the generator reproducing its artifacts exactly.
Independent review and one manual browser pass are the remaining gates.