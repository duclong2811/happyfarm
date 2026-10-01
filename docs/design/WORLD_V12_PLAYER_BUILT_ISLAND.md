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

1. `harbour_spine` (**dirt**, `SECONDARY`) - harbour → the village square. V12.2's correction: the
   island is undeveloped, so the one road it supplies is the cheapest one that works. It stops at the
   square, and past the village the road is the player's;
2. `farm_road` (dirt) - the square → the barn's yard;
3. `north_road` (**footpath**) - the square → the volcano's **foothill**, terminating outside the steep
   band (`volcanoRadiusFraction` at the last waypoint is checked by a test). A walk to the landmark,
   not a second highway, and nothing authored climbs the mountain;
4. `village_street` (PATH) - circulation inside the village;
5. `harbour_boardwalk` (PATH) - the quay.

Paving is **civic**: the village square, and nothing else. That single rule is what the estate view
has to say - harbour → dirt road → village entrance → paved plaza.

The geometry behind that reading is one authoritative centreline: waypoints, a Catmull-Rom spline,
resampled **by arc length** at a fixed step, one clamped mitre per sample, constant-width edges. The
width is a property of the class and nothing perturbs it - the organic part of a dirt road is in its
material and its wheel lanes, not in its outline. V12.3 narrowed the island's road to 1.75 cells and
its shoulder to 0.26 metres, because at estate zoom the previous road read as a highway rather than a
farm track.

Removed across the recovery and V12.1 passes, because they were roads built across land the player is
supposed to build on: `orchard_road`, `west_country_road`, `freshwater_road`, `forestry_track`,
`orchard_lane`, `pond_path`, `west_field_lane`, `east_field_lane`, `spawn_lane`, `mining_road`,
`mining_track`, `north_trail` and the long `farm_track`, plus the old ring-shaped primary and the
quarry-approach spur. A junction disc is now drawn only where two or more roads actually meet, so a
dead end reads as a dead end.

### Road tiers

`packages/game-data/src/roads/index.ts` is the one price table.

Roads are bought in **segments of four cells**, each tier upgrades into the one above it, and every
price lives in `packages/game-data/src/roads/index.ts`.

| Tier | Id | Surface | Drawn as | Gold per 4-cell segment |
| --- | --- | --- | --- | --- |
| T1 | `road.dirt.t1` | dirt | `SECONDARY` | 100 |
| T2 | `road.gravel.t2` | gravel | `SECONDARY` | 250 |
| T3 | `road.stone.t3` | stone | `PRIMARY` | 500 |
| T4 | `road.paved.t4` | paved | `PRIMARY` | 900 |

These are **provisional placeholders**, and the ratio the brief asks for holds exactly: a stone segment
costs five times a dirt one. Stone and paved share the widest drawn class because the client draws three
ribbons, not four - a gravel and a paved *material* are later imports, and a fourth geometry before the
art exists is decoration before gameplay. Upgrading reuses the same cells: the tier a road becomes is a
lookup, not a demolition.

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

Documented, not implemented - and deliberately so. A worker is a simulation that runs while the player
is not looking, which is exactly the kind of cost the performance recovery removed, so it arrives with
its own pass rather than as a side effect of this one.

**The intended progression.** Early game the player does everything by hand: plant, wait, harvest,
replant. At a level the player can hire, and the workforce cap rises with level. Roles a worker will
specialise in: crop, orchard, forestry, fishery, livestock, transport. A crop worker assigned to a set
of cells travels to them, plants where a cell is empty and authorised, works elsewhere while the crop
grows, harvests when the server says it is mature, and repeats - the same commands a player issues,
issued by a system with the same authorisation, never a shortcut past the server.

**What V12.2 establishes so that pass is not a rewrite.** The cell is the unit of assignment
(`WorldCell` + `CellCapability`), the capability vocabulary is shared with the build catalogue in
`packages/game-data`, and production is *placed objects on owned cells* rather than districts - so
"these four cells are this worker's" is already expressible. No worker type, schedule, or AI exists.

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

Removed in V12.2:

* the production district *entries* themselves. `DistrictKind` is now `SETTLEMENT | COAST` and
  `DISTRICTS` holds two places, because a name with no reader is a name the next pass treats as a rule.
  The woodland masses they used to describe were kept as `WOODLANDS`: landscape, not districts and not
  claims;
* the locked-plot boundary stakes, which no renderer had drawn since V12.1;
* the island's finished stone road - it is dirt now, and the volcano's access is a footpath;
* the orchard yard composition preset, which furnished a road that no longer exists.

Still to remove or replace:

* the player's own cultivated plot still reads as a slightly raised patch of ground; the apron that
  surrounds the owned tiles could be blended further into the terrain;
* a building's `district` is `null` when it stands on open land (the windmill, the coop, the storage
  shed). Those landmarks occupy cells a player might want; a later pass could make them movable, or
  place them only where the island still owns the ground.

What may not come back is a district deciding what the player is allowed to do with their own land.

## Visual acceptance

The estate view has to say, within about five seconds:

```text
NORTH          volcano
EAST/CENTRAL   community village
SOUTH/COAST    harbour
BETWEEN        large player-developable landscape
```

It must not say: a finished stone highway across the island, trees standing in roads, rocks blocking
roads, pre-built industrial agriculture, pre-built fish farms, pre-built managed forestry, a permanent
world grid, a mountain ring, or giant authored production districts.

**Measured in V12.1.** The eighteen views in `apps/web/qa/views.ts` were rendered with headless Edge
and inspected. From the estate camera the island reads as: volcano north, village east, harbour
south-east, and open ground between them, with one small cultivated plot belonging to the player. The
crater is legible from elevated angles and subtle from a low one; the harbour's pier reads better from
above than from the waterline. Both are recorded as remaining weaknesses rather than fixed.

**Measured in V12.2.** The same eighteen views, re-rendered and re-inspected after the dirt-road pass.
The road now reads as harbour → dirt → village → paved plaza, and the QA pass found and fixed three
things the numbers could not: ground poking through the road near the quay (the road's lift was raised
from 5 cm to 16 cm - the shore fade is the steepest terrain on the island and the ground mesh
interpolates across it), canopy overhang at the road's edge (large scenery now keeps half again the
clearance a small thing does), and the volcano's access reading as a wide smear from the estate camera
(it is a footpath now).
