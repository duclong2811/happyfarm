# Freeform island building

Status: the architecture this build implements, and the one every later building pass has to stay
inside. V13.2.

## V13.2.1: the live fixes

The first real browser session on V13.2 found two failures, both in the *interaction* layer rather
than in the rules - which is exactly where the code had no tests of its own. What changed:

* **The player's land is shown while they are using it.** `ownershipOverlayFor` asks for the mark only
  while something is in hand for placement or a move, and `scene.setOwnershipOverlay` draws it as one
  instanced quad per owned cell - one geometry, one draw call, rebuilt only when the cell list
  changes. The placement HUD carries the legend ("Green marks the land you own"): a colour with no
  legend is a decoration, not an answer. The mark is gone the moment neither mode is active, so
  normal play still shows no grid.
* **Picking is one tested decision, not a loop in the renderer.** `apps/web/src/render/object-picking.ts`
  resolves a raycast hit to a construction by walking the intersected node's ancestors to the node
  that carries `userData.constructionId` - never by mesh name, because names come from whichever
  exporter produced the asset. `tapTargetFor` states the priority: while anything is in hand a tap is
  a placement tap; otherwise a tap on a construction is a selection and never a click-to-move.
  `tests/web/object-editing.test.ts` drives that with a real `Raycaster` against a root + wrapper +
  leaf graph, which is the shape a cloned GLTF actually is.
* **The selection is an id, not a row.** `selectedRow` resolves the panel's subject from the list the
  server last reported, so a poll that replaced every row cannot leave the panel describing a stale
  version - and a row that has gone clears the selection instead of leaving a ghost.
* **The panel is never silent.** It renders for any selected row, falling back to the entry id when
  the catalogue has not loaded, and it offers exactly the actions the asset's policy allows
  (`editableActions`). Delete confirmation says what comes back *including when nothing does*.
* **Enter and Build are one command.** Both call `confirmPlacement`; a test asserts there is exactly
  one call to `placeConstruction` in the client.

A developer's diagnostic (`?debug=1`) prints the owned bounds, the cell in hand and the carrier's
origin in the placement HUD, because "you do not own that land yet" with no way to see the parcel was
the thing that made the first failure hard to explain.

> **Land use is chosen by the player, not predetermined by the map.**

A normal owned cell does not have to be assigned to an economic district - FARM, FORESTRY, BUILD,
DECORATION - before a player may use it. There is no such assignment anywhere in the code. What
decides where a thing may go is four short questions: **whose land is it, what is the ground, what
does the asset itself need, and is the space free.**

## 1. Owned land is the primary progression rule

For an ordinary land asset the whole rule is:

```text
player owns the cell
  + the asset's own ground requirement is met
  + the footprint does not overlap anything
  + the player meets the asset's level, and can pay its price (on a new placement)
= placement allowed
```

Nothing else is consulted. Not a district, not a production zone, not a capability the cell has to
offer, and not what the land "is for" - that is the player's decision, made by what they put there.

Ownership is `farm_tiles`: an existing row *is* owned land, exactly as it is for planting. The
reservation (`FARM_FIELD_BOUNDS`) says which land the plot catalogue **could** sell; it is not
ownership, and the client keeps the two apart. That distinction was V13.2's opening bug: the preview
called every cell inside the reservation "owned", so a broadleaf tree previewed as legal on land the
server would refuse with `CONSTRUCTION_NOT_OWNED`. See `world-cell.ts` (`owned` vs the reservation)
and `legacy-farm-cell-adapter.ts` (`cellToFarmTile` is ownership; `isFarmlandTile` is the
reservation).

## 2. Terrain is not land use

`CellTerrain` is `LAND`, `SHORE`, `WATER`, `VOLCANO`, `BLOCKED`. Those are facts about the ground, and
they are the only ground facts placement reads. `CellZone` and `CellCapability` still exist - the
overlay colours by them and the dock reads them for its own hints - but they are **not** consulted
when deciding whether something may be placed. A test pins the placement vocabulary to terrain alone.

## 3. Assets own their gameplay rules

A catalogue entry (`packages/game-data/src/placement/`) declares, as data:

| field | what it decides |
| --- | --- |
| `allowedTerrain` | the physical ground it needs: `LAND`, `SHORE`, `SHALLOW_WATER`, `WATER` |
| `footprint` | the cells it covers, before rotation |
| `price`, `currencyDefinitionId`, `requiredLevel` | what a *new* placement costs |
| `rotatable` | whether it may be turned |
| `movable` | whether it may be picked up and put down elsewhere |
| `removable`, `removalRefundRate` | whether it may be taken down, and what that returns |
| `unlockCondition` | `OWNED_LAND` for everything a player buys |
| `gameplay` | what it *does* (classification, effects, status) - see `V13_FUNCTIONAL_ASSETS.md` |

Every shipped entry asks for `["LAND"]` except the fish cage, which asks for `["SHALLOW_WATER"]`.
That is the entire placement difference between a tree, a barn, a fence, a road and a lamp.

An entry that is not implemented carries `status: FOUNDATION_ONLY` or `PREVIEW_ONLY` and the shop
says so; a property nothing simulates is not presented as if something did.

## 4. What `WorldCell` is responsible for

`apps/web/src/render/world-cell.ts` answers, per cell:

* **where**: `x`, `z` - the one coordinate system, on the farm-tile pitch;
* **what it physically is**: `terrain`, `shallowWater`;
* **whose it is**: `owned` (the server's rows), and `reserved` (ground the island keeps);
* **what is standing there**: `occupancy`, `road`;
* **what it could produce**: `productionCapability` (a read-only hint for the field and the overlay);
* **what it could carry**: `capabilities` (the ground's own vocabulary, for the debug overlay and the
  expansion rule - never for a placement decision).

It does **not** answer "which economic district is this": a district is landscape. `buildWorldCellMap`
derives all of it from the world config plus the server's land, and is pure and deterministic.

## 5. What a `PlacedObject` is responsible for

A persisted construction (`ConstructionInstance`, `farm_constructions`) is:

```text
id, farmId, entryId (the asset definition it points at), category,
anchorX, anchorY, rotation (0..3), footprint (already rotated),
bounds (min/max cells), state, builtByPlayerId,
costAmount, costCurrencyDefinitionId, createdAt, updatedAt, version
```

It names its definition rather than copying its price, footprint or effects, so a rebalance changes
what the shop says without rewriting what a player already built. `version` is the optimistic
concurrency token every edit echoes back.

The id is stable and server-minted (`construct_<uuid>`); nothing on the client may invent one.

## 6. Ownership, authorization

* The actor comes from verified authentication, never from a request body.
* Editing requires farm membership with the `OWNER` or `EDITOR` role - the same gate placing uses -
  **and** the object itself: the player who built it, or the farm's owner. An editor may not quietly
  move a colleague's work; nobody outside the farm may touch any of it.
* A refusal is stable and external: `NOT_AUTHORIZED` for the farm, `OBJECT_NOT_OWNED` for the object.

Known limitation, carried forward: the `OWNER`/`EDITOR`/`HELPER`/`VISITOR` roles are recorded and the
editing gate reads them, but the finer "which member may do what" matrix belongs to a permissions
pass. Today a member is either an editor of the farm's objects or is not.

## 7. Footprint

`constructionBounds` anchors a footprint on the pointed cell, with the extra cell of an even side on
the +x/+y side. A placement, a move, a turn and the occupancy map all use that one function, so they
cannot disagree about which ground a rectangle names. **Every** cell is validated - a multi-cell
footprint with one unowned or occupied corner is refused as a whole. `rotatedFootprint` swaps width
and depth on odd quarter turns; the stored footprint is the rotated one.

## 8. Occupancy

A blocking object reserves its rectangle. The rules live in the database as well as in the domain:

* `farm_constructions` is the authority, and `BEFORE INSERT` **and** `BEFORE UPDATE` triggers refuse a
  rectangle that overlaps another row on the same farm (excluding the row being moved), that is not
  wholly owned, or that holds a crop or a tree;
* the client marks the same cells `BUILDING` in its cell map, so a preview cannot be drawn on top of
  a barn the server would refuse;
* a move releases the old rectangle and takes the new one in one statement, so there is no window in
  which the object is in two places or none.

## 9. Rotation

`QuarterTurns` is 0..3, normalised by `normaliseQuarterTurns`; no floating-point Euler drift is ever
stored. A turn is a *move whose anchor does not change*: the same ground function is re-run for the
new footprint, and the same triggers refuse it if it does not fit. A 2x3 becomes 3x2, a 1x1 stays
1x1 and turns visually.

## 10. Moving

`POST /farms/:farmId/constructions/:id/move` carries the destination, a rotation and the version the
client is looking at - never a price, a footprint, an owner or a refund. The server loads the object,
checks the asset's `movable`, checks each destination cell, and writes one batch:

```text
UPDATE farm_constructions SET ... WHERE id = ? AND farm_id = ? AND version = ?
INSERT idempotency receipt, only if that row now carries this batch's timestamp
```

A stale version matches no row, the guarded receipt insert fails, and the whole batch rolls back - so
a failed move **cannot** lose the object, duplicate it, leave a ghost rectangle or move gold.
Moving costs nothing: it is not a delete plus a purchase.

## 11. Deletion and refund

`POST /farms/:farmId/constructions/:id/remove` deletes the row and, when the asset's policy returns
anything, writes a `CONSTRUCTION_REFUND` ledger row through the same economy triggers every other
payment uses. The refund is `floor(price × removalRefundRate)` computed **server-side from the
definition**; the client may only show the same arithmetic as a *preview*, and the status line
reports the server's number after the fact.

The receipt points at the ledger row when there is a refund and at the vanished object when there is
not, so "the receipt exists" and "the removal happened" are the same fact, and a replayed request
returns the same answer instead of paying twice.

`REMOVAL_REFUND_POLICY` (in the catalogue) is provisional balance data, per category: a building
returns half, a road or fence a quarter, a planting or a lantern nothing. No rate exceeds 1, so a
refund can never be a way to make gold.

## 12. World scenery versus player assets

The island's own trees, rocks and props are **world scenery**: drawn from a deterministic seed,
stored nowhere, and not editable. V13.2 deliberately did not turn them into database rows - that
would be thousands of rows and a very different save model. A player's own objects are
`farm_constructions`, with ids, owners and versions.

A later "clear the island's scenery" mechanic would have to introduce its own record; it must not
pretend a seeded instance is an owned object.

## 13. Protected world objects

The volcano, the village's own buildings and their reserved ground, the harbour's approach and the
island's authored road are not player assets. They are expressed as:

* `terrain: VOLCANO` / `BLOCKED`, or `reserved` on the cell, which the placement rule refuses as
  `CONSTRUCTION_BLOCKED`;
* world landmarks, which are scenery with a collision circle and no row to edit.

They never receive Move, Rotate or Delete, because those commands name a construction id and no such
row exists for them.

## 14. Land expansion (future)

Expansion is unchanged and compatible by construction: buying a plot inserts the plot's `farm_tiles`
rows, and those rows are what placement checks. A newly purchased cell therefore becomes buildable
the moment it is owned - there is no per-cell land-use assignment to make afterwards. Anything that
made a purchased cell require a district assignment would break this document's first principle.

## 15. Workers (future)

Worker compatibility is declared per asset (`gameplay.workerTask`) and nothing acts on it yet. When
it does, a worker is another actor: it must go through the same use cases and the same farm
authorization, and it may not get a private write path to constructions, crops or the wallet.

## 16. Production assets (future)

Production effects (`ProductionEffectSchema`) are declared per entry and marked `FOUNDATION_ONLY`
until a simulation reads them. The placement rule does not depend on them, and a production asset
that is not yet simulated is still placed, moved and removed by exactly the rules above - it simply
does nothing yet, and the shop says so.

## The rules this document exists to prevent

1. Requiring a FARM/FORESTRY/BUILD/DECORATION district, zone or capability for an ordinary owned
   cell. Placement reads terrain, ownership, footprint and occupancy - nothing else.
2. Calling the plot reservation "ownership". Ownership is `farm_tiles`; the reservation is which
   land the catalogue could sell.
3. Trusting the client with a price, a refund, a footprint or an owner. The server reads the
   definition and its own rows; the client sends a catalogue entry id and a cell.
4. Letting a move or a removal write a receipt before its effect. The receipt is guarded by the
   effect being visible in the same batch.
5. Giving a system object - the volcano, the village, the authored road - an editable row.

## Verifying it by hand

Everything below was verified against the rules, the API and a real database; the click-through is
the human's, because the review environment has no browser.

1. **Ownership.** Open the Build shop and pick Broadleaf Tree. The owned 12x12 parcel (cells
   `0,0`..`11,11` of the starter field) turns green, and the HUD says what green means. Move the ghost
   inside it: valid. Move it outside: "you do not own that land yet".
2. **Place.** On an owned, empty cell press **Enter** (or click *Build it* - the same command).
   Exactly one tree appears, exactly one charge appears in the wallet, and the reload keeps it.
3. **Select.** Leave placement mode (Esc) and click the tree you just placed. It gets a ring and a
   wash over its footprint, and the object panel opens with Move / Rotate / Delete. Clicking the
   island's own trees, rocks, barn or windmill does *not* open it: those are world scenery, not
   construction rows.
4. **Move.** Press Move, click another owned cell (Q/E turns the ghost, Enter confirms, Esc cancels),
   confirm. The tree is at the new cell only, nothing was charged, and a reload agrees.
5. **Rotate.** Select a building with a rectangular footprint (Barn t1 is 4x3) and press Rotate. The
   footprint becomes 3x4, and a reload keeps it. The silo has no Rotate button at all.
6. **Delete.** Press Delete, read the confirmation (it says how much gold comes back, or that none
   does), confirm. The object goes, the cells are free, the refund lands once, and a reload agrees.
7. **Modes are visible.** While placing or carrying, the green parcel is on screen and clicking lands
   where you point; once both modes are over, the island is unmarked again.
