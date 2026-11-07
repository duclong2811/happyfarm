# 0029. Land ownership is not terrain, and single cells are for sale

Status: accepted (V14.5.1). The green-terrain rule still stands; the ownership-as-a-boundary and
per-cell land *sale* parts are superseded by `0030-home-island-free-land.md` (V14.5.2).

## Context

Ownership and ground appearance had drifted into one idea. A farm tile row is unlocked land
(`UnlockedLandPolicy`), the starter square and every bought plot are written as `SOIL`, and the
renderer drew every owned tile as a soil slab under a 1.5-tile dirt apron with furrows across the
whole parcel. The result was a large yellow rectangle in the middle of an otherwise green island: the
map said "you may develop this", and the picture said "this is a field".

The player also had no way to buy land one cell at a time. The only path was a whole 12 x 12 plot
chosen by the server from the contiguous spiral, which is good for a big decision and bad for
"I need exactly one more cell for this road".

## Decision

### Ownership and terrain are separate

**Buying land changes what the player may do with a cell; it does not change what the cell looks
like.** The rule, as shipped:

```text
owned empty cell                 -> grass
owned cell carrying a crop       -> one local soil pad on that cell only
owned cell with a built object   -> the object's own ground treatment (or grass)
owned cell a road crosses        -> the road visual
```

Implementation:

* `tileDrawsSoil(tile)` in `apps/web/src/render/view-model.ts` is the one predicate: a tile shows
  soil only when it carries a crop.
* `tileColorFor` in `apps/web/src/render/materials.ts` draws `SOIL` + uncultivated as the same tone
  as grass, and only `SOIL` + cultivated as soil.
* `buildTileSlabs` in `apps/web/src/render/scene.ts` instances a pad for cultivated tiles only, with
  its top at `TILE_SURFACE_Y` (`apps/web/src/render/terrain.ts`) - one tile thickness above
  `GROUND_SURFACE_Y`. There is no apron, no soil bed and no furrow lattice tied to ownership; the
  `FarmWorld.apron`/`.bed` fields and `addFieldGround` are deleted.
* Production trees sit on `GROUND_SURFACE_Y` (grass), not on a removed pad.

Harvested/empty plots read as grass. A tile keeps its local shade across growth because the tone is a
function of the coordinate, and a purchase changes nothing about the island's static layer.

### Existing saves are untouched

Ownership is still exactly `farm_tiles`. No migration runs, no row is rewritten, and a farm that
already owns a large rectangular parcel keeps every cell; only the way it is drawn changes. Crops,
trees, roads, buildings, inventory, wallet and progression are unaffected.

### Single-cell purchase

`POST /farms/:id/land/cells` buys one or more cells for the authenticated farm owner.

* **Authority.** The command carries coordinates and a request id only. Price, currency, plot and
  level requirement come from the plot catalogue; ownership from `farm_tiles`. The client cannot name
  a price or a plot.
* **Cells (V14.5.1B, freeform).** Each cell is judged by `BuyLandCells`. There is **no adjacency
  requirement**: land ownership is an economic cost, not a creative boundary, so any cell on the Home
  Island may be bought. What remains is real geography and authority - the island must call the ground
  developable (`LandSaleLookup`, the same `classifyTile` the placement rule reads: dry, unprotected,
  inside the island; ocean, the pond, the beach, the volcano and reserved ground are refused), the
  cell must not already be owned, and the player must meet the level of the plot whose rate sets the
  price. A cell that fails any of these refuses the whole request - no partial purchase.
* **Atomicity.** The wallet movement, its ledger row, every new `farm_tiles` row and the idempotency
  receipt are one D1 batch (`D1FarmExpansionRepository.buyLandCellsAtomically`). The `farm_tiles`
  primary key is the concurrency guard: two racing purchases of the same cell cannot both be charged,
  and the wallet's version predicate refuses a stale debit.
* **Idempotency.** Operation `BUY_LAND_CELLS`, keyed by `(actor, requestId)`. A replay returns the
  recorded result; reusing a request id with a different cell list is `IDEMPOTENCY_CONFLICT`.
* **Ledger.** Reason `FARM_EXPANSION` (a cell purchase is farm expansion, and the ledger's land
  reference kind is `PLOT`), reference id the enclosing plot of the first cell. The idempotency
  operation keeps it distinguishable from a plot purchase.

### The single-cell price

Centralized and deterministic, in `packages/domain/src/plot.ts`:

```text
singleCellPrice(plotPrice) = max(1, floor((plotPrice / 144) * (1 + 0.25)))
```

144 is `PLOT_TILE_COUNT`, so the price is the enclosing plot's per-cell price plus a 25%
convenience premium (`SINGLE_CELL_PREMIUM_PERCENT`), floored to whole gold and never below 1. A cell
that falls outside every catalogue cohort - freeform development reaches the whole island - is sold
at the *deepest* plot's rate, so the on-demand price stays tied to the top of the bulk economy.
Bulk land stays the cheaper way to buy the same ground: 144 cells at the single-cell price always
cost more than one plot. The client never computes it - `POST /farms/:id/land/quote` returns the
authoritative per-cell price and eligibility, asked only when a purchase is about to be confirmed
(or once for the bounded land-mode ring), never per pointer move. An owned cell quotes at price 0.

### Build and plant on unowned ground

Ownership never refuses an otherwise-valid location, and the player never has to enter Land Mode
first.

* **Build.** When a footprint covers unowned cells that are otherwise valid, the placement HUD stops
  refusing and says so. The first confirm asks the server to price the missing cells and shows the
  total; the second confirm buys them (`POST /land/cells`) and then places the object. Already-owned
  cells cost nothing, and any cell buying could not fix still refuses the whole placement. The
  candidate footprint is tinted amber (valid, land purchase required) instead of green.
* **Plant.** Targeting an unowned but developable, empty cell offers the plant in the dock: the first
  press prices the cell, the second buys it and then runs the ordinary planting command. The dock
  labels the second press "Buy land & plant".

The shared footprint pipeline means this is not building-specific: roads, fences, lighting, utility
and decoration entries all go through the same preview and the same quote.

Visualization is candidate-only. During plant/build the renderer draws the selected cell and the
footprint preview; the whole-parcel ownership wash is shown **only** in the explicit land management
mode, and the planting lattice outlines one cell rather than every plantable tile.

**Known limitations, stated plainly:**

* The land fee and the build are two settled commands, not one. If the build is refused after the
  land is bought, the land stays bought. The combined single-operation form is deferred; the ordering
  is reported rather than hidden.
* Land is sold as dry developable ground only. The one water-only catalogue entry (the fish cage,
  which may only stand on the shallows) therefore cannot be acquired through the freeform flow yet; a
  later pass needs a water-sale rule and its own placement validation.
* Authored set-dressing clearings inside the reservation are not protected server-side, because the
  server's authority is geography (`classifyTile`), not the client's composition presets.

## Consequences

* The island reads green; ownership is logical and the grid stays invisible in normal play.
* Land is a two-dimensional progression - whole plots for value, single cells for precision - with a
  single price rule and one write boundary.
* The client carries no land authority: every price, eligibility decision and grant comes from the
  server, and the tests in `tests/api/land-cells.test.ts` cover the security cases (non-owner,
  insufficient gold, already owned, disconnected, outside the sale area, level gate, idempotency,
  concurrent purchase, a client-supplied price, and an existing save's tiles).
