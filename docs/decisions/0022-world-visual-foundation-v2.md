# ADR 0022: World, map, and visual foundation V2

Status: Accepted (2026-09-30)

Builds on ADR 0021, which made the farm bigger and composed the island but deliberately left the art
alone ("the placeholder art is still placeholder"). This is the pass that makes the world read as a
place: ground with elevation, land that looks like land, landmarks to navigate by, and a renderer
that can carry it. It adds no gameplay, no route, no table, and no authoritative state.

## Context

After ADR 0021 the map was larger but still drawn as one flat plane: a 36-tile dirt apron inside the
fence with a twelve-tile field in the middle of it, locked land as grey slabs under translucent fog
rectangles with gold padlocks, an island that ended in a hard ellipse, a scatter of props with no
composition, a flat background colour, unlit-looking materials, and no shadows. The camera opened on
the reserve rather than the farm, and it could never look at the pond or the farmyard at all.

Rendering it showed three defects that the code alone did not: the barn and the whole farmyard stood
outside an ellipse that was supposed to be the island, the pond's water was buried under its own
sandbank, and a model finishing its download reset the player's zoom.

## Decision

### The island is a shape, and the ground has elevation

`apps/web/src/render/terrain-height.ts` holds both as pure functions of a world position:

- `islandRadiusAt` measures distance from the island's centre in shore units. The outline is a
  **superellipse with exponent 4** rather than an ellipse, which rounds the rectangle off instead of
  cutting its corners away. The barn, the orchard, and the farmyard are inside it now; the corners of
  the visual bounds - which are sea - are not. The drawn shore (`islandRimPoint`) and the walked shore
  (the player's collision world) are the same curve.
- `terrainHeightAt` returns the elevation, and it is **exactly 0 on the plateau the farm occupies and
  exactly 0 at the waterline**, rising to 5.5 world units in the ring between them. The playable grid
  never samples it: tiles, crops, trees, and the character all sit at `y = 0`, so elevation is scenery
  rather than a rule. Named `levelAreas` - the pond and the barnyard - are held flat, so water sits
  level and the barn does not stand on one corner of its footprint.

### The apron follows the farm, not the reserve

`FarmWorld` now carries `apron` and `bed` rectangles derived from the land the farm **owns**. The
alpha paved the whole 36-tile reserve, which is why the starter square sat in the middle of a brown
yard. The apron is 1.5 tiles of dirt around the owned field, the bed is the tile area itself so the
seams between slabs read as furrows, and both are drawn in the **overlay** group because they change
when land is bought.

### Land for sale looks like land

The grey slab, the fog rectangle, and the padlock are gone. A locked plot is:

- a rounded patch of rougher, drier ground, coloured per vertex;
- wild scrub standing on it, placed from its own seed (`buildLockedScenery`);
- a stake line along the edges the farm does not already own (`buildLockedBoundary`), which is the
  boundary the slab used to draw; and
- one wooden sign per plot.

The plot square, its index, its price, and its level requirement are untouched: the server still owns
all of that.

### Composition, not more props

Open-country scenery is placed as **clusters** - forest pockets, thickets, outcrops, flower patches -
on a lattice anchored to the island, biased outward so the middle stays tended ground. The count is
capped at 360, the generator advances a fixed number of times per candidate, and nothing reads the
farm's tiles, so the world is identical for two players and unchanged when land is bought. Landmarks
are placed by `LANDMARKS` in the world config and assembled in `landmarks.ts` from the geometry and
materials the rest of the world already shares: a farmhouse, a windmill, a well, a market stall, and a
storage shed, each with its own clearing, its own collision circle, and no gameplay of its own.

### Rendering and camera

- One sky dome with a vertex-coloured gradient replaces the flat background colour; the fog is the
  colour of its horizon band, so the far shore dissolves into the sky.
- ACES tone mapping at 1.05 exposure, a hemisphere light, and one shadow-casting sun.
- **Every unlocked tile slab is one `InstancedMesh`** with per-instance colour, so a farm with a
  thousand tiles costs one draw call instead of a thousand instead of two thousand.
- **Every scenery kind is instanced from its loaded model**, one `InstancedMesh` per mesh in the GLB.
- The camera opens on the **owned field**, not on the island's centre or the whole reserve; the pan
  bound is wide enough to reach the pond and the farmyard; and zoom reaches 4.4, which is what it
  takes to see the whole island from a frame that starts on the field.
- A static rebuild caused by an asset arriving no longer resets the zoom. Only a world that actually
  changed size re-frames the camera.

## Consequences

- The world is still presentation only. Nothing in this pass reads or writes authoritative state, and
  `apps/web` still imports no server module.
- The reserve's inside is now grass with a dirt track along the fence, the next ring of plots, and two
  meadow patches; it is deliberately not more props, because that land is for sale.
- Hills never reach the field, the shop's land, or the character's walking grid, so no existing test
  about coordinates, walkability, or expansion changed meaning - the shape they test did.
- Elevation is a function of world position, so a prop standing on a hill is placed by the same
  function the mesh is built from; changing the relief moves both together.
- Shadow casting is a single 2048 map over the reserve. It is the largest per-frame cost this pass
  adds, and it is bounded by the reserve's size rather than by the island's.
- The remaining placeholders are the generated GLB models (crops, barn, avatar, Kenney nature props)
  and the flat-colour materials. Replacing them is a file swap, which is what the asset manifest and
  `SceneryModels` were already for.
