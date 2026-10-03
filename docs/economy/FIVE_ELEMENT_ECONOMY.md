# The five-element economy (proposed, modelled)

Status: **V16.1.1, proposed and modelled - not implemented.** No gameplay reads this. The numbers live in
`packages/economy-sim/src/elements.ts` and `model.ts`, and the tables below are printed by the simulator.
The full capacity model is `docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md`.

## The canonical mapping (locked)

The five elements are **five primary resource specialisations**, and nothing else:

| Element | Primary resource profession |
| --- | --- |
| **Earth / Thổ** | Agriculture |
| **Water / Thủy** | Fishing / Aquaculture |
| **Wood / Mộc** | Forestry |
| **Metal / Kim** | Mining |
| **Fire / Hỏa** | Livestock / Animal Husbandry |

Every island may still run every resource profession. These are comparative advantages, not locks.

**V16.1.1 removed the old rule.** In V16.0/V16.1 Fire was modelled as the refining/manufacturing
specialist, with the largest workshop capacity and a processing efficiency bonus. That is gone. Fire is
now a livestock specialist, and it holds no industrial advantage of any kind.

## Processing is a shared system, not an element

Value-added activity is a **horizontal layer** available to every island:

```text
LAYER A - RESOURCE SPECIALISATION        LAYER B - SHARED VALUE-ADDED ACTIVITY
Earth -> agriculture                     processing / refining / crafting / cooking
Water -> fishing / aquaculture           manufacturing / trading / shipping / building
Wood  -> forestry                        military supply
Metal -> mining
Fire  -> livestock
```

Layer B has no element multiplier and no element ceiling: every island develops the same workshop lanes
through the same investment track. Where a player ends up - raw exporter, steel manufacturer, shipyard
operator, merchant - is a business decision driven by capital, buildings, workers, storage, inputs and
market conditions, not by the island's element.

## Five resource ceilings

| Element | Starter (F/Fi/M/Fo/P) | Ceiling (F/Fi/M/Fo/P) | Primary advantage |
| --- | --- | --- | --- |
| Earth | 56/1/1/2/2 | **160**/4/6/10/8 | Agriculture |
| Water | 20/5/1/2/2 | 80/**12**/5/9/9 | Fishing |
| Wood | 25/2/1/6/2 | 100/6/7/**20**/9 | Forestry |
| Metal | 20/2/5/2/2 | 80/5/**18**/10/8 | Mining |
| Fire | 18/2/1/2/7 | 72/5/6/12/**20** | Livestock |

Workshop lanes are **12 for every element** (starter 1). The efficiency modifier (0.90x-1.15x) applies
only to the resource professions.

## Fire's identity: livestock

Fire now stands on animal husbandry alone:

- pens eat agricultural feed, so Fire depends on Earth;
- one pen yields a mix of **eggs, milk, meat, hide and wool**;
- hide and wool feed shared leather and textile recipes; eggs, milk and meat feed worker protein and
  provisions;
- a Fire island can build and run workshops like anyone else, but it earns its comparative advantage
  from pens, not factories.

The resulting trade relationship is Earth -> Fire feed, and Fire -> everyone animal products.

## Hardwood and resin now have demand

V16.1 left hardwood and resin almost without a demand channel. V16.1.1 gives them shared (never
Fire-exclusive) recipes:

- **hardwood** is a required input to **tools** (steel + timber + hardwood);
- **resin** is a required input to **machinery** (steel + copper + timber + resin) and to **leather**
  (hide + resin).

## Shared processing chains

| Recipe | Inputs | Output |
| --- | --- | --- |
| Steel | iron ore 2 + coal 1 | steel |
| Timber | wood 3 | timber |
| Components | copper ore 2 + coal 1 | components |
| Tools | steel 1 + timber 1 + hardwood 1 | tools |
| Machinery | steel 2 + copper 1 + timber 1 + resin 1 | machinery |
| Provisions | snapper 2 + potato 2 | provisions |
| Leather | hide 2 + resin 1 | leather |
| Textiles | wool 2 | textiles |

None of these belongs to an element.

## What is deliberately not decided

- The exact ceilings, starter fractions and development costs (calibrated again once the systems exist).
- The exact animals and per-animal recipes (the model uses one representative pen).
- Region and logistics economics - the simulator assumes one clearing market today.
