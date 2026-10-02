# Universal world objects

Status: what V13.3 made editable, what it deliberately did not, and the invariants a later pass must
not break. Read this before touching the starter layout, the object definitions, storage, or the way
the renderer decides what to draw.

> **The starter map is a starting arrangement, not a permanent map.**
>
> **Land use is chosen by the player, not predetermined by the map.** (V13.2, still true.)

The island begins with objects the player did not buy and cannot be expected to buy again: trees, rocks,
flowers, the mill. V13.3 gives them persistent identity, so they are edited - moved, turned, stored,
removed - by exactly the same commands as anything bought in the Build shop.

> **V13.3.1 extends that to everything a player can see as an object.**
>
> *"If I can clearly see it as an individual object on my farm, I should normally be able to select
> it."* Where a thing came from - a procedurally grown tree, a `world-config` landmark, a GLB prop -
> is an implementation detail, and never a reason the player cannot rearrange it.

## Terrain versus objects

Geography is not an object and never becomes one:

| Thing | What it is | Editable |
| --- | --- | --- |
| island outline, relief, volcano, beach | terrain, a pure function of position | no |
| ocean, the pond | geography | no |
| the village square's paving | geography (`insidePlaza`) | no |
| the harbour's quay, pier and approach | geography (`insideHarbourWater`) | no |
| the authored harbour-to-village road | a specialized system (its corridor is a curve, not a rectangle) | not yet |
| the field's fence | a generated ring around the reserve | not yet |
| the island's procedural forest, scrub and boulders | **world objects** since V13.3.1: the arrangement is a transcription of the generator's own output | yes |
| the island's micro-scenery - flowers, tufts of grass, shoreline specks | **ambient scenery**: seeded, drawn per frame from a fixed seed, stored nowhere | no |
| wild growth on a locked plot | **ambient scenery**: it is the *unsold land's* wild state rather than the player's arrangement, and buying the plot replaces it | no |
| the mill, the barn, the village and quay buildings, the yard props | **world objects**: a row, an owner, a version | yes |
| the fishery's water cages | water is not ownable, so it is not a row yet | no |

`classifyTile` in `packages/game-data/src/world/geography.ts` answers the first column and is the same
function the renderer's cell map uses, so a client preview and a server refusal cannot disagree about
whether a spot is beach, water or the mountain. It is deliberately the *minimum* geography the
authority needs: no meshes, no materials, no three.

## Identity

One table, `farm_constructions`, is the one table of active world objects. A row carries:

```text
id, farm_id, catalogue_entry_id, category, anchor, rotation, footprint, bounds,
state (ACTIVE | STORED), owner_player_id, source (STARTER | PLAYER_PLACED),
placement_key, paid_amount, cost_amount, cost_currency_id, created_at, updated_at,
stored_at, version
```

* **Provenance is `source` and nothing else.** It records where an object came from and never decides
  what may be done to it: a starter tree and a bought tree are edited by the same policy.
* **Authority is `owner_player_id`.** A starter object belongs to the farm's owner by fiat; the farm's
  membership rules then decide who may change it.
* **Identity survives editing.** A move, a turn, a store and a restore all keep the same row and the
  same id, and each bumps `version` - the optimistic-concurrency token every command echoes back.
* **`placement_key`** is a starter placement's stable name (`starter.tree.west.01`), unique per farm.
  It is the idempotency key of seeding; the row id is the identity the game uses.

### Position, and the grid

An anchor is a *position* in tile coordinates, and it may be fractional: the island's own objects
stand where they grew (a tree at x = -4.37) or where they were authored (the open barn at 42.5, 6.5).
`anchor_x`/`anchor_y` are declared INTEGER, and SQLite's INTEGER affinity stores 42.5 as REAL rather
than rounding it, so the column holds the position the object actually stands at without a rebuild.
The **cells** a row occupies are still whole: `constructionBounds` floors the anchor, and the
footprint grows from the cell the object stands in - so ownership, occupancy, and the crop/tree
checks stay on the integer grid the rest of the game is built on.

`rotation` stays a quarter turn, and it is the *player's* turn. The facing the island arranged an
object at is `baseYaw` on its placement, and what is drawn is `baseYaw + rotation x 90 degrees` - a
quay does not swing a quarter turn because a migration wrote its row down.

### Definition versus placement

`packages/game-data/src/world/` separates *what* from *where*:

* `objects.ts` - `WorldObjectDefinition`: presentation (a model id and its size, or a landmark kind),
  footprint, collision radius, `allowedTerrain`, `movable`/`rotatable`/`storable`/`removable`,
  `removalRefundRate`, `system`.
* `starter.ts` - `STARTER_WORLD_PLACEMENTS`: key, definition id, tile, quarter turn.

The server seeds from those; the renderer draws from those; the shop sells its own catalogue beside
them. One definition, many instances, whoever placed them.

### The arrangement is generated once, and checked

`packages/game-data/src/world/starter-v2.ts` is the promoted island, written down: 344 placements for
the procedural forest, the buildings and the set dressing, each with the model variant and the size
the generator grew it at. It is *generated* from the renderer's own deterministic world model - a
temporary test ran the model and printed the table - and `tests/codegen/starter-world-v2.test.ts`
rebuilds that world and asserts the two still agree. Change the scatter and the test fails, which is
the signal to regenerate rather than to ship an island that draws one forest and seeds another.

This is what makes "no duplicate rendering" provable rather than hopeful: the promoted set is exactly
the mass scenery the generator produces, so the renderer can stop drawing that pass entirely and the
picture is unchanged.

## Seeding, and never resetting

`SeedStarterWorld` gives a farm the arrangement **once**:

* new farms are seeded on the first read of their constructions, which is also how an existing farm
  meets V13.3 - no manual step, no database to delete;
* the version stamp and the rows are one batch, and the rows are inserted only by the pass that
  actually moved `farms.starter_world_version`;
* a unique `(farm_id, placement_key)` index is the second lock on the same door;
* seeding only ever **adds**. It never looks at an object that already exists, so a tree the player
  moved, stored or removed is never put back where it started.

`STARTER_WORLD_VERSION` is what a later arrangement increments, and V13.3.1 is the first row on that
ladder: **version 1** is the mill and the authored ring, **version 2** is the procedural forest, the
buildings and the set dressing. The seeder takes every placement *above* the farm's own version and
stamps the current one, so a farm stamped 1 is given exactly the 344 version-2 objects and a new farm
is given both. Replaying a version a farm already has is not merely wasteful - it would collide with
rows that are already there, and it would try to put back an object the player had moved.

A future addition seeds only what it adds; it must never replay the whole map, and it must never
reconcile an existing object to its authored transform.

### Nesting, and what a player may overwrite

The scatter places two bushes in one cell and the migration has to reproduce that, so **two starter
rows may share a cell** (migration 0013: the occupancy triggers ignore a conflict between two
`STARTER` rows, and nothing else). What a player places, moves or restores still respects *every*
object standing there, including the starter ones - so a barn cannot be dropped on top of a tree.

## Editing

| Action | Command | Cost | Notes |
| --- | --- | --- | --- |
| Move | `POST .../constructions/:id/move` | 0 | destination must be owned, free, and the asset's terrain |
| Rotate | `POST .../constructions/:id/rotate` | 0 | one quarter turn; the footprint re-checked |
| Store | `POST .../constructions/:id/store` | 0 | the row becomes `STORED`; it occupies no ground |
| Restore | `POST .../constructions/:id/restore` | 0 | the same row becomes `ACTIVE` at the chosen cell |
| Remove | `POST .../constructions/:id/remove` | refund | permanent; refund from the cost basis |

Storing keeps the row rather than moving it to a second table, which is what makes the duplication
exploit impossible: there is one object, and this is its state. A restore re-checks the destination
exactly as a move does, so a failed restore leaves the object in storage rather than half-placed.

## The refund invariant

A refund is `floor(paid_amount × removalRefundRate)` - a share of what the object **actually cost its
owner**, never of the catalogue's current price.

A starter mill paid for by nobody carries `paid_amount = 0`, so removing it returns nothing however
much a new one costs. Without that, "remove the free mill for half its catalogue value, start another
farm" would be a money press; a test pins the zero.

## Rendering, and no double-drawing

Persistent objects are drawn by the construction layer from their rows. Two rules keep the picture
honest:

* **A promoted object is not drawn from the config.** The mass scenery, the landmark and its props are
  drawn only from rows; the renderer's static pass draws the terrain, the roads, the quay and the
  plaza, and nothing that is a row. That is the whole of "no duplicate rendering".
* **Ambient scenery is not persisted and not editable.** Flowers and tufts of grass still come from
  the deterministic scatter, into the group the camera switches off when it pulls back. The scatter's
  finished list is swept against the *authored* (version-1) starter objects, so nothing procedural is
  grown through the mill's sails. The version-2 arrangement is not in that sweep: it *is* the scatter,
  so clearing the scatter around it would delete every tree from its own clearing.

### Instancing, and picking an instance

Four hundred rows cannot be four hundred draw calls. Rows are grouped by the model they draw and each
group becomes one instanced batch, with the model's own node transforms folded into every instance
matrix; the village and the quay are primitives with no model to instance, and there are nine of them,
so each is built on its own.

A raycast against an `InstancedMesh` reports an *instance index* rather than an object, so the batch
carries its own instance-to-object table under `constructionIds` (`apps/web/src/render/object-picking.ts`).
The table lives on the mesh and is rebuilt with it, so a moved tree resolves at its new place, and a
removed or stored one has no instance left to resolve. Landmark-kind rows are ordinary groups with the
row id on the root, which is the same key the cloned-model path always used.

The size matters: an imported model is normalized to one unit, so a row that carries no size would be
drawn a metre tall. A row's presentation is its *arrangement* when it has one - the model a tree grew
as and how tall it was, keyed by `placementKey`, so a forest stays a family of models rather than one
clone repeated - and its definition or catalogue entry otherwise.

### Collision

Collision is the rows too: `objectObstacles` turns every *standing* row into the circle its definition
declares (`collisionRadiusWorld` - a tree blocks by its trunk, a flower patch by nothing), so a tree
the player moves takes its collision with it and a stored one leaves none behind. The barn and the
landmarks are no longer in `STATIC_OBSTACLES` - keeping them there would leave an invisible wall where
a barn used to be; that list now holds geography (the pond) and a separate camera-blocker list holds
the authored building silhouettes.

## System objects

An object may be marked `system: true` in its definition, and the island's geography is not an object
at all. What is *not* allowed is marking something protected merely because the old renderer called it
a landmark: this pass made the mill editable for exactly that reason.

What remains protected today, and why:

| Protected | Reason |
| --- | --- |
| terrain, ocean, pond, volcano | geography: they are the island |
| the plaza's paving | geography: `insidePlaza`, and it is shared civic ground |
| the harbour's quay and approach | geography: `insideHarbourWater`; a cage or a shed moored across the pier blocks navigation |
| the authored road | a specialized system: its identity is a curve with a width, not a rectangle |
| the field fence | a generated ring; segment identity is a separate pass |
| ambient scenery (flowers, tufts, shoreline specks) | no gameplay value, and persisting thousands of blades of grass is the thing this pass refuses to do |
| wild growth on a locked plot | it is the unsold land's own state, not the player's arrangement |
| the fishery's water cages | water is not ownable, so nothing may be moored there yet |

Every *building* on the island is a world object now, including the ones the renderer used to call
landmarks - the farmhouse, the well, the market stall, the storage shed, the open barn, the silo, the
coop, the harbour store and the barn. None of them is `system: true`; the reason the mill is editable
applies to a farmhouse exactly as well.

## Multiplayer and authority

The client sends a cell, a turn and the version it read; it never sends a price, a refund, an owner, a
footprint, a definition or an entitlement to storage. The server resolves all of those from its own
rows and game data, checks farm membership *and* the object's owner, and refuses a stale version
outright. Two clients editing the same object is the V13.2 problem and it keeps the V13.2 answer: one
of them wins.

## What is not implemented yet

* **Roads**: no road editor. The authored road is geometry; a player-built road is a construction, and
  replacing, deleting and upgrading segments is a later pass.
* **Fences**: the starter fence is a generated ring, not segments.
* **Water objects**: `SHALLOW_WATER` is classified, but water is not ownable, so a fish cage still
  cannot be placed. The classification is the preparation for that pass.
* **Production trees and crops**: `tree_instances` keeps its growth, yield and harvest, and a crop is
  still a lifecycle entity rather than an object. Making *their* interaction look like everything
  else's is the remaining boundary, and it must not be faked by copying production state into a row.
* **A building's authored facing**: a row's `rotation` is the player's quarter turn and the placement
  supplies the island's original `baseYaw`, so a sub-quarter-turn facing survives a migration - but a
  *player* can only turn a building in 90-degree steps. A free-turn editor is a later decision.
* **The seeding batch**: a new farm inserts 381 rows in one transaction. That is the correctness
  choice (the version stamp and the rows commit together), and it should be checked against D1's own
  batch limits before a production deployment.
