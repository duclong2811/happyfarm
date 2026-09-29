# HappyFarm asset pipeline

Generates and validates the procedural models the farm renders: crops, the farmer, and the barn.
Nothing here is a third-party service; every model is a specification plus a generator, and the
result is a plain `.glb` a reviewer can regenerate byte for byte.

Read `docs/HAPPYFARM_ART_BIBLE.md` first: the envelope, palette, export subset and budgets are stated
there, and both paths below answer to it.

## Shipped path (no extra software)

```bash
npm run assets:generate     # writes apps/web/src/assets/models/**/*.glb
npm run assets:validate     # re-measures every shipped model against its spec
```

```
tools/asset-pipeline/node/
  glb.mjs             geometry helpers (soft boxes, tapered cylinders, blobs, leaves, fruit, roofs)
                      plus the GLB writer and a reader used for validation
  specs.mjs           one spec per model: directory, envelope, budget, builder
  generate-models.mjs builds, normalises into the envelope, writes, and refuses to exceed budget
  validate.mjs        re-measures shipped files: container, subset, no textures, envelope, budgets,
                      and no undeclared `.glb` in a generated directory
```

`tests/integration/asset-models.test.ts` runs `checkGeneratedAssets()` in CI, so a committed artifact
that drifts from its spec fails the suite rather than the browser.

Reproducibility: the builders are seeded (`seededRandom`) and the writer is deterministic, so
regenerating without editing a spec produces identical bytes.

## Blender path (authoring)

```bash
blender --background --python tools/asset-pipeline/blender/generate.py
blender --background --python tools/asset-pipeline/blender/generate.py -- --spec building_barn --out .tmp/asset-out
```

```
tools/asset-pipeline/blender/
  generate.py            spec-driven builder: bmesh parts -> join -> normalise -> export GLB
  common/palette.py      the shared palette, sRGB -> linear
  specs/*.json           the same specs the Node path uses, in a Blender-readable form
  output/                default export target
```

**Status: `BLENDER_EXECUTION_PENDING_USER`.** Blender is not installed on the development machine, so
these scripts have never been executed here and the committed `.glb` files are the Node path's
output. Nothing was downloaded or installed to change that.

The exact official requirement to run this path:

* Blender 4.2 LTS or newer, headless-capable build, from <https://www.blender.org/download/>
  (on Windows: the official installer or the `.zip` build; `blender.exe` must be on `PATH`).
* No add-ons beyond the bundled glTF 2.0 exporter that ships with Blender.
* Verify with `blender --version`, then run the command above and validate the export with
  `node tools/asset-pipeline/node/validate.mjs --from tools/asset-pipeline/blender/output`
  (copy the file into `apps/web/src/assets/models/<family>/` first).

A Blender export is not integrated because it renders; it is integrated when it validates, and only
if a browser pass shows it is at least as good as what the repository already ships.
