# The economy simulator

Status: V16.1. A design tool, never a runtime dependency: `apps/` and `workers/` may not import it, and
`tests/economy-sim/isolation.test.ts` walks the production trees to prove they do not.

## Why it exists

HappyFarm now has four income systems (farming, fishing, mining, forestry), an ascending level curve, and
no sinks. Guessing the next price would have been easy and wrong. The simulator exists so a structural
question - "does Fire end up self-sufficient?", "do workers compound?", "does storage make trading
attractive?", "does the Home Island ceiling ever bind?" - has a number attached before anything is built.

V16.0 exposed the structure and found it broken: capacity was a multiplier on one shared baseline, so the
ceiling never bound and no element needed a neighbour. V16.1 rebuilt the model around physical island
capacity (see `FIVE_ELEMENT_CAPACITY_MODEL.md`) and re-ran everything.

## Architecture

```text
packages/economy-sim/src
  baseline.ts   the implemented economy, read from @happy-farm/game-data
  elements.ts   the five physical island profiles: starter, ceiling, efficiency
  model.ts      every modelled constant: stages, development, storage, workers,
                recipes, market, NPC shop, sinks, livestock
  scenario.ts   scenarios A-O, plus the five mandated population mixes, as data
  simulate.ts   the deterministic day-step engine
  metrics.ts    the metric shapes
  report.ts     the structural checks and the readable report
```

Five rules keep it honest:

1. **Balance constants live in `model.ts`/`elements.ts`**, never in the engine.
2. **The baseline is read, not retyped**, so a price change in the game changes the next simulation.
3. **Cohorts, not actors.** Players are grouped by (element x archetype), so 10,000 players cost the same
   as one and a 90-day run finishes in ~0.4 s (measured by the performance test).
4. **A day is the step**, because every modelled rate is a rate per day.
5. **No randomness at all.** The same scenario always produces the same numbers.

### What the engine models in a day

```text
developed capacity (starter -> ceiling)       <- element + stage
-> player actions and worker actions          <- both capped by the same developed capacity
-> gather production (crop/fish/ore/wood mix) <- not one "best" item per profession
-> worker food + wages                        <- staples AND protein, gold upkeep
-> facility demand (feed, recipe inputs)      <- livestock and processing want, not just take
-> consume local stock; the shortfall is need  <- the import-dependency denominator
-> player market clears need against surplus  <- conserving goods and gold; the fee is the only sink
-> NPC safety net fills what is left          <- capped and marked up
-> pens and workshops run on what it secured  <- feed in, animal products out; raw in, goods out
-> sink demand and storage overflow            <- logistics/military; upgrades at the 80% milestone
```

## Metrics

V16.0's metrics are preserved (gold created/destroyed/net, market volume, fees, scarcity, storage fill,
ceiling utilisation, NPC productivity, per-element self-sufficiency, per-item tables). V16.1 adds:

| Metric | Meaning |
| --- | --- |
| `IMPORT_DEPENDENCY_RATIO` | External supply required over total demand, per element and resource |
| `SELF_SUFFICIENCY_INDEX` | Value-weighted share of an element's demand met by its own ground |
| `PHYSICAL_MAX_CAPACITY` / `DEVELOPED_CAPACITY` | The ceiling and where the island stands against it |
| `HOME_CAPACITY_UTILIZATION` | Worked share of each developed profession |
| `MARGINAL_CAPACITY_COST` | Gold-equivalent cost of the next +1 unit of primary capacity |
| `WORKPLACE_UTILIZATION` / `WORKER_PRODUCTIVITY` | Workers used over slots; output over possible |
| `PHYSICAL_` / `EFFICIENCY_` / `TOTAL_SPECIALIZATION_ADVANTAGE` | The advantage, split into its causes |
| `STORAGE_50/80/FULL`, `STORAGE_CONSTRAINED_PERCENT`, `LOST_OUTPUT_TO_STORAGE` | When storage bites, and what it costs |
| `NPC_SHOP_SHARE_OF_INPUT`, `MARKET_SHARE_OF_INPUT` | Where bought inputs actually came from |
| Gold created / destroyed / **transferred** | Separated, so a faucet is never confused with a trade |

## Scenarios

| Id | Question | Stage | Population |
| --- | --- | --- | --- |
| A | Starter island, no player trade, no workers | Early | 1 Earth, normal |
| B | Early progression on self-production + NPC shop | Early | 100, realistic |
| C | Developing island with a small player market | Developing | 100, realistic |
| D | Mid game with the first workers | Mid | 200, realistic |
| E | Mature specialised Home Island | Industrial | 500, balanced |
| F | Fire industrialisation | Industrial | 200, all Fire |
| G | Metal extraction specialisation | Industrial | 200, all Metal |
| H | Water maritime specialisation | Industrial | 200, all Water |
| I | Wood forestry specialisation | Industrial | 200, all Wood |
| J | Earth agricultural specialisation | Industrial | 200, all Earth |
| K | Self-sufficient player (market off) | Industrial | 1 automated Earth |
| L | Specialised trader (market on) | Industrial | 1 automated Fire |
| M | Worker-heavy economy | Industrial | 300, worker-heavy |
| N | Population imbalance (Water/Fire heavy) | Industrial | 500, water-heavy |
| O | Mature economy with ships/army/naval sinks | World | 1,000, 60 days |
| P-S | Fire-heavy / Metal-shortage / Wood-shortage / Earth-shortage mixes | Industrial | 500 each |

## What the simulation found (V16.1)

Reproducible with `npx vitest run tests/economy-sim`. These are findings, not balance decisions.

1. **The selection problem is answered by geography, not by a buff.** Fire's raw import dependency rises
   with its industry: iron ore 50% -> 71% -> 86% -> 91%, coal 0% -> 2% -> 37% -> 61%, feed 23% -> 34%,
   fish/protein 18% -> 15%, and its self-sufficiency index falls 91% -> 83% -> 75% -> 65% from Early to
   Industrial. Fire is no longer 99-100% self-sufficient.
2. **Specialisation is a real but not runaway advantage.** In the mature balanced scenarios the strongest
   element produces ~40% more value per player than the average (target band 20-40%); the worker-heavy
   scenario is ~33% and the early mid-game ~23%. The V16.0 +177% is gone.
3. **Workers cannot conjure capacity.** Utilisation and workplace fill stay `<= 1` in every scenario, and
   the worker-heavy population only raises utilisation (6.5% island-wide) - it does not multiply output
   past the developed ceiling.
4. **The ceiling still rarely binds for a typical island, and that is now an honest finding.** A realistic
   mature island runs at ~1.5-2% of its developed capacity because labour, not land, is the binding
   constraint; the automated single island reaches 34.8% and the worker-heavy population 6.5%. Land only
   binds when a player hires heavily - which is exactly the point at which the brief says expansion and
   trade should win.
5. **Storage is no longer day-one pressure.** In the balanced scenario it first reaches 50% on day 9
   (Early) / day 6 (Industrial), first reaches 80% a few days later, and the first upgrade is bought at
   that milestone (day 14 Early, day 9-10 Industrial). An upgraded warehouse never fills in a 30-day run,
   so the decision is an investment, not tetris.
6. **Every element buys something.** Mature Earth imports iron ore (48%); Water iron ore (68%) and coal;
   Wood iron (82%), coal (51%) and copper (44%); Metal fish/protein (66%) and steel (31%); Fire iron
   (91%), protein (61%), coal (60%), copper (58%), feed (34%).
7. **Gold is still inflationary early and closer to structural balance late.** With no sinks, the early
   scenario creates ~34,900 gold/day and destroys ~950; at Industrial the market, wages, NPC purchases
   and (at World) the military/naval sinks destroy a large share. Gold created, destroyed and transferred
   are now reported separately, so the remaining gap is visible rather than hidden in a net figure.

## What the model cannot answer yet

- **Ship and naval payback**: the sinks are modelled as consumption; there is no ship to buy.
- **Tool and machine payback**: equipment has no buy price in the model.
- **Regional logistics**: the market clears instantly everywhere; a future world economy should make
  distance matter, and the docs say so rather than pretending the model covers it.
- **Element respec / island transformation**: deliberately out of scope; it would be a future world-scale
  project.
