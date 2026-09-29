# ADR 0007: Plain-TypeScript client and the Three.js renderer foundation

Status: Accepted

## Problem

`AGENTS.md` names React + Three.js / React Three Fiber as the primary client stack, but the
repository has no React: `apps/web` is plain TypeScript + Vite, and the whole Phase 3.5B loop
(create/load farm, buy, plant, harvest, inventory, sell, wallet) is built on that foundation. Phase
3.6A needs a 3D renderer, so the client stack question can no longer be deferred by simply not
writing client code.

Two things needed deciding: whether to introduce React now, and how a renderer relates to the
server-authoritative state the UI already holds.

## Decisions

### The client stays plain TypeScript for now

- `apps/web` continues with plain TypeScript + Vite. React and React Three Fiber stay the intended
  destination for the full client, but adopting them now would rewrite a working, reviewed UI to
  satisfy a stack preference, with no gameplay or rendering benefit yet.
- Revisit when a real reason appears: shared component state that plain DOM helpers handle badly,
  several screens with routing, or React-only ecosystem pieces the project actually needs. That is
  a deliberate rewrite of the UI layer, not an incremental import.

### `three` is used directly, behind one module boundary

- The renderer lives in `apps/web/src/render/`. Everything above it, meaning the UI shell and the
  API client, knows only `FarmSceneHandle`.
- `layout.ts` is pure: authoritative tile coordinates in, world positions out. It imports nothing
  from three, the DOM, or the network, so scene geometry is testable without a WebGL context.
  `scene.ts` owns three.js, the canvas, sizing, and disposal.
- The renderer receives coordinates, never DTOs, and never fetches. It draws what the server said
  and cannot invent land, crops, growth, or prices. Rendering stays a projection of server state.

### Rendering is on demand, not a free-running loop

- A frame is drawn when the tiles change, when the canvas is resized through `ResizeObserver`, and
  when the caller asks. Nothing animates yet, so a `requestAnimationFrame` loop would redraw an
  identical image while holding a GPU wake-up open for the whole session. The loop arrives with the
  first animated content, not before it.

### Scope of 3.6A

- In scope: canvas, scene, camera framed to the tile area, lights, ground, one placeholder slab per
  unlocked tile, resize handling, disposal, and a WebGL-unavailable failure the UI reports.
- Deliberately out of scope: crop visuals and materials (3.6B asset pipeline), mapping crop state,
  growth progress, and selection into the scene (3.6C), and any animation.

### A pure view model sits between API state and the renderer (3.6C)

- `view-model.ts` turns the `GET /farms/:farmId/tiles` and `GET /farms/:farmId/crops` payloads into
  render descriptors. It is pure: no three, no DOM, no clock, no network. What the 3D view shows is
  therefore assertable in a unit test, which `scene.ts` itself cannot be without a WebGL context.
- Two rules live there rather than in the renderer. A crop is drawn only when the server also
  returned its tile as unlocked land, so a stale or unknown crop row cannot invent land. And growth
  is display only: `growthProgress` and `mature` are taken from the server, and maturity is never
  derived from a client clock, so a wrong or tampered local clock cannot make a crop look ripe.
- Duplicate coordinates collapse to the first row, and `layoutFarmTiles` collapses them too, so
  re-rendering a farm cannot stack overlapping meshes or reshuffle them between refreshes.

### Scope of 3.6C

- In scope: `view-model.ts`, one crop mesh per planted tile with server-reported height and a
  mature colour, terrain colours per `terrainType`, a selection ring, raycast picking that reports
  the clicked tile back to the UI, and one shared selection state driving both the 2D grid and the
  3D view.
- Deliberately out of scope: real art, textures, and GLB/GLTF assets (3.6B), animation, and any
  renderer-side gameplay decision.
- Follow-up for when farm size or asset cost grows: replace the rebuilt scene graph in `applyState`
  with an instance pool or `InstancedMesh`. Rebuilding per refresh is fine for the 36 starter tiles
  and wrong later; `applyState` is the single place that has to change.

### The asset pipeline (3.6B)

- Models are real glTF 2.0 binaries under `apps/web/src/assets/models/`, imported with Vite's
  `?url`. That puts a model inside the module graph: the bundler hashes and copies it, and a missing
  or misspelled file is a build error rather than a 404 a player finds.
- `assets.ts` is the pure half of the pipeline. It maps a crop definition id to the model this build
  ships for it, and answers "none" for a definition it has never seen, because `CropDefinitionId` is
  an open pattern the server can extend at any time. `model-urls.ts` is the other half and the only
  client module a unit test cannot load, so it is kept to one mechanical translation from ids to
  bundled URLs, typed `Record<CropModelId, string>` so that adding an id breaks the build until a
  file is imported for it.
- Every model is held to one authoring contract: one world unit tall, base on y = 0, footprint
  inside a 1 x 1 square centred on the origin, non-indexed triangle primitives, and one
  non-overlapping buffer view per accessor with no interleaving. The last constraints are a narrow
  repository authoring convention, not requirements of glTF 2.0; valid interleaved assets must be
  converted before commit or the contract must be deliberately broadened with a real fixture.
  Rendering then scales uniformly by the crop's display height, which is both the height and the
  footprint, so no per-model tuning factor can drift.
- The placeholder models are generated by `apps/web/tools/generate-placeholder-models.mjs`
  (`npm run assets:generate --workspace @happy-farm/web`). Committing a generator instead of three
  unexplained binaries means the geometry and colours are reviewable as code and the artifacts are
  reproducible. Real art replaces the files by name and changes no code.
- The renderer caches models, draws placeholder geometry for one that has not arrived yet, and keeps
  the placeholder when one fails to load. A missing or broken asset degrades a crop's appearance; it
  never blanks a tile and never stops a refresh.
- Maturity stays placeholder art direction: a ripe crop keeps its model and gains an emissive tint,
  using material clones cached per source material so that growing crops sharing the same model are
  untouched and nothing is allocated per tile.

### Renderer coordinate domain

`layoutFarmTiles` is origin-agnostic: its extent is `max - min + 1`, it centres on the actual bounds,
and it accepts negative safe-integer coordinates advertised by `packages/contracts`. Explicit world
frames use the same rule. Deterministic tests cover negative X, negative Y/world Z, mixed-sign farms,
and an expanded frame, so future land layouts cannot silently restore the old origin-only assumption.

## Consequences

- The 3D view is opt-in behind a button. Creating a WebGL context is the one thing the page cannot
  take back, so a headless or WebGL-less environment is unaffected until the user asks for it.
- `three` (`^0.186.1`) becomes a runtime dependency of `@happy-farm/web` and therefore part of the
  browser bundle, and from 3.6B so is `three/examples/jsm/loaders/GLTFLoader.js`. Measured on this
  repository: 3.6A was 622 kB / 160 kB gzip, 3.6C 629 kB / 163 kB, and 3.6B adds the loader and
  roughly 18 kB of models on top. Still one static chunk, so the build's chunk-size warning stands
  and the real answer is code-splitting the 3D view, not shrinking the art.
- `layout.ts` (world positions) and `view-model.ts` (what to draw and how grown it is) have unit
  coverage in `tests/web/farm-layout.test.ts` and `tests/web/farm-view-model.test.ts`. `scene.ts`
  does not, because it needs a real WebGL context; it is covered by typecheck, lint, and manual use
  until a headless GL harness is justified. Every decision worth asserting was pushed out of it.
- The shipped `.glb` files have coverage of their own in `tests/integration/crop-model-assets.test.ts`:
  it parses the container by hand, recomputes every vertex bound from the binary chunk, and fails a
  model that does not stand on the ground, is not one unit tall, or would overhang its tile. It is
  the only test here that reads a binary artifact, because art cannot be reviewed by reading a diff.
- The placeholder models are placeholders. Replacing them is a file swap, or `assets:generate` for
  the generated ones; only a model that breaks the authoring contract needs a code change, and that
  test is what says so.
- `AGENTS.md` keeps React + R3F as the primary stack target and now points here for the current
  deviation, so the mismatch is recorded rather than discovered.
