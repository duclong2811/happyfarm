# V13: the economy foundation

Status: baseline of record for prices, yields, capacities and timings. Change a number here before
changing it in game data.

## Goals

V13 needs numbers that are *consistent* rather than perfectly balanced: one unit of value that build
costs, yields and capacities can all be compared in, a payback story for anything productive, and
nothing that claims to be running before it runs.

## The unit

**EVU - Early-game Value Unit.** One EVU is what a starter carrot cycle is worth once harvested: a
carrot cycle is five minutes and yields roughly two carrots worth about six gold each, so
**1 EVU ~ 12 gold of produce**. Nothing in the game prints EVU; it exists so the tables below can be
read against one another, and so the next balance pass has a consistent yardstick.

## Resources

`GOLD`, `FOOD`, `WOOD`, `STONE`. Fish is `FOOD` for now: a separate commodity would need a system to
spend it, and inventing one is out of scope. Resources are carried as ids rather than a column per
resource, so adding one later is data rather than schema.

## Prices and payback

Payback is `constructionCost / netValuePerCycle`, where
`netValuePerCycle = outputValue - recurringInputCost`.

| Class | Intended payback | Reasoning |
| --- | --- | --- |
| Basic production | 3-6 cycles | the player should see the asset earn its keep within a session |
| Better infrastructure | 5-10 cycles | convenience compounds, so it may cost more per unit |
| Automation | longer | saved attention is itself the product |
| Storage | not a payback question | capacity buys freedom from a limit, not income |

Timing follows the same intent: common manual production 5-15 minutes, medium 15-40, trees longer.

## The shipped numbers

**Roads**, priced per four-cell segment (one unambiguous basis, quoted in the shop inspector as
`Cost`):

| Tier | Price | Ratio to dirt | Movement (planned) |
| --- | --- | --- | --- |
| Dirt T1 | 100 | 1.0x | +12% |
| Gravel T2 | 250 | 2.5x | +20% |
| Stone T3 | 500 | 5.0x | +30% |
| Paved T4 | 900 | 9.0x | +40% |

The brief's ladder was dirt 1.0, gravel 2-3, stone about 5, paved 7-10; the shipped prices sit inside
it and a test enforces monotonicity and the stone-to-dirt ratio. Roads are `PREVIEW_ONLY`, so the
movement column is a plan the shop labels as such.

**Storage** (`FOUNDATION_ONLY`: capacity is defined and shown, nothing enforces it yet):

| Asset | Capacity | Price | Gold per capacity |
| --- | --- | --- | --- |
| Barn I | 250 wood / 150 food / 100 stone | 900 | 0.9 per unit |
| Barn II | 600 / 360 / 240 | 2,200 | 0.55 per unit |
| Barn III | 1,400 / 840 / 560 | 4,800 | 0.32 per unit |
| Open Barn | 400 / 240 / 160 | 1,400 | 0.7 per unit |
| Grain Silo | 900 food | 1,800 | 2.0 per food |
| Silo House | 1,200 food + 200 wood | 3,200 | about 2.3 per food |

Upgrading is meaningfully cheaper per unit than building another first-tier barn, which is what stops
the island from becoming a field of Barn Is.

**Production** (`FOUNDATION_ONLY`: the metadata exists, the cycle does not run yet):

| Asset | Output | Cycle | Input |
| --- | --- | --- | --- |
| Chicken Coop | +6 FOOD | 15 min, repeats | 2 FOOD |
| Windmill | +12 FOOD | 10 min, repeats | 4 FOOD |

## Starter economy

100 gold and 10 carrot seeds, one harvest per cycle, carrots five minutes - the loop the game already
runs. V13 adds nothing to it and takes nothing away from it.

## Deferred

Land expansion pricing, worker wages, processing chains beyond the windmill, aquaculture, mining and
livestock economics are all still open. They are marked here rather than guessed at in game data.
