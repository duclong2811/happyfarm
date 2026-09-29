# ADR 0012: Farm world map and camera

Status: Accepted (independent audit completed 2026-09-29; pending commit)

## Problem

The 3D view drew the unlocked tiles as a `6 x 6` grid floating on a dark plane. The starter field
looked like a small board in empty space, bought land simply made the same board wider with no
visible frontier, and there was no way to move or zoom the camera. Phase 4C made land purchasable,
so the map also has to show the land that is still locked and make the moment of buying it legible.

## Decisions

### The 36 tiles are the field, not the map

`farm_tiles` remains the only representation of unlocked land (ADR 0010). The renderer keeps drawing
exactly the tiles the server returned. Everything around them - island, water, dirt apron, path,
fence, pond, barn, trees, bushes, rocks, and flowers - is presentation. It grants nothing, gates
nothing, and is never read back as game state.

### A pure world model sits beside the tile layout

`apps/web/src/render/world.ts` derives the map from the tile coordinates and the server's plot
catalogue. It is pure: no three, no DOM, no clock, no network. It answers three questions the
renderer cannot answer on its own:

- How big is the island around the current land?
- Where does the next ring of locked land sit?
- Where can deterministic scenery stand without covering the field?

`tests/web/farm-world.test.ts` pins the mirrored plot geometry to `packages/domain/src/plot.ts`, so
the domain stays the single source of the ring layout even though this is a display-only mirror.

### Locked land is previewed one ring ahead

The map shows the ring containing the first locked plot, not the whole catalogue. That keeps the
frame square, keeps the playable field a large part of the screen, and moves the frontier outward as
rings are bought. Unlock state is always `PlotDTO.unlocked` from `GET /farms/:farmId/plots`; the
client never decides that land is owned.

The plot contract is unchanged. A plot already carries `plotIndex`, and the layout rule that turns
an index into a tile square is deterministic and tested on both sides, so no API or schema change is
needed to draw the frontier.

### The camera is a bounded isometric view

The camera is a perspective camera on a fixed three-quarter direction, framed to the island:

- the field and its frontier stay centred, so the play area is the middle of the screen;
- the wheel zooms within a clamped range;
- dragging pans within a clamped radius of the island centre, so the camera cannot leave the farm;
- the camera height is always positive, so it cannot pass through the ground.

Dragging and clicking share one pointer stream: a press that moves more than a few pixels pans, and
a press that does not is a tile selection. Selection still reports only a coordinate to the UI.

### Rendering stays on demand and is split by responsibility

The world is rebuilt only when its signature changes (outer bounds, island size, or locked plots).
Tile and crop meshes are rebuilt per refresh as before. Geometry and materials are shared and owned
by `materials.ts`, released from one `dispose`. `terrain.ts` builds static ground, water, paths,
fences, the pond, the barn, and locked squares; `scenery.ts` builds decorations; `scene.ts` owns the
camera, input, crops, markers, model cache, and disposal. No module grows into a second `main.ts`.

## Consequences

- The starter farm reads as a farm on an island: a grass field with a dirt apron, a fence, a path,
  a pond, a barn, and trees, plus three fogged, padlocked `6 x 6` plots where the next purchase goes.
- Buying a plot refreshes from the server and the new ring becomes field while the next ring appears
  as locked land. The map never unlocks anything by itself.
- Scenery is deterministic from a fixed seed and a fixed lattice, so refreshes do not reshuffle it.
  The world rebuild is skipped while its signature is unchanged, so the two-second growth poll does
  not rebuild the island.
- The field occupies the centre of the island rather than the whole screen. Distant land is visible
  but not playable until bought, which is the point of the frontier.
- No contract, migration, application, or domain behaviour changed. ADR 0007's open question about
  negative coordinates stays open; this work only uses the non-negative coordinates the domain
  already guarantees.
