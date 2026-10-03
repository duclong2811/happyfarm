# The five-element economy (proposed, modelled)

Status: **proposed and modelled, not implemented.** No gameplay reads this. The numbers live in
`packages/economy-sim/src/elements.ts` and are tested there.

## The idea

Future Home Islands carry one of five element identities. The element is a **comparative advantage**, not
a profession lock: every island can farm, fish, mine, forest, keep animals and run a workshop. The
differences are *capacity* multipliers on one shared island baseline, each between 0.6 and 1.9 on
purpose - geography and logistics should create specialisation pressure, not a stat buff.

| Element | Identity | Strongest at | Weakest at |
| --- | --- | --- | --- |
| **Earth** | Agriculture | Crops, feed, provisions | Fishing, mining |
| **Water** | Fishing and maritime | Coastline, aquaculture, harbour, fleets | Land expansion, raw terrestrial goods |
| **Wood** | Forestry | Timber, hardwood, resin, ships | Ore, fish |
| **Metal** | Extraction | Ore and stone capacity | Farming, livestock |
| **Fire** | Livestock and industry | Eggs, milk, meat, hide; refining and manufacture | Every raw extraction profession |

The capacity table (`ELEMENT_PROFILES`) applies those multipliers to the *current island's own counts*
(144 tiles, 4 fishing spots, 9 deposits, 12 wild trees, plus modelled pens and processing lanes), which
is what makes Scenario B - the same world seen as five different elements - directly comparable to
Scenario A.

## Fire's two identities

Fire has the livestock profession *and* the processing advantage, and it must not become self-sufficient:

- livestock produces meat and eggs but eats staples, so it depends on Earth's grain and potatoes;
- steel consumes iron ore and coal, so it depends on Metal's extraction;
- timber consumes wood, and tools consume steel and timber, so industry depends on Wood as well;
- a Fire island can therefore refine and manufacture, but it cannot *feed* the process from its own
  ground, which is the dependency the simulator measures as achieved self-sufficiency.

The element table enforces the structural half of that promise directly (Fire is the best processor and
is below the best at every raw profession), and `report.ts` reports it as the `FIRE_DOMINANCE` check.

## Food is not one resource

The model separates **staples** (potato, wheat, corn, cabbage, pumpkin) from **protein** (fish, meat,
eggs). Workers eat both; livestock eat staples; a future voyage eats provisions. That is what stops the
cheapest crop from satisfying every requirement in the game, and it is why an Earth island cannot feed an
army without a Water or Fire partner.

## What is deliberately not decided

- The exact multipliers, which the simulator now shows are **too mild to create real trade pressure**
  (see `ECONOMY_SIMULATION.md`: elements still run at 99-100% self-sufficiency).
- Whether the element is a property of the island at creation, of the player, or both.
- Whether an island can change element, and at what cost.
