# Phase 3.6C review (implementation-side)

Review date: 2026-09-28
Reviewer: the implementation agent, on its own Phase 3.6C working tree
Baseline: `fbdb693` (`feat: add Three.js renderer foundation for the farm view`)
Scope: `apps/web/src/render/view-model.ts`, `apps/web/src/render/scene.ts`,
`apps/web/src/render/index.ts`, `apps/web/src/main.ts`, `apps/web/index.html`,
`tests/web/farm-view-model.test.ts`, and the documentation touched by the phase.
Method: full read of every changed file, plus the eight questions in
`docs/reviews/AUDIT_PROMPT_PHASE_3_6C.md` used as a checklist, then `npm run typecheck`,
`npm run lint`, the unit suite, and the end-to-end development-backend smoke test.

**This is not an independent audit.** It was written by the same agent that wrote the code, so it
is a record of what was checked rather than a second opinion. The independent review for Phase 3.6C
is still outstanding. Nothing in this file has been reviewed by anyone else.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P2 | `tileGeometry` was built as `BoxGeometry(1, TILE_THICKNESS, 1)` and then scaled by `TILE_THICKNESS` on the Y axis, so the slab's thickness was multiplied by itself. Every tile rendered as a paper-thin sheet (0.0064 world units) floating above the ground, which also put the selection ring below the tile surface. | Fixed |
| 2 | P2 | A crop was drawn only when `heightFraction > 0`. A crop the server has just planted reports zero growth, so a freshly planted crop was invisible until the first refresh reported progress. That contradicted `MIN_CROP_HEIGHT`, whose stated purpose is to keep a just-planted crop visible. | Fixed |
| 3 | P2 | A renderer-layer exception could abort the authoritative refresh that called it. `refreshFarm()` calls `refreshScene()`, and `buildFarmSceneInput` can throw a `RangeError`; in the two-second polling loop that exception was swallowed by `catch {}`, which also skipped `render()`, so the 2D field silently stopped updating because the 3D view failed. Button actions surfaced the renderer's error text as if it were a gameplay error. | Fixed |
| 4 | P3 | `loadFarm` did not clear `state.selected` while `createFarm` did, so a coordinate selected on one farm stayed selected after loading another. | Fixed |
| 5 | P3 | The `mature` early return in `heightFractionOf` was not independently covered: a mutant `if (crop.mature && progress >= 1)` survived the whole suite, and the non-finite branch had no case at all. | Fixed |
| 6 | P2 | The renderer's coordinate domain is narrower than the contract's. `MIN_TILE_X`/`MIN_TILE_Y` are `-1_000_000` in `packages/contracts/src/index.ts`, but `layoutFarmTiles` rejects negative coordinates and computes `columns = maxX + 1`, which assumes an origin-anchored non-negative grid and mis-centres any farm whose minimum coordinate is not zero. | Reported, not fixed |
| 7 | P3 | A scene created after a previous one was disposed reuses the same canvas element, so two `WebGLRenderer`s share one WebGL context. | Reported, not fixed |

### Detail on the fixed findings

Fix 1 builds the geometry unit-sized and passes an explicit `baseY` to `tileMesh`, so the slab spans
`0 .. TILE_THICKNESS` and the crop stands on `TILE_THICKNESS`. Fix 2 removes the guard and relies on
`Math.max(heightFraction * CROP_MAX_HEIGHT, MIN_CROP_HEIGHT)` alone.

Fix 3 is the one with reach beyond a single pixel. The 3D view is a projection of state the rest of
the page owns, so a failure inside it must not be able to stop the page from refreshing. `refreshScene`
now catches, reports the reason in the scene status line, and returns. The authoritative path is
untouched by the renderer's health.

### Detail on the reported findings

Finding 6 is a real inconsistency, but `layoutFarmTiles` rejecting negative coordinates is a
deliberate 3.6A decision with a committed test asserting it
(`tests/web/farm-layout.test.ts`, "rejects coordinates that are not non-negative integers"), and the
`columns = maxX + 1` extent is described in the same file. Rewriting that boundary is a design
decision, not a defect fix, and it cannot be verified here without a browser. Today no code path
creates a tile with a negative coordinate, so the impact is latent. Two honest options:

- Make the layout origin-agnostic: `columns = maxX - minX + 1` and centre on `(minX + maxX) / 2`.
  That matches the contract's domain and also fixes the mis-centring of any farm that does not start
  at the origin, at the cost of changing two committed tests.
- Keep the renderer non-negative-only and write that down as an explicit renderer precondition, with
  the server guaranteeing non-negative tile coordinates. Cheaper, but it leaves the contract
  advertising a range the renderer cannot draw.

Either way, finding 3's fix means the current failure mode is a status-line message rather than a
frozen field. This should be decided before farm land can be expanded off the origin.

Finding 7: `scene ??=` plus `pagehide` -> `dispose()` -> `scene = null` means a page restored from
the back/forward cache builds a new renderer on the canvas that already owned one. `getContext`
returns the existing context, so both renderers share it, and the disposed one has already deleted
its programs. This is unverified without a browser and may well work. The clean fix, when someone can
test it, is to give each scene its own canvas rather than reusing the element, or to stop disposing
on `pagehide` in favour of keeping one renderer alive.

## Answers to the audit questions

**1. Can a crop appear on land the server did not return, or vanish while still planted?** No.
`buildFarmSceneInput` builds `tilesByCoordinate` from `state.tiles` only, derives the layout from
those same coordinates, and reads crops through the same key, so a crop row with no tile row is
dropped together with its tile and can never create land. A crop disappears only when the server
stops returning it or its tile. Duplicates collapse first-row-wins in `firstByCoordinate`, and the
choice is stable across refreshes because a `Map` keeps insertion order, which follows array order.

**2. Is the growth-to-height mapping monotonic and clamped over the whole range?** Yes. `mature`
returns 1 whatever `growthProgress` says; a progress of exactly 0, a negative, `NaN`, or an infinity
returns 0; anything above 1 returns 1; everything else is passed through. Impossible input falls back
to the least-ripe reading, never to ripe, so a tampered payload cannot make a crop look harvestable.
A just-planted crop renders as a sprout because the renderer takes
`Math.max(fraction * CROP_MAX_HEIGHT, MIN_CROP_HEIGHT)` — after finding 2 removed the guard that
previously skipped the crop entirely.

**3. Are the slab, the crop, and the ring positioned correctly?** Yes, after finding 1. The geometry
is unit-sized and scaled by `(tileSize, height, tileSize)` with its centre at `baseY + height / 2`,
so the slab spans `0 .. TILE_THICKNESS` and a crop spans `TILE_THICKNESS .. TILE_THICKNESS + height`.
The ring sits at `TILE_THICKNESS + 0.02`, above the slab tops. One cosmetic note stands:
`SELECTION_OUTER_RADIUS` (0.62) is larger than the half-tile (0.5), so the ring overhangs the
neighbouring tile's footprint by 0.04 world units. It is 0.02 above the slabs, so there is no
z-fighting, and because the ring is not in `pickTargets` a click on the overhang selects the
neighbouring tile rather than the ring. That is the correct behaviour for decoration, not a defect.

**4. Is picking correct?** Yes, as far as reading allows. The pointer is converted to NDC from
`getBoundingClientRect()`, so CSS pixels are used and neither a buffer/CSS size mismatch nor a device
pixel ratio above 1 changes the result. The raycaster uses the same camera object the frame was drawn
with, and `three` refreshes `camera.matrixWorld` during `render`, which the last `draw()` performed.
The non-recursive `intersectObjects` is correct because slabs and plants are passed as individual
objects, and a plant is mapped to its tile, so clicking a crop selects its tile. A click that hits
nothing leaves the selection alone. Unverified without a browser: pointer accuracy on a rotated tile,
and touch behaviour while dragging, since `.scene` sets no `touch-action`.

**5. Does the scene leak GPU resources or listeners?** No, and the distinction is documented.
`setState` clears `tileGroup` and `pickTargets` on every call; every geometry and material is
closure-owned and shared, so a refresh has nothing per-tile to dispose and nothing accumulates.
`dispose()` releases every geometry, every material, the `pointerdown` listener, the `ResizeObserver`,
and the renderer. It deliberately does not call `forceContextLoss()`, because that would make the
canvas permanently unusable and `main.ts` reuses that canvas. Repeated `createFarmScene` without a
`dispose` is not reachable from `main.ts`.

**6. Is there a single source of truth for selection and farm state?** Yes, after finding 4.
`state.selected` is the only selection, both views derive from it, and `selectTile` is the only
writer. `refreshFarm()` pushes the same state the caller then renders into the DOM, so no path leaves
the 3D view showing state the 2D grid does not. The two updates are ordered differently inside one
refresh (the scene inside `refreshFarm`, the DOM at the end of `run`), which can differ for a single
frame but cannot show wrong data.

**7. Does the client treat the browser as authoritative about anything?** No. A grep for `Date.now`,
`new Date`, and `performance.now` across `apps/web/src` returns nothing. The only client clocks are
the two-second polling interval and `crypto.randomUUID()` for `requestId`, and neither decides
maturity, reward, price, balance, or identity. Every response is parsed against the
`@happy-farm/contracts` schemas before use. Frames are drawn on demand, so there is no animation
clock either.

**8. Are the tests meaningful?** Thirteen cases, and each rule has a case that fails when the rule is
broken: the tile-gating rule, plantable-by-terrain, plantable-false-with-crop, selection, duplicate
tile and crop, and alignment with `layoutFarmTiles`. Two gaps were found and closed by finding 5.
Still uncovered: the defensive `tile === undefined` branch in `buildFarmSceneInput`, which is
unreachable because the layout is derived from the same map. It is kept as a guard rather than
promoted to a tested rule.

## Not verified

- No browser was driven, so the rendered result was not observed. One manual pass is still needed:
  plant a crop and confirm a sprout appears immediately, that the selection ring is visible on top of
  the slab and does not overhang confusingly, and that terrain and crop colours read correctly.
- `npm run build` (Vite) could not be run by the reviewing agent. `view-model.ts` adds no runtime
  dependency and imports only `./layout` plus erased types, so the bundle should not change
  materially from the 622 kB / 160 kB gzip reported in 3.6A. Confirm on the next build.
- Nothing involving a real WebGL context: picking accuracy, mobile and touch behaviour, and the
  frame cost of rebuilding the scene graph every two seconds on a loaded farm.
- The development-backend smoke test covers the API loop, not the client. It passed 82/82 checks
  through the real development Worker entrypoint on the Node host.

## Verdict

Complete for its stated scope. Three P2 findings were fixed, one P2 and one P3 are reported with a
decision still owed on finding 6, and the suite is green at 26 files / 203 tests as far as the
reviewing agent could execute it. Independent review and one manual browser pass are the remaining
gates.