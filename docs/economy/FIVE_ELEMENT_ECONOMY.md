# The five-element economy (proposed, modelled)

Status: **V16.1, proposed and modelled - not implemented.** No gameplay reads this. The numbers live in
`packages/economy-sim/src/elements.ts` and are tested there. The full capacity model - physical profiles,
starter vs maximum capacity, development costs, workplace slots and the storage curve - is in
`docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md`.

## The idea

Future Home Islands carry one of five element identities. The element is a **comparative advantage**, not
a profession lock: every island can farm, fish, mine, forest, keep animals and run a workshop. Where
V16.0 described the difference as a bare multiplier (0.6x-1.9x), V16.1 describes it as **physical
capacity first**: how many tiles, spots, deposits, trees, pens and lanes the island's geography can ever
hold, with a small efficiency modifier (0.90x-1.15x) on top. The element belongs to the Home Island, not
the player, and there is no ordinary respec.

| Element | Identity | Physical advantage | What it ends up buying |
| --- | --- | --- | --- |
| **Earth** | Agriculture | The widest fields (160 tiles) and the most feed | Protein (fish, meat), metals, tools |
| **Water** | Fishing and maritime | The longest coastline (12 spots) | Timber, metals, machinery, farm supplies |
| **Wood** | Forestry | The most forest (20 nodes) | Food, protein, metal tools, industrial goods |
| **Metal** | Extraction | The most deposits (18 nodes) | Food, protein, timber, tools |
| **Fire** | Livestock and industry | The best pens (20) and the most lanes (14) | Ore, coal, wood, feed, fish/protein |

An island does not begin at its ceiling: each profession starts at a fraction of it and develops in five
steps, with a cost curve that rises per unit at every step. That is what turns "one island supports an
endgame economy" from a modelling gap (the V16.0 ceiling never bound) into a calibrated question.

## Fire's two identities

Fire has the livestock profession *and* the processing advantage, and it must not become self-sufficient:

- livestock produces meat and eggs but eats staples, so it depends on Earth's grain and potatoes;
- steel consumes iron ore and coal, so it depends on Metal's extraction;
- timber consumes wood, and tools consume steel and timber, so industry depends on Wood as well;
- a Fire island can therefore refine and manufacture, but it cannot feed the process from its own ground.

The simulated progression, from `docs/economy/ECONOMY_SIMULATION.md`:

| Fire stage | Self-sufficiency index | Iron ore | Coal | Feed | Fish/protein | Wood |
| --- | --- | --- | --- | --- | --- | --- |
| Early | 91% | 50% | 0% | 23% | 18% | 0% |
| Developing | 83% | 71% | 2% | 34% | 18% | 0% |
| Mid | 75% | 86% | 37% | 26% | 15% | 7% |
| Industrial | 65% | 91% | 61% | 34% | 15% | 14% |

Fire starts as a pen economy and becomes a buyer of ore, coal, feed and protein as its workshops grow.

## Food is not one resource

The model separates **staples and vegetables** (potato, wheat, corn, cabbage, pumpkin, tomato,
strawberry) from **protein** (fish, meat, eggs). Workers eat both; livestock eat staples; the provisions
recipe eats fish and potato. That is what stops the cheapest crop from satisfying every requirement in
the game, and it is why an Earth island cannot feed an army without a Water or Fire partner.

## What is deliberately not decided

- The exact ceilings, starter fractions and development costs (calibrated again once the future systems
  are implemented).
- Whether hardwood and resin should feed a Fire process recipe instead of only the logistic sink.
- Region and logistics economics - the simulator assumes one clearing market today.
