# The economy simulator

Status: V16.1.1. A design tool, never a runtime dependency: `apps/` and `workers/` may not import it, and
`tests/economy-sim/isolation.test.ts` walks the production trees to prove they do not.

## Why it exists

HappyFarm has four income systems (farming, fishing, mining, forestry), an ascending level curve, and no
sinks. The simulator exists so a structural question - "does Fire end up self-sufficient?", "do workers
compound?", "does the Home Island ceiling ever bind?", "at what point does importing beat another
upgrade?" - has a number attached before anything is built.

V16.1.1 is the final model calibration before production work. It simplifies the economy to **five
resource specialisations** (Earth agriculture, Water fishing, Wood forestry, Metal mining, Fire
livestock), moves all value-added activity to a **shared, element-neutral industrial track**, and
recalibrates the development cost curve so late upgrades stop paying back in a day.

## Architecture

```text
packages/economy-sim/src
  baseline.ts   the implemented economy, read from @happy-farm/game-data
  elements.ts   the five physical resource profiles + the shared industrial track
  model.ts      every modelled constant: stages, development, storage, workers,
                recipes, market, NPC shop, sinks, livestock
  scenario.ts   scenarios A-Y, as data
  simulate.ts   the deterministic day-step engine
  metrics.ts    the metric shapes
  report.ts     the structural checks and the readable report
```

Five rules keep it honest:

1. **Balance constants live in `model.ts`/`elements.ts`**, never in the engine.
2. **The baseline is read, not retyped.**
3. **Cohorts, not actors.** Players are grouped by (element × archetype); 10,000 players cost the same
   as one.
4. **A day is the step.**
5. **No randomness at all.**

### Two layers

```text
LAYER A - RESOURCE SPECIALISATION   Earth/Water/Wood/Metal/Fire resource professions
LAYER B - SHARED VALUE-ADDED         processing, crafting, manufacturing, shipping, building
```

Layer B is element-neutral by construction: the workshop ceiling is the same for every element (12
lanes), there is no processing efficiency modifier, and the engine-agnostic **INDUSTRIALIST** archetype
runs the same workspace on any island.

### What the engine models in a day

```text
developed capacity (starter -> ceiling)       <- element for resources; neutral for workshops
-> player actions and worker actions          <- both capped by the same developed capacity
-> gather production (crop/fish/ore/wood mix)
-> worker food + wages
-> facility demand (feed, recipe inputs)      <- livestock and processing want, not just take
-> consume local stock; the shortfall is need  <- the import-dependency denominator
-> player market clears need against surplus  <- conserving goods and gold; the fee is the only sink
-> NPC safety net fills what is left
-> pens and workshops run on what it secured
-> sink demand and storage overflow
```

## Metrics

V16.0/V16.1 metrics are preserved. V16.1.1 adds or keeps:

| Metric | Meaning |
| --- | --- |
| `IMPORT_DEPENDENCY_RATIO` | External supply required over total demand, per element and resource |
| `SELF_SUFFICIENCY_INDEX` | Value-weighted share of demand met by the island's own production |
| `RAW_RESOURCE_SPECIALIZATION_ADVANTAGE` | The element's primary resource ceiling over the five-element average |
| `PHYSICAL_` / `EFFICIENCY_` / `TOTAL_SPECIALIZATION_ADVANTAGE` | The advantage, split into its causes |
| `HOME_CAPACITY_UTILIZATION` / `WORKPLACE_UTILIZATION` | Worked share of capacity / of worker slots |
| `MARGINAL_CAPACITY_COST` | Gold-equivalent cost of the next +1 unit |
| `CAPACITY_PAYBACK_DAYS` | Days of added output that repay each development step |
| `UPGRADE_VS_IMPORT_RATIO` | Payback of the next step against a 30-day import horizon (>1 = import) |
| `PROCESSING_MARGIN` | Value of processed output over value of processed input |
| `STORAGE_50/80/FULL`, `STORAGE_CONSTRAINED_PERCENT`, `LOST_OUTPUT_TO_STORAGE` | Storage pressure |
| `NPC_SHOP_SHARE_OF_INPUT`, `MARKET_SHARE_OF_INPUT` | Where bought inputs came from |
| Gold created / destroyed / **transferred** | Separated |

## Scenarios

| Id | Scenario | Stage | Population |
| --- | --- | --- | --- |
| A | Starter island, no trade, no workers | Early | 1 Earth, normal |
| B | Early progression with the NPC safety net | Early | 100, realistic |
| C | Developing island with a small market | Developing | 100, realistic |
| D | Mid game with the first workers | Mid | 200, realistic |
| E | Mature specialised Home Island | Industrial | 500, balanced |
| F | Fire livestock specialisation | Industrial | 200, all Fire |
| G-J | Metal / Water / Wood / Earth specialists | Industrial | 200 each |
| K | Self-sufficient player (market off) | Industrial | 1 automated Earth |
| L | Specialised trader (market on) | Industrial | 1 automated Fire |
| M | Worker-heavy economy | Industrial | 300, worker-heavy |
| N | Population imbalance (Water/Fire heavy) | Industrial | 500, water-heavy |
| O | Mature economy with ships/army/naval sinks | World | 1,000, 60 days |
| P-S | Fire-heavy / Metal-shortage / Wood-shortage / Earth-shortage | Industrial | 500 each |
| T | Resource producer selling raw materials | Industrial | 200, all Metal, no workshops |
| U | Generic processor buying raw materials | Industrial | 250, all industrialist |
| V | Vertically integrated producer | Industrial | 400, half industrialist |
| W | Water shortage | Industrial | 500, water-shortage |
| X | Fire / livestock shortage | Industrial | 500, fire-shortage |
| Y | Ten-thousand-player balanced economy | World | 10,000, 90 days |

The balanced scenario is also run over 30, 90 and 180 days for the storage analysis.

## What the simulation found (V16.1.1)

Reproducible with `npx vitest run tests/economy-sim`.

1. **Fire has no industrial advantage.** Workshop lanes are 12 for every element and the processing
   efficiency modifier is 1.0 everywhere (`PROCESSING_NEUTRALITY` is HEALTHY). Fire's only ceiling is
   livestock (20 pens vs 8-9 for everyone else).
2. **Every element can run the same industrialist business.** The element-agnostic industrialist produces
   a processing margin of ~1.32-1.39 on all five elements, and no element is the required processor.
3. **Late development no longer dominates.** Payback runs **2 / 5 / 12 / 30 / 70 days** for steps
   1-5. Against a 30-day horizon, importing beats a near-max upgrade on every element - the crossover
   V16.1 lacked (its near-max upgrade paid back in ~1.5 days).
4. **Fire is an animal-products exporter.** Fire's self-sufficiency index is ~66-73% at industrial scale,
   and other elements import Fire's hide and wool heavily (leather/textile demand). Earth supplies feed;
   Fire supplies eggs, milk, meat, hide and wool.
5. **Hardwood and resin have demand.** In the processor scenario, hardwood is consumed (~2,800/day) into
   tools and resin (~3,400/day) into machinery and leather. Wood is no longer only softwood bulk.
6. **Specialisation is meaningful but not dominant.** The strongest element's whole-economy value per
   player is +20% at Mid, +29-38% at Industrial, and +54% at World. The World figure is above the 20-40%
   band, driven by Earth's large food value (see below).
7. **Storage is an investment, not day-one pressure.** First 50% on day 6, first 80% on day 9, first
   upgrade day 10; over 90/180 days it first fills on day 46 and is constrained for 50%/75% of days.
8. **Gold is closer to balance.** At Industrial balanced, created ~281k/day, destroyed ~134k/day and
   transferred ~102k/day; the early game is still inflationary (a known issue until real sinks ship).

## Understanding the World specialisation figure

The World band reports +54% for the strongest element. That is a **whole-economy value** effect driven
by Earth's large agricultural output; the **raw resource** advantages are Earth +63%, Water +88%, Wood
+64%, Metal +114%, Fire +85%. In other words, every element is physically much better at its own
resource - that is the intended specialisation - and the whole-economy spread at Industrial is +29-38%.
The brief says not to auto-nerf Earth crop production, because a future economy will consume large
amounts of food; the figure is reported rather than normalised.

## What the model cannot answer yet

- Ship, tool and machine payback: the sinks are consumption; there is no durable asset to price.
- Regional logistics: the market clears instantly everywhere.
- Per-animal livestock economics: one representative pen stands in for the future animals.
- Element respec / island transformation: deliberately out of scope.
