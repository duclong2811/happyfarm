# World V12: the player-built island

Status: design of record. Read this before changing the island's terrain, districts, roads, or land
use.

## The change, stated plainly

**OLD.** The island was divided into developer-defined production districts. An authored blob was the
orchard, another was the managed wood, another was the pasture; a road was drawn to each of them; the
ground carried the rows and the beds that said which district you were standing in. A new district
meant a new blob, a new road, and a new set of authored rows.

**NEW.** The island is a place. The player builds the farm on it, out of land they own and objects
they place. The ground declares what it *can* support (`CellCapability`); ownership and the placed
object decide what it *is*. There are no production districts, no authored orchard rows, no authored
forestry plantation, and no published rule that a particular patch of ground belongs to a particular
industry.

Anything in this repository that reads as "this blob is the orchard" is older than this document and
is being retired, not extended. Nothing may reintroduce a district as a rule.

## What stays

The island still authors, because a player cannot build a place to arrive at:

* **the harbour** - one small quay, a yard, a fish store, and the boardwalk;
* **the community village** - a compact settlement with a square;
* **one stone road**, from the harbour to the village, plus one dirt road from the village to the
  barn's yard;
* **the barn**, the civic landmarks, and the natural landscape;
* **the WorldCell system** - the coordinate system, the terrain classification, and the walkability
  the character and every placement are checked against.

Everything else is the player's.

## Terrain

* Target: 70–80% of usable land flat or gently rolling. The island must not be a bowl, and it must not
  be ringed with mountains.
* One primary landmark: a **volcano**, north or north-central, roughly 10–15% of usable land, readable
  from the estate camera. Recognisable by structure - crater, upper volcanic rock, mid slope, forest
  foothill - not by effects. No lava simulation and no particle-heavy eruption in V12.
* The remaining land is developable. It is not "the fields" or "the wood" in advance.

**Current state: built in V12.1.** `TERRAIN_RELIEF_WORLD` is 2.6 and `ISLAND_UPLANDS` is one faint
northward lean, so the ordinary ground is a couple of metres of swell; the volcano is
`VOLCANO`/`VOLCANO_SHAPE` in `world-config.ts`, read by `volcanoHeightAt` in `terrain-height.ts`, and
its ground is classified `VOLCANO` by the cell map. The general relief is still *generated* rather
than authored, so a future pass may still want to flatten specific regions.

## Land use

One rule, in `apps/web/src/render/world-cell.ts`:

```text
cellCapabilitiesFor(terrain, zone) -> CellCapability[]
```

* `LAND` → `WALK`, `BUILD`, `FARM`, `FORESTRY`, `LIVESTOCK`, `ROAD`, `DECORATION`
* `SHORE` → `WALK`, `DOCK`
* `WATER` → `AQUACULTURE` in the shelf just outside the waterline (`SHALLOW_WATER_BAND`), nothing in
  the open sea and nothing in the lake
* `VOLCANO` + `VOLCANO_CORE` (the crater) → nothing at all: not walkable, not buildable, not a route
* `VOLCANO` + `VOLCANO_SLOPE` → `WALK`, `MINING` (a hook; no mining gameplay exists)
* `VOLCANO` + `VOLCANO_FOOTHILL` → `WALK`, `FORESTRY`, `DECORATION`
* `BLOCKED` → nothing

The answer never mentions a district. Two cells of the same ground answer the same way wherever they
are, which is what makes the rule usable by the player's own placement.

Examples of the intended reading:

```text
LAND + owned + crop plot        -> agriculture
LAND + owned + planted trees    -> forestry
SHALLOW_WATER + water rights + fish cage -> aquaculture
LAND + owned + road             -> transportation
LAND + owned + decoration       -> landscaping
```

`productionCapability` is still the *narrower* "what the server could grant today" answer (it knows
about the plot catalogue's reservation). The two are deliberately not the same question, and as of
V12.1 it no longer reads a district at all: dry land answers `CROP` for itself and the reservation
decides whether any particular cell may be planted.

## Roads

Kept: the road renderer (a terrain-following ribbon, batched cobbles for a stone surface, paved discs
at junctions), the junction graph, and the tier data.

Authored roads are now only:

1. `harbour_spine` (PRIMARY, paved) - harbour → the village square. It stops at the square: past the
   village the road is the player's;
2. `farm_road` (SECONDARY, dirt) - the square → the barn's yard;
3. `north_road` (SECONDARY, dirt) - the square → the volcano's **foothill**, terminating outside the
   steep band (`volcanoRadiusFraction` at the last waypoint is checked by a test). Nothing authored
   climbs the landmark;
4. `village_street` (PATH) - circulation inside the village;
5. `harbour_boardwalk` (PATH) - the quay.

Removed across the recovery and V12.1 passes, because they were roads built across land the player is
supposed to build on: `orchard_road`, `west_country_road`, `freshwater_road`, `forestry_track`,
`orchard_lane`, `pond_path`, `west_field_lane`, `east_field_lane`, `spawn_lane`, `mining_road`,
`mining_track`, `north_trail` and the long `farm_track`, plus the old ring-shaped primary and the
quarry-approach spur. A junction disc is now drawn only where two or more roads actually meet, so a
dead end reads as a dead end.

### Road tiers

`packages/game-data/src/roads/index.ts` is the one price table.

| Tier | Surface | Drawn as | Gold per tile |
| --- | --- | --- | --- |
| T1 | dirt path | `PATH` | 6 |
| T2 | dirt road | `SECONDARY` | 12 |
| T3 | stone road | `PRIMARY` | 60 |
| T4 | paved road | `PRIMARY` | 150 |

The prototype ratio the brief names holds exactly: the same length of dirt road costs a fifth of a
stone road. T4 reuses the stone surface on purpose - a premium road is a better stone road, and a
fourth geometry would be decoration before gameplay.

## The village

One compact community, and no city: a square, a town hall, a shop, a warehouse, a well or fountain, and
a notice board. It is the only place the island still decides what stands where, and the only place
with paved ground. Ground is left around it for later visual upgrades.

**Current state:** the settlement district and its landmarks exist. The notice board and the "reserve
space for upgrades" are not built yet.

## The harbour

One small starter harbour at the south-east bay: the arrival point, a visual landmark, and the hook for
a future boat and fishery connection. It is connected to the village by the stone road - one of the few
roads the island authors. No second harbour, and no roads leaving it in other directions.

**Current state:** built (quay, yard, fish store, boardwalk, moored boat, aquaculture raft beyond the
shoreline).

## Ownership, expansion, and the shop

* Valid ground and owned ground are different things. A cell is always classified; ownership is a
  separate fact about it.
* Starter ownership is a small share of developable land - roughly 8–12% - and it must not read as a
  giant visible square.
* Expansion is bought in blocks (4, 6, 8, 12 cells). A block must be valid, adjacent to the player's
  existing topology, outside the civic reserve, outside the volcano core, and inside the island.
  No real-money transaction in V12; the current plot catalogue stays as it is until an expansion
  contract exists.
* The build catalogue (`packages/game-data/src/placement/index.ts`) is the foundation of the shop's
  *placement* side, and it is deliberately separate from the market. The market's rule - gold buys
  seeds and produce only ever sells - is not loosened to sell a fence. The catalogue declares every
  category the direction names (roads, fences, farming, forestry, aquaculture, buildings, storage,
  decorations, nature, utility, monuments, and the reserved workers/vehicles/livestock/processing),
  and ships only the four road tiers today.

**Current state (V12.1):** the capability vocabulary, the shop foundation, and the ownership
foundation all exist. `apps/web/src/render/land-ownership.ts` cuts the island into sixteen-cell
parcels with stable ids, reads the owned parcels from the authoritative tiles, computes adjacency,
and reports the parcels that are eligible to be bought next; protected ground (the crater, the
village, the harbour, the sea, and barren cells) is never eligible. A purchase is still the plot
catalogue's business: nothing here can grant land or take a payment.

**Known gap, stated plainly.** The brief asks the starter land to be 8-12% of the island's
developable land. The shipped starter square is what the *server* grants on farm creation
(`INITIAL_LAND_SIZE` = 12, so 144 cells), which measures at roughly 1.5% of the island and about 11%
of the land the current plot catalogue can sell. Raising it moves plot geometry, the plot catalogue,
and every existing farm's `farm_tiles`, and would need a migration - which this pass is forbidden from
running. `tests/web/land-ownership.test.ts` measures and reports the number rather than hiding it.

## Assets

No asset is downloaded in this pass. The rule for later: visual wealth must rise with progression, so
level 1 is a dirt road, a wood fence, a shed, and ordinary planting, and later levels are stone, better
fences, larger storage, fountains, lamps, statues, and civic buildings. Every import goes through
`tools/asset-pipeline/` and is recorded in `docs/ASSET_LICENSES.md`.

## Workers

Documented, not implemented. Low levels are played by hand; higher levels allow hiring workers, whose
count rises with level. The intended loop for one worker - assigned cells, travel, harvest mature
rice, collect, replant, wait, repeat - is what a later pass builds. No worker loop is added in V12,
partly because a background simulation per worker is exactly the kind of cost the performance recovery
removed.

## What is removed, and what is still to remove

Removed in the recovery pass: the authored road network across the production districts.

Removed in V12.1:

* the authored crop parcels and their furrows (`FIELD_BLOCKS`, `addFieldBlocks`);
* the pre-built orchard and managed-wood rows (`plantRows`, `addProductionRowBeds`);
* the aquaculture cages moored in the bay (`FISH_FARM`, `addAquaculture`);
* the timber yard and its haul road (`LOGGING_YARD`, `addLoggingYard`);
* the hedgerows and field edges that framed those parcels;
* the locked-plot board: the raised squares, the stake line and the signposts
  (`addLockedLand`, `addSignpost`), and the production districts' *zones with meaning*
  (`AQUACULTURE_ZONE`, `MINING_RESERVE`, and the cropland/orchard/pasture/forestry zone mappings);
* the uplands that made the island a bowl with a mountain ring, and the nine-centimetre tile step.

Still to remove or replace:

* the district *entries* themselves (`DISTRICTS` in `world-config.ts`). They no longer decide what a
  cell may be used for - a test proves it - and they are now only a scatter hint and a label, but the
  cropland, orchard, pasture and managed-wood rows are still the names of places that no longer mean
  anything. Removing them is a small, contained follow-up;
* the player's own cultivated plot still reads as a slightly raised patch of ground; the apron that
  surrounds the owned tiles could be blended further into the terrain.

The district vocabulary itself may stay, because districts still describe *landscape* - what grows
where, how a place reads from the estate camera. What may not come back is a district deciding what
the player is allowed to do with their own land.

## Visual acceptance

The estate view has to say, within about five seconds:

```text
NORTH          volcano
EAST/CENTRAL   community village
SOUTH/COAST    harbour
BETWEEN        large player-developable landscape
```

It must not say: finished farm, fixed orchard, fixed forestry plantation, fixed fishery, giant grid,
or mountain ring.

**Measured in V12.1.** The eighteen views in `apps/web/qa/views.ts` were rendered with headless Edge
and inspected. From the estate camera the island reads as: volcano north, village east, harbour
south-east, and open ground between them, with one small cultivated plot belonging to the player. The
crater is legible from elevated angles and subtle from a low one; the harbour's pier reads better from
above than from the waterline. Both are recorded as remaining weaknesses rather than fixed.
