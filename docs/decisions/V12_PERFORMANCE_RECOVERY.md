# V12 Performance Recovery

Status: applied in the V12 recovery commit.
Scope: the development client (`apps/web`). No server, database, contract, economy, or multiplayer
change is involved.

## Symptom

The interrupted V12 task (road network, stone roads, free 3D camera) left the development machine at
roughly 100% CPU while the game was running, to the point that working on it became impractical. The
interrupted work was never committed, so the audit had to start from the working tree.

## What was inspected, and what was found

Cheap checks only, in this order.

| Check | Finding | Verdict |
| --- | --- | --- |
| `git status`, `git log` | V11 (`d7cee97`) committed; V12 work uncommitted in 10 modified and 5 new files | audited below |
| Running processes | one idle `node` process, no `vite`, no Playwright/Chromium, no test runner | no runaway process to kill |
| Listening dev ports | nothing on 5173/5174/4173/8787/3000 | no duplicate dev server |
| `vite.config.ts` watcher | no `usePolling`, no aggressive watcher config | polling was *not* the cause |
| Animation loops | one player `requestAnimationFrame` loop (sleeps while idle) and one on-demand camera loop | one intentional loop per purpose |
| World regeneration | `buildTerrain`/`buildFarmWorld` are behind a static signature and did not run per frame | camera movement never rebuilt geometry |
| Raycasting | one raycast per pointer event, **and a full scene render after each** | real waste, fixed |
| Grid meshes | the cell lattice is instanced and only exists behind `?debug=1` | not a contributor |
| Roads | one merged mesh per surface class; cobbles are one batched geometry; verge stones are one `InstancedMesh` | not a contributor |
| Shadows | one directional light, but *every* scenery instance cast into a 2048² map | real waste, reduced |
| Pixel ratio | capped at 2 | lowered, and made a function of quality |

## Root causes

Two causes account for it. Both are recorded with the measurement that identified them.

### 1. The poll rebuilt the whole world every two seconds, and its ticks could stack

`apps/web/src/main.ts` polls the farm every 2 000 ms. Each poll called `refreshFarm()`, which called
`buildFarmSceneInput()` and then pushed the result through the renderer and the whole-page `render()`.

Measured on the development machine, `buildFarmSceneInput` costs **30–61 ms per call** (median ≈ 38 ms,
best of six measured runs 30.4 ms). That is the entire world model - island, districts, roads, scenery
placement, and a cell-by-cell map of the island - rebuilt for a farm that had usually not changed at
all. It is roughly 2% of a core continuously, in 30–60 ms main-thread stalls, plus the allocation
churn that goes with it.

Worse, the interval had no re-entrancy guard:

```ts
window.setInterval(() => {
  if (state.farmId === null) return;
  void (async () => { await refreshFarm(); render(); })();
}, REFRESH_INTERVAL_MS);
```

If a poll took longer than two seconds - a cold development API, a machine already under load, a slow
disk - the next tick started anyway. Each overlapping tick issued four more API requests, rebuilt the
world again, and re-rendered the whole page. The load fed itself: more CPU made each poll slower, and
slower polls meant more of them in flight. This is the mechanism by which a slow machine becomes a
pegged one.

### 2. Every pointer event rendered the scene

`onPointerMove` raycast the scene and then called `draw()` unconditionally for any mouse move over the
canvas, and the camera drag path did the same for every move event. A mouse reporting at 500–1 000 Hz
therefore asked for 500–1 000 full renders of the island per second, of which at most 60 can ever be
seen. Rotating the camera - the exact interaction the interrupted task added - was the most expensive
thing a player could do.

### Contributing: shadows that were never read, and a pixel ratio nobody chose

Every scenery instance set `castShadow = true`, including flowers and grass tufts a few pixels wide,
and the shadow map was 2048². The renderer also drew at up to 2× device pixel ratio on a scene made of
flat colours and one shadow map.

## Changes

| Change | File |
| --- | --- |
| A farm refresh is skipped when the farm is unchanged, compared by a cheap display signature | `apps/web/src/render/view-model.ts` (`farmPresentationSignature`), `apps/web/src/main.ts` |
| A poll that arrives while the previous one is still running is dropped | `apps/web/src/main.ts` |
| The renderer skips its dynamic rebuild when nothing it draws changed (growth quantised to the 1% the panels print, plus owned-land bounds, locked ring, selection and layout) | `apps/web/src/render/scene.ts` (`dynamicSignatureOf`) |
| Hover picking is coalesced to at most one raycast and one redraw per frame, and draws nothing when the hovered cell is unchanged | `apps/web/src/render/scene.ts` (`scheduleHover`) |
| Camera drags are coalesced to one redraw per frame; the camera state still applies immediately | `apps/web/src/render/scene.ts` (`scheduleDraw`) |
| Small scenery no longer casts shadows | `apps/web/src/render/scenery.ts`, `apps/web/src/render/scene.ts` |
| A development render-quality switch (`?quality=low`): pixel ratio 1, no antialiasing, no shadow map, no small scenery | `apps/web/src/render/render-quality.ts`, `apps/web/src/render/scene.ts`, `apps/web/src/main.ts` |
| Pixel ratio capped at 1.75 (was 2) | `apps/web/src/render/render-quality.ts` |
| The dev server ignores build output and tool caches, and still never polls | `apps/web/vite.config.ts` |

Nothing here changes gameplay. Quality, the skip keys, and the shadow settings are all presentation:
`WorldCell`, land ownership, walkability, crop maturity and every server-authoritative value are
identical at either quality level, and the server is never consulted differently.

## Evidence

Measured with a temporary timing harness (added, run, removed - it is not in the commit):

```text
[perf-probe] buildFarmSceneInput best=30.4ms worst=61.2ms samples=61.2,44.8,40.9,36.8,33.1,30.4
[perf-probe] farmPresentationSignature avg=0.116ms max=0.799ms
```

The skip key is 250–500× cheaper than the work it avoids, so an unchanged poll costs about a tenth of
a millisecond instead of tens of milliseconds.

## Before and after

| Moment | Before | After |
| --- | --- | --- |
| Idle, 3D view open | a full world rebuild + full scene-group churn + whole-page re-render every 2 s, and overlapping rebuilds whenever one exceeded 2 s | a ~0.1 ms signature comparison every 2 s; the page re-render is unchanged |
| Camera drag | one full render per pointer event (hundreds per second) | one render per animation frame |
| Pointer resting over the canvas | one raycast + one full render per move event | nothing after the first frame; no raycast and no redraw while the cell is unchanged |
| Estate view | every flower and grass tuft cast into a 2048² shadow map | small scenery is a receiver only |
| `?quality=low` | not available | roughly a quarter of the fragments, no shadow pass, no small-scenery draws |

## Remaining risks

* **Rebuilt groups are still not disposed.** `worldGroup.clear()` and the dynamic groups drop their
  objects without disposing per-build `BufferGeometry`. With the static signature and the dynamic skip
  key in place this now happens on real change rather than every two seconds, so the leak is bounded,
  but a long session with many purchases will still accumulate GPU buffers. Fixing it properly needs
  the rebuild-owned geometry marked so the shared asset geometries (which are also attached to many
  meshes) are not disposed with it.
* **The whole-page `render()` still runs every poll.** It is DOM work for panels that show crop growth,
  so it was deliberately left alone rather than coupled to the scene skip key. If profiling shows it
  becoming the next cost, it wants the same treatment.
* **No benchmark.** The measurements above are one machine. There is no automated budget test, so a
  future change could reintroduce a per-poll world build without failing anything.
* **The low-quality level has not been eyeballed side by side with normal quality** on the development
  machine, only exercised through the option's own tests.
