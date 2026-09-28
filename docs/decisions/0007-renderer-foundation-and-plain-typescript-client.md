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

### Open question: the renderer's coordinate domain

`layoutFarmTiles` rejects negative tile coordinates and derives its extent from `maxX + 1`, while
`packages/contracts` allows `x` and `y` anywhere between `-1_000_000` and `1_000_000`. Today every
farm starts at the origin, so the two only agree by accident. Before land can be expanded off the
origin, decide one of two things: make the layout origin-agnostic (`columns = maxX - minX + 1`,
centred on `(minX + maxX) / 2`), or state "tile coordinates are non-negative" as an explicit
precondition the server guarantees. Leaving the contract advertising a range the renderer cannot
draw is the one option that should not survive.

## Consequences

- The 3D view is opt-in behind a button. Creating a WebGL context is the one thing the page cannot
  take back, so a headless or WebGL-less environment is unaffected until the user asks for it.
- `three` (`^0.186.1`) becomes a runtime dependency of `@happy-farm/web` and therefore part of the
  browser bundle. Tree-shaken named imports keep the foundation small; the asset pipeline will
  dominate bundle size later, and that is the right moment to measure it.
- `layout.ts` (world positions) and `view-model.ts` (what to draw and how grown it is) have unit
  coverage in `tests/web/farm-layout.test.ts` and `tests/web/farm-view-model.test.ts`. `scene.ts`
  does not, because it needs a real WebGL context; it is covered by typecheck, lint, and manual use
  until a headless GL harness is justified. Every decision worth asserting was pushed out of it.
- `AGENTS.md` keeps React + R3F as the primary stack target and now points here for the current
  deviation, so the mismatch is recorded rather than discovered.
