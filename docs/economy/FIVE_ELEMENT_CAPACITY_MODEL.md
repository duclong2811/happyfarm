# The five-resource capacity & progression model

Status: **V16.1.1, proposed and modelled - not implemented.** No gameplay reads this. The numbers live in
`packages/economy-sim/src/elements.ts` and `model.ts`; the tables below are printed by the simulator.

This document answers the question V16.0 could not:

> At what point, and for what economic reason, does a player begin to benefit from - or depend on -
> other players, trade, logistics, or world expansion?

## The model in three rules

1. **One resource profession per element.** Earth agriculture, Water fishing, Wood forestry, Metal
   mining, Fire livestock. Comparative advantages, never locks; every island may run all five.
2. **Processing is shared.** Workshop capacity is element-neutral - the same ceiling, the same
   investment track, no efficiency bonus for anyone.
3. **Geography first, numbers second.** Physical capacity differentiates the elements; the efficiency
   modifier is a small second (0.90x-1.15x).

## Five resource ceilings (physical maximum)

| Element | Farm tiles | Fishing spots | Mining nodes | Forestry nodes | Pens |
| --- | --- | --- | --- | --- | --- |
| Earth | 160 | 4 | 6 | 10 | 8 |
| Water | 80 | 12 | 5 | 9 | 9 |
| Wood | 100 | 6 | 7 | 20 | 9 |
| Metal | 80 | 5 | 18 | 10 | 8 |
| Fire | 72 | 5 | 6 | 12 | 20 |

Each element holds the highest ceiling in exactly one resource profession (tested). **Workshop lanes are
12 for every element** (starter 1) - the shared industrial track.

## Starter capacity vs maximum

| Element | Farm | Fish | Mine | Forest | Pens |
| --- | --- | --- | --- | --- | --- |
| Earth | 56 | 1 | 1 | 2 | 2 |
| Water | 20 | 5 | 1 | 2 | 2 |
| Wood | 25 | 2 | 1 | 6 | 2 |
| Metal | 20 | 2 | 5 | 2 | 2 |
| Fire | 18 | 2 | 1 | 2 | 7 |

Developed capacity interpolates between starter and ceiling in five steps and can never exceed the
ceiling. At the Industrial stage (three of five resource steps, five of five industrial steps):

| Element | Farm | Fish | Mine | Forest | Pens | Lanes |
| --- | --- | --- | --- | --- | --- | --- |
| Earth | 118 | 2 | 3 | 5 | 4 | 12 |
| Water | 44 | 9 | 3 | 5 | 5 | 12 |
| Wood | 55 | 4 | 3 | 14 | 5 | 12 |
| Metal | 44 | 3 | 13 | 5 | 4 | 12 |
| Fire | 40 | 3 | 3 | 6 | 15 | 12 |

## The development cost curve

The cost of a step is defined **relative to the output it adds**: step *n* costs `paybackDaysByStep[n]`
days of that step's added output, in gold-equivalent terms. A farm tile adds little value, so a farm
upgrade is cheap; a mine node adds a lot, so a mine upgrade is expensive. That keeps payback comparable
across professions and lets the late steps become genuinely slow.

The cost is paid half in gold, a quarter in wood/stone, and - from step three - a quarter in industrial
goods (timber, steel, tools, provisions), so late development pulls on every other profession.

| Step | Target payback | Band |
| --- | --- | --- |
| 1 | 2 days | Early |
| 2 | 5 days | Developing |
| 3 | 12 days | Mid |
| 4 | 30 days | Industrial |
| 5 | 70 days | Near-max |

`CAPACITY_PAYBACK_DAYS` is reported per element and tier; `MARGINAL_CAPACITY_COST` is the gold-equivalent
cost of the next +1 unit. Both are strictly increasing.

`MARGINAL_CAPACITY_COST` for the primary resource profession, by step (gold-equivalent per +1 unit):

| Element | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 |
| --- | --- | --- | --- | --- | --- |
| Earth (tiles) | 40 | 100 | 240 | 600 | 1,400 |
| Water (spots) | 1,704 | 4,260 | 10,224 | 25,560 | 59,640 |
| Wood (nodes) | 2,700 | 6,750 | 16,200 | 40,500 | 94,500 |
| Metal (nodes) | 2,807 | 7,017 | 16,841 | 42,103 | 98,240 |
| Fire (pens) | 54 | 134 | 321 | 803 | 1,873 |

The absolute cost differs by profession because a fishing spot or a mine node adds far more daily value
than a farm tile or a pen; the **payback** is the comparable figure and is 2/5/12/30/70 days for every
element.

## Upgrade vs import crossover

Comparing **A. develop another unit** against **B. import the equivalent sustainable output**:

| Stage | Payback of the next step | Verdict |
| --- | --- | --- |
| Early | 2 days | Home development ≫ import |
| Developing | 5 days | Home development > import |
| Mid | 12 days | Home development ≈ import for some inputs |
| Industrial | 30 days | Import ≈ development at the margin |
| Near-max | 70 days | Import > extreme vertical development |

Against a 30-day horizon, importing beats a near-max upgrade on every element (payback 70 > 30). This is
the crossover V16.1 lacked: its near-max upgrade paid back in ~1.5 days, so vertical development always
won. It now wins early and loses late, exactly as the brief requires.

## Workers work capacity; they never create it

A worker raises the *utilisation* of developed capacity, up to the workplace slots that capacity
supports and never past it. The engine caps player actions and worker actions against the same developed
capacity; tests assert no element's utilisation or workplace fill can exceed 1. Slots per developed unit:
farming 1/6, fishing 1, mining 1/2, forestry 1/3, livestock 1/2, processing 2.

## Storage

Starter storage ~40,000 units per resource per island (about a month of a starter island's output), ×2 on
each upgrade, costing gold, wood, stone and later timber. In the balanced industrial scenario it first
reaches 50% on day 6, first reaches 80% on day 9, and buys its first upgrade at that milestone (day 10);
over a 90/180-day horizon it first fills on day 46 and is constrained for 50%/75% of days. Storage is an
investment decision, not day-one tetris.

## The five resource flows and the shared economy

```text
EARTH  (crops, vegetables, feed)  ─┐
WATER  (fish, seafood, protein)   ─┤
WOOD   (wood, hardwood, resin)    ─┼─> SHARED PROCESSING / MANUFACTURING ─> PRODUCTS / SINKS
METAL  (stone, coal, copper, iron)─┤
FIRE   (eggs, milk, meat, hide,   ─┘
        wool)

Shared recipes (no element owns them):
  iron ore + coal            -> steel
  wood                       -> timber
  copper ore + coal          -> components
  steel + timber + hardwood  -> tools
  steel + copper + timber + resin -> machinery
  fish + potato              -> provisions
  hide + resin               -> leather
  wool                       -> textiles

SINKS: logistics and military consume provisions, timber, resin, hardwood, steel, components, tools,
machinery and leather; development and storage upgrades consume gold, wood, stone, timber, steel, tools
and provisions.
```

Dark hardwood and resin now leave the island through **tools**, **machinery** and **leather**, not only
through the logistic sink.

## Resource producer vs demand sector matrix

Resources (rows) and the demand sectors that buy them:

| Resource | Processors | Workers (food) | Ships/logistics | Construction | Military |
| --- | --- | --- | --- | --- | --- |
| Earth: crops/veg/feed | provisions, food | staples + vegetables | provisions | - | provisions |
| Water: fish/protein | provisions | protein | provisions | - | provisions |
| Wood: wood/hardwood/resin | timber, tools, machinery | - | timber, resin, hardwood | timber | hardwood, resin |
| Metal: stone/coal/copper/iron | steel, components, machinery | - | steel | stone | steel, components |
| Fire: eggs/milk/meat/hide/wool | leather, textiles, provisions | protein | provisions | - | leather |

Every resource is demanded by at least one sector; every sector buys from at least two resources.

## Locked design decisions (V16.1.1)

1. The canonical mapping is **Earth agriculture, Water fishing, Wood forestry, Metal mining, Fire
   livestock**.
2. Processing / refining / crafting / manufacturing are **shared systems**; no element receives a
   throughput or efficiency bonus.
3. Physical resource capacity is the primary differentiation.
4. Element belongs to the Home Island; no ordinary respec.
5. Specialisation is a comparative advantage, never a profession lock.
6. There is no hard daily extraction cap.
7. The Home Island has a finite practical ceiling; upgrades get more expensive per unit and eventually
   lose to importing.
8. Workers consume economic inputs and cannot create physical capacity.
9. The NPC shop is a limited safety net.

## What is still recommendation only

- The exact ceilings, starter fractions and the payback curve (calibrated again once the systems are
  implemented).
- Per-animal livestock recipes (the model uses one representative pen).
- Region and logistics economics; the simulator assumes one clearing market.
