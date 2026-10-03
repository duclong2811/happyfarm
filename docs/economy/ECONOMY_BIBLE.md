# HappyFarm economy bible

Status: V16.1.1. This is the map of the economy: what is **implemented today**, what is **proposed and
modelled** by `packages/economy-sim`, and what is **future** and deliberately undecided. It does not
declare the economy balanced, and it does not authorise any gameplay change.

## The three columns

| | Status | Where it lives |
| --- | --- | --- |
| **Implemented today** | shipping and authoritative | `docs/economy/ECONOMY_BASELINE.md`, the game-data catalogs |
| **Proposed / modelled** | design only, no gameplay reads it | `docs/economy/FIVE_ELEMENT_ECONOMY.md`, `FIVE_ELEMENT_CAPACITY_MODEL.md`, `ECONOMY_SIMULATION.md`, `packages/economy-sim` |
| **Future** | undecided, listed so it is not forgotten | the "what is not decided" sections below |

Nothing in the proposed column may be described as a shipped feature, and no price, yield, XP value or
regeneration time was changed in this phase.

## The loop the economy is meant to close

```text
PRODUCTION -> STORAGE -> PROCESSING -> CONSUMPTION -> TRADE -> GOLD
     ^                                                          |
     +------ INFRASTRUCTURE <- AUTOMATION <- CAPITAL <-----------+
```

Today only the left edge exists: production turns gold into goods and goods back into gold, and nothing
consumes a good. The economy must not settle into "gather, sell to an NPC, repeat" - which is exactly
what the simulator measures as inflation.

## Faucets, sinks and the measurement that matters

| | Implemented today | Proposed |
| --- | --- | --- |
| **Gold faucets** | the market buying produce | NPC contracts, quests, harbour contracts, PvE |
| **Gold sinks** | buying seeds/saplings, land | warehouse, buildings and upgrades, tools, wages, processing, docks, ships, repair, market fees, military |
| **Resource sources** | farming, fishing, mining, forestry (all regenerating) | aquaculture, deeper mining, wild islands, shared grounds |
| **Resource sinks** | planting inputs only | construction, upgrades, tools, machines, ships, repair, military, voyages, expansion |

Player-to-player trade moves gold; it never creates it, and the fee is the only gold it destroys. Every
simulated scenario reports `GOLD_CREATED`, `GOLD_DESTROYED` and `NET_GOLD` per day so an inflationary
structure is visible rather than felt.

## Non-negotiable model rules

1. **Home Island must not scale forever.** Ceilings come from land, coastline, deposits, regeneration,
   livestock space, processing lanes, housing and storage - never from an arbitrary per-day cap.
2. **Upgrades cost more the further you go** and consume several outputs (gold *and* materials), so that
   trading or expanding eventually beats another upgrade.
3. **Specialisation is a comparative advantage, never a lock.** Every island can do every basic
   profession.
4. **Food is categories, not one resource** (staples, vegetables, protein, provisions), so the cheapest
   crop cannot feed an army.
5. **The five elements are five resource specialisations** (Earth agriculture, Water fishing, Wood
   forestry, Metal mining, Fire livestock). Processing and manufacturing are **shared systems** that any
   island can run; no element gets an industrial bonus.
6. **Automation adds demand.** A worker eats, is paid, needs a home, and stops when the store is full.
7. **The NPC shop is a safety net**, capped in quantity and priced above market, never a wholesaler.
8. **Nobody's progress depends on another player.** Trade and logistics are how a *large* economy grows,
   not a prerequisite for a small one.

## Progression bands (hypothesis)

| Band | Levels | Shape |
| --- | --- | --- |
| Early | ~1-10 | Self-sufficient, NPC-supported, ceilings invisible |
| Developing | ~10-20 | Storage and land decisions appear; the market becomes useful |
| Mid | ~20-35 | Specialisation pays, processing starts, workers arrive |
| Industrial | ~35-50 | Trade, logistics and expansion become structurally important |
| World | beyond level | Infrastructure and territory, not character level |

The current curve reaches level 50 at 147,000 XP. The V16.1 simulator estimates active play from the
solo-Earth experience rate at the Early stage (clearly labelled as an estimate, because it uses one
activity mix):

| Archetype | XP/day | Time to L5 | L10 | L20 | L35 | L50 |
| --- | --- | --- | --- | --- | --- | --- |
| Casual (20 min/day) | ~67 | 18 d | 81 d | 341 d | 1,069 d | 2,201 d |
| Normal (1 h/day) | ~401 | 3 d | 14 d | 57 d | 178 d | 367 d |
| Hardcore (3 h/day) | ~2,044 | 0.6 d | 3 d | 11 d | 35 d | 72 d |
| Automated (10 min + workers) | ~127 | 10 d | 43 d | 180 d | 563 d | 1,158 d |

**Recommended adjustment**: the Early band (L1-10) is reachable in a few playing sessions and the later
bands are sharply longer; the split between casual and normal is very wide. The band boundaries are a
question for the phase that implements the sinks, and the estimate above uses one activity mix, so it is
direction, not a promise.

## Player archetypes the model must serve

Casual (20 minutes a day), Normal (an hour), Hardcore (three hours), Automated (short manual time plus a
large hired workforce). Their modelled differences are time, capacity usage and worker count - not
different rules - so the economy must work for someone who plays for twenty minutes as well as for
someone running an industrial island.

## What is not decided

- The exact physical ceilings, starter fractions and development costs (calibrated again once the future
  systems exist).
- The exact animals and per-animal livestock recipes (the model uses one representative pen).
- Whether the backpack and the Island Warehouse are separate, and where direct-from-warehouse production
  is allowed (assumed yes for the model, not implemented).
- The exact durability/listing rules of the market; the model uses a conceptual buy/sell order book with a
  fee.
- Where the military, naval and logistics sinks sit on the cost curve.
- Region, zone and world-map economics - named as direction only; the model assumes one instant market.
  No element respec or island transformation; that is a future world-scale project, if it exists at all.

## Locked design decisions (V16.1)

- The canonical mapping is **Earth = Agriculture, Water = Fishing/Aquaculture, Wood = Forestry,
  Metal = Mining, Fire = Livestock** (V16.1.1).
- **Processing / refining / crafting / manufacturing are shared systems**; no element owns them.
- The element belongs to the **Home Island**, not the player, and specialisation is a comparative
  advantage, **never a profession lock**.
- **Physical capacity first**; numeric efficiency is a small resource-only modifier (0.90x-1.15x).
- There is **no hard daily extraction cap**; ceilings come from deposits, regeneration, land, lanes,
  labour, storage and inputs.
- The Home Island has a **finite practical ceiling**, and upgrades get more expensive per unit; a
  near-max upgrade pays back over ~70 days of its added output, so importing eventually wins.
- The market becomes useful through scale, not a prerequisite for a small island.
- The NPC shop is a **safety net**, capped and marked up.
- Workers **consume economic inputs** and **cannot create physical capacity**.

## Where to look next

1. `docs/economy/ECONOMY_BASELINE.md` - what the game pays today.
2. `docs/economy/FIVE_ELEMENT_ECONOMY.md` - the island archetypes.
3. `docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md` - the physical profiles, development curve, workplace
   slots and storage progression.
4. `docs/economy/ECONOMY_SIMULATION.md` - the simulator, the scenarios and the V16.1 findings.
5. `packages/economy-sim` - the model itself, and the tests that hold it.
