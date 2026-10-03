# The five-element capacity & progression model

Status: **V16.1, proposed and modelled - not implemented.** No gameplay reads this. The numbers live in
`packages/economy-sim/src/elements.ts` and `model.ts`, and the tables below are printed by the simulator
(`tests/economy-sim/economy-model.test.ts` holds the invariants).

This document is the V16.1 answer to the question V16.0 could not answer:

> At what point, and for what economic reason, does a player begin to benefit from - or depend on -
> other players, trade, logistics, or world expansion?

V16.0 could not answer it because a Home Island's capacity never constrained production. Capacity was a
*multiplier* (0.6x-1.9x) on one shared baseline, so every island was the same island with different
stats, and the simulation showed the consequence: no element ever needed a neighbour (99-100%
self-sufficiency), the ceiling never bound (0.8-1.3% utilisation), and storage filled on day one.

## The correction: geography first, numbers second

The element now describes **physical capacity first** and a small efficiency modifier second. Metal
mines more because it *has more deposits*, not because "Metal ore x2.4". Fire's industry is fed from
elsewhere because its ground holds fewer deposits and fewer trees, not because a multiplier says so.

The element belongs to the **Home Island**, not the player. Every island can still run every profession;
the element decides how far a profession can be *developed*, never whether it is allowed. There is no
ordinary respec - island transformation would be a future world-scale project.

### Physical maximum capacity (the ceiling)

| Element | Farm tiles | Fishing spots | Mining nodes | Forestry nodes | Livestock pens | Processing lanes |
| --- | --- | --- | --- | --- | --- | --- |
| Earth | 160 | 4 | 6 | 10 | 12 | 4 |
| Water | 96 | 12 | 5 | 9 | 9 | 5 |
| Wood | 120 | 6 | 7 | 20 | 10 | 7 |
| Metal | 96 | 5 | 18 | 10 | 8 | 9 |
| Fire | 72 | 5 | 6 | 12 | 20 | 14 |

Fire's extraction ceilings (6/12) sit below the raw specialists' (18 Metal deposits, 20 Wood trees); its
industry (14 lanes) is the largest. The efficiency modifier (0.90x-1.15x) is deliberately small and is
clamped in code.

### Starter capacity vs maximum capacity

A player does not begin with the island developed to its ceiling. Each profession starts at a fraction of
its maximum and develops in five steps; the element's primary profession starts a little further along.

| Element | Farm tiles | Fishing spots | Mining nodes | Forestry nodes | Livestock pens | Processing lanes |
| --- | --- | --- | --- | --- | --- | --- |
| Earth | 56 | 1 | 1 | 2 | 3 | 1 |
| Water | 24 | 5 | 1 | 2 | 2 | 1 |
| Wood | 30 | 2 | 1 | 6 | 3 | 1 |
| Metal | 24 | 2 | 5 | 2 | 2 | 1 |
| Fire | 18 | 2 | 1 | 2 | 7 | 2 |

Developed capacity is interpolated between the starter and the ceiling and can never exceed the ceiling,
whatever a caller passes. At the Industrial stage (three of five extraction steps, five of five industry
steps) the developed figures are:

| Element | Farm tiles | Fishing spots | Mining nodes | Forestry nodes | Livestock pens | Processing lanes |
| --- | --- | --- | --- | --- | --- | --- |
| Earth | 118 | 2 | 3 | 5 | 7 | 3 |
| Water | 53 | 9 | 3 | 5 | 5 | 3 |
| Wood | 66 | 4 | 3 | 14 | 6 | 6 |
| Metal | 53 | 3 | 13 | 5 | 4 | 7 |
| Fire | 29 | 3 | 2 | 4 | 15 | 14 |

This is why a mature Fire island runs fourteen workshops and works two deposits.

## The development cost curve

Expanding capacity gets more expensive per unit every step - in gold *and* in materials, and the late
steps start to consume industrial goods (timber, steel) rather than only wood and stone. That is the
structural reason a mature island eventually prefers to trade or expand rather than pour everything into
another tier.

`MARGINAL_CAPACITY_COST` is the gold-equivalent cost of **+1 unit** of the element's primary capacity, on
the simulated price map:

| Element | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 |
| --- | --- | --- | --- | --- | --- |
| Earth (farm tiles) | 17 | 61 | 131 | 224 | 339 |
| Water (fishing spots) | 250 | 909 | 1,939 | 3,322 | 5,044 |
| Wood (forestry nodes) | 125 | 454 | 970 | 1,661 | 2,522 |
| Metal (mining nodes) | 135 | 489 | 1,044 | 1,789 | 2,716 |
| Fire (processing lanes) | 146 | 530 | 1,131 | 1,938 | 2,942 |

This is the number that answers "should I upgrade my island or buy from another player?". It is reported
per element, and it is strictly increasing by construction (capacity gain per step is linear, cost is
convex).

## Workers work capacity; they never create it

A worker can raise the *utilisation* of developed capacity, up to the workplace slots that capacity
supports and never past it. A mine with five slots worked by twenty miners does not produce four times
the ore. The engine caps player actions and worker actions against the same developed capacity, and the
tests assert that no element's utilisation - or workplace fill - can exceed 1.

- Workplace slots per developed unit: farming 1/6, fishing 1, mining 1/2, forestry 1/3, livestock 1/2,
  processing 2.
- Workers eat staples **and** protein, cost gold, and are starved into a lower rate when either is
  missing; the worker-heavy scenario (more than half the population on the automated profile) is the one
  that pushes a Home Island toward its physical ceiling.

## Storage scales with progress, not with one big number

V16.0 filled storage on day one because 500 units per resource is nothing next to a working island's
output. V16.1 starts storage at ~40,000 units per resource per island - calibrated to roughly a month of
a starter island's output - and doubles it on each upgrade, which costs gold, wood, stone and (later)
timber. In the balanced scenario, storage first reaches 50% on day 9 at the Early stage but the first
upgrade happens around the 80% milestone (day 14 Early, day 9-10 Industrial), so the warehouse is a
**meaningful investment** rather than day-one tetris. The metrics report `STORAGE_50/80/FULL`,
`STORAGE_CONSTRAINED_PERCENT` and `LOST_OUTPUT_TO_STORAGE` so the shape can be checked as the systems are
built.

## Fire's two identities

| Stage | Fire's first profession | Fire's second profession | Fire's raw self-sufficiency index |
| --- | --- | --- | --- |
| Early | livestock (7 starter pens) | light processing | 91% |
| Developing | livestock | processing | 83% |
| Mid | livestock | processing | 75% |
| Industrial | processing | livestock | 65% |
| World | processing | livestock | 66% |

Fire's **raw** import dependency rises with its industry, exactly as the brief asks:

| Fire stage | Feed (potato) | Fish/protein | Wood | Iron ore | Coal |
| --- | --- | --- | --- | --- | --- |
| Early | 23% | 18% | 0% | 50% | 0% |
| Developing | 34% | 18% | 0% | 71% | 2% |
| Mid | 26% | 15% | 7% | 86% | 37% |
| Industrial | 34% | 15% | 14% | 91% | 61% |

Softwood stays locally adequate for Fire because a handful of trees yields bulk timber; ore, coal, feed
and protein are what it buys. Hardwood and resin are not consumed by Fire's process recipes at all - they
leave the island only through the logistic sink - so their Fire dependency is not yet a modelled channel.

## Food is a network, not one resource

- **Earth** supplies staples, vegetables and feed (potato, wheat, corn, cabbage, pumpkin, tomato,
  strawberry).
- **Water** supplies fish and maritime protein (tilapia, carp, catfish, sardine, mackerel, snapper, tuna).
- **Fire** supplies meat and eggs from pens that eat Earth's feed.

Workers eat a staple *and* a protein; livestock eat staples; the provisions recipe eats fish and potato.
No single crop or fish can satisfy every requirement, so an Earth island cannot feed an army without a
Water or Fire partner. Fishing and mining produce the **mix** their tables hold (every fish species; stone,
coal, copper and iron together) rather than a single "best" item.

## Cross-element demand matrix (mature)

Rows are sellers, columns are buyers; the strength is the simulated import dependency of the mature buyer
on the seller's goods (Strong > 50%, Medium 20-50%, Light < 20%, "-" self).

| Sells to -> | Earth | Water | Wood | Metal | Fire |
| --- | --- | --- | --- | --- | --- |
| **Earth** (food/feed) | - | Medium | Medium | Medium | **Strong** |
| **Water** (fish/protein) | Light | - | Light | Medium | **Strong** |
| **Wood** (wood/timber) | Light | Light | - | Light | Medium |
| **Metal** (ore/coal/copper) | Medium | Medium | **Strong** | - | **Strong** |
| **Fire** (steel/tools/meat) | Light | Light | Light | Medium | - |

Every element sells something at least one neighbour wants, and every mature element needs at least one
other element. The matrix is derived from the run, not asserted by hand.

## Resource-flow graph

```text
SOURCE            INTERMEDIATE                 CONSUMABLE                 CAPITAL / SINK

crops (Earth) --> staples, vegetables ------> worker food --------------+
                                            -> livestock feed (Fire) ---+--> meat, eggs (Fire)
fish (Water)  --> fish species -------------> worker protein, provisions
wild trees    --> wood ----(3)-> timber ----> ships/logistics, tools
                  resin --------------------> logistics
                  hardwood ----------------> ships/military
deposits      --> stone ------------------> construction, storage upgrades (SINK)
                  coal -----+-------------> fuel for steel & components
                  iron -----+--> steel ---> tools, military (CAPITAL/SINK)
                  copper ---+--> components -> tools, military (CAPITAL/SINK)

SINKS: logistics and military consume provisions, timber, resin, hardwood, steel, components, tools and
gold per player per day; development and storage upgrades consume gold, wood, stone, timber and steel.
```

Marks: SOURCE = an extraction/growing profession; INTERMEDIATE = made from a source; CONSUMABLE = eaten or
worn out; CAPITAL GOOD = an input to further production or to a durable sink; SINK = consumes goods (and
gold) without producing.

## Marked as implemented / model / future

- **Implemented today**: farming, fishing, mining, forestry, land, the levelling curve.
- **Model only** (this document): physical island profiles, development costs, workplace slots, storage
  upgrades, livestock conversion, processing recipes, the player market, the NPC safety net, the
  logistics/military sinks.
- **Future** (named, not built): livestock gameplay, processing buildings, NPC worker hiring, the
  warehouse build, the order-book market, ships/army/naval PvE, regions and world expansion.

## Locked design decisions (V16.1)

1. Element belongs to the Home Island; no ordinary respec.
2. Specialisation is a comparative advantage, never a profession lock.
3. Physical capacity first; numeric efficiency second (0.90x-1.15x).
4. There is no hard daily extraction cap - ceilings come from deposits, regeneration, land, lanes,
   labour, storage and inputs.
5. The Home Island has a finite practical ceiling.
6. Upgrades cost more the further you go and consume several resources.
7. The market becomes useful through scale, not a day-one requirement.
8. Fire starts with livestock, then develops refining/manufacturing.
9. Fire must import raw resources at industrial scale.
10. The NPC shop is a limited safety net, never a wholesaler.
11. Workers consume economic inputs (staples, protein, gold, housing, tools later).
12. Workers cannot create physical capacity.

## What is still recommendation only

- The exact ceilings, starter fractions and development costs are model values to be calibrated again
  once the Warehouse, Livestock, Processing and Market are implemented.
- Whether hardwood/resin should have a Fire process channel (today they are logistics-only).
- Region and logistics economics: the simulator assumes one clearing market; a future world economy
  should make distance matter.
