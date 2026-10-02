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
| the island's procedural forest, scrub and ground cover | **ambient scenery**: seeded, drawn per frame from a fixed seed, stored nowhere | no |
| trees, rocks, bushes, flowers, the mill | **world objects**: a row, an owner, a version | yes |

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

### Definition versus placement

`packages/game-data/src/world/` separates *what* from *where*:

* `objects.ts` - `WorldObjectDefinition`: presentation (a model id and its size, or a landmark kind),
  footprint, collision radius, `allowedTerrain`, `movable`/`rotatable`/`storable`/`removable`,
  `removalRefundRate`, `system`.
* `starter.ts` - `STARTER_WORLD_PLACEMENTS`: key, definition id, tile, quarter turn.

The server seeds from those; the renderer draws from those; the shop sells its own catalogue beside
them. One definition, many instances, whoever placed them.

## Seeding, and never resetting

`SeedStarterWorld` gives a farm the arrangement **once**:

* new farms are seeded on the first read of their constructions, which is also how an existing farm
  meets V13.3 - no manual step, no database to delete;
* the version stamp and the rows are one batch, and the rows are inserted only by the pass that
  actually moved `farms.starter_world_version`;
* a unique `(farm_id, placement_key)` index is the second lock on the same door;
* seeding only ever **adds**. It never looks at an object that already exists, so a tree the player
  moved, stored or removed is never put back where it started.

`STARTER_WORLD_VERSION` is what a later arrangement increments. A future addition seeds only what it
adds; it must never replay the whole map, and it must never reconcile an existing object to its
authored transform.

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

Persistent objects are drawn by the construction layer from their rows: `objectPresentation` resolves
a row's definition to a model id and a size, and the scene draws one instance per active row. Two
rules keep the picture honest:

* **A promoted object is not drawn from the config.** The starter objects in V13.3 are authored *in
  the shared layout* and drawn only from rows, so there is nothing to double up with.
* **Ambient scenery is not persisted and not editable.** The procedural forest is still generated and
  still render-only. Its finished list is swept against every landmark *and* every starter object -
  the mill's clearing is wide enough for its sails - so nothing procedural is drawn on a cell a
  starter tree already stands on. The sweep drops rather than re-rolls, so the rest of the island
  stays where it was.

The size matters: an imported model is normalized to one unit, so a row that carries no size would be
drawn a metre tall. `objectPresentation` gives world objects their own metres and resolves bought
objects from their model family - the same numbers the scenery pass uses.

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
| ambient scenery | no gameplay value, and persisting thousands of blades of grass is the thing this pass refuses to do |

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
* **The remaining authored landmarks** (farmhouse, well, market, storage shed, open barn, silo, coop,
  harbour store) and the **composition props** are still drawn from the world config. They are
  ordinary objects by every argument this document makes, and migrating them is the next slice of the
  same work: add a definition, add placements, stop the config drawing them.
* **Landmark presentation**: `WorldObjectDefinition.presentation` can name a landmark *kind* for an
  object with no model, but nothing uses that form yet.
