# HappyFarm economy bible

Status: V16.0. This is the map of the economy: what is **implemented today**, what is **proposed and
modelled** by `packages/economy-sim`, and what is **future** and deliberately undecided. It does not
declare the economy balanced, and it does not authorise any gameplay change.

## The three columns

| | Status | Where it lives |
| --- | --- | --- |
| **Implemented today** | shipping and authoritative | `docs/economy/ECONOMY_BASELINE.md`, the game-data catalogs |
| **Proposed / modelled** | design only, no gameplay reads it | `docs/economy/FIVE_ELEMENT_ECONOMY.md`, `ECONOMY_SIMULATION.md`, `packages/economy-sim` |
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
5. **Fire creates value, not raw resources.** It is the best processor and never the best extractor.
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

The current curve reaches level 50 at 147,000 XP, which the farming, fishing, mining and forestry rates
above can support; whether the *band boundaries* are right is a question for the phase that implements
the sinks, and the simulator currently cannot answer it because it has no land-purchase step.

## Player archetypes the model must serve

Casual (20 minutes a day), Normal (an hour), Hardcore (three hours), Automated (short manual time plus a
large hired workforce). Their modelled differences are time, capacity usage and worker count - not
different rules - so the economy must work for someone who plays for twenty minutes as well as for
someone running an industrial island.

## What is not decided

- Whether the element belongs to the island, the player, or both; and whether it can change.
- The final capacity multipliers (the simulation shows the current ones are too mild).
- Storage: base capacity, tier costs, and whether the backpack and the warehouse are separate.
- Worker economics: housing, wages, food, and how productivity degrades when inputs run out.
- Market structure: order book, fees, and whether listings are durable.
- Where the military, naval and logistics sinks sit on the cost curve.
- Region, zone and world-map economics - named as direction only.

## Where to look next

1. `docs/economy/ECONOMY_BASELINE.md` - what the game pays today.
2. `docs/economy/FIVE_ELEMENT_ECONOMY.md` - the island archetypes.
3. `docs/economy/ECONOMY_SIMULATION.md` - the simulator, the scenarios and the V16.0 findings.
4. `packages/economy-sim` - the model itself, and the tests that hold it.
