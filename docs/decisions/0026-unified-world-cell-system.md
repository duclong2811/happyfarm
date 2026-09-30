# 0026 - V11: one world cell, and an island that is not a board

Status: accepted (V11, on top of `a0590f3`)

## The problem

The client had four partial answers to "where is this?" and no single one of them was the answer.

* The **farm tile** (`x, y`) was authoritative for planting, harvesting, ownership and prices, and was
  drawn as a board of slabs inside a fence.
* The **district blob** decided what a piece of landscape was for, and never agreed with the tile
  grid about anything.
* The **production zone** invented a third lattice (orchard rows on their own pitch, aquaculture
  basins on a fourth) for systems that do not exist yet.
* The **interaction grid** drew a fifth: a planting overlay over the tiles the server called
  plantable.

Everything worked, and the island read as a prototype: a green plate with a six-by-six board painted
in the middle of it, a fence around the board, and roads that stopped at the fence.

## The decision

### One coordinate system, and it is the tile

`apps/web/src/render/world-cell.ts` defines `WorldCell` and the only two conversions in the client:
`worldToCell` and `cellToWorld`. A cell **is** a farm tile: the same coordinate, the same pitch, the
same origin, so the conversion is the existing `tileToWorld`/`worldToTile` rather than a fifth
formula (ADR 0015). Nothing else in the client divides by a pitch.

The cell size is therefore the shipped tile: 1 world unit of ground on a 1.08 pitch. It was chosen
against the character (radius 0.28), the roads (2.6 / 1.5 / 0.9 tiles wide), the building footprints
(3-6 metres), and the future systems: a cell is small enough to be a walking destination, large
enough to hold a crop or a tree, and already the unit every other part of the game speaks.

### The map is generated from the island, not from a rectangle

`world-cell-map.ts` classifies every cell inside the shoreline margin. Terrain comes from
`islandRadiusAt` - the same curve the ground mesh, the beach and the player's collision use - so a
cell can never be called land and be drawn in the sea, and a cell past the margin simply does not
exist, which is what makes clicking the open sea a rejection rather than a hopeful classification.

Land use comes from the districts, plus two reserves the plan now names explicitly: the aquaculture
zone in the bay the fish farm is moored in, and the mining reserve on the northern highland. Both are
zone metadata and nothing else - no building, no resource, no gameplay.

Occupancy is derived, never maintained: a building's footprint marks its cells, a planted row marks
its cell, a large prop marks the cell it stands on, and a reserved plot is held (not buildable) while
staying walkable, because nothing has been built there yet.

### The grid is invisible

Normal play draws **one** cell: the one the player selected, as a soft square lying on the ground it
is on, plus at most its eight neighbours as a faint suggestion. `planCellOverlay` is the whole rule
and it is a pure function, so "normal mode never draws the island's grid" is a unit test rather than
a promise. The full lattice exists, colour-coded by land use, behind `?debug=1`.

The visual board is gone with it: the fence around the reserve was deleted from the renderer *and*
from the player's collision, the tile slabs now meet so the field is one surface, a plough line is
drawn along every tile boundary of the land the farm owns, the offered plots lost their stake line,
and a farm track crosses the fields the way a track does.

### Selection, movement and action are three separate things

* **Selection** names a cell, draws the overlay, and tells the dock what the land is. It is
  presentation state and is never sent anywhere.
* **Movement** is offered for a cell a character can stand on: the destination is the cell's centre,
  and it is refused when the same collision world the character walks in says the cell's centre is
  inside a building, a trunk or the sea.
* **Actions** come from one resolver, `getAvailableCellActions`, which reports what a cell offers and
  why something does not. A cell with a crop offers move, harvest and uproot; a cell in the mining
  reserve offers move and a disabled "quarrying"; the open sea offers nothing but a refusal. Clicking
  a cell never plants, harvests, mines or places a cage.

### Compatibility

`legacy-farm-cell-adapter.ts` is the only place the farm tile and the world cell meet, and the
mapping is an identity: a plot bought at tile `7,3` is cell `7,3` on the day it becomes a row of
carrots. The adapter also owns the one asymmetry - the plot catalogue sells land inside
`FARM_FIELD_BOUNDS`, and a cell outside that reservation has `legacyFarmTile: null` and no crop
capability, because advertising a crop the server cannot grant would be a lie the client tells the
player.

The server is untouched: no contract, no migration, no authority moved, and nothing about how land
is bought, planted or harvested changed.

## Consequences

* `FarmSceneInput` carries the cell map, so the renderer, the selection, the dock and the player's
  collision all read one map built once per refresh.
* `production.ts` still reports the same zones, but its orchard lattice now comes from the district's
  own spacing instead of a hand-written copy that had already drifted out of the orchard.
* A `PATH` may cross the reserve (a farm track belongs in the agricultural district); a `PRIMARY` or
  `SECONDARY` road still may not, and the tests say so.
* Removed: the fence (drawing and collision), the stake line, the tile gaps, the per-tile tone
  contrast that drew the grid back on screen, and `onTileSelected`.
