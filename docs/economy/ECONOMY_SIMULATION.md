# The economy simulator

Status: V16.0. A design tool, never a runtime dependency: `apps/` and `workers/` may not import it, and
`tests/economy-sim/isolation.test.ts` walks the production trees to prove they do not.

## Why it exists

HappyFarm now has four income systems (farming, fishing, mining, forestry), an ascending level curve,
and no sinks. Guessing the next price would have been easy and wrong. The simulator exists so a
structural question - "does Fire end up self-sufficient?", "do workers compound?", "does storage make
trading attractive?" - has a number attached before anything is built.

## Architecture

```text
packages/economy-sim/src
  baseline.ts   the implemented economy, read from @happy-farm/game-data
  elements.ts   the five-element capacity model
  model.ts      every modelled constant: actors, storage, workers, recipes, market, sinks, livestock
  scenario.ts   scenarios A-H, as data
  simulate.ts   the deterministic day-step engine
  metrics.ts    the metric shapes
  report.ts     the structural checks and the readable report
```

Five rules keep it honest:

1. **Balance constants live in `model.ts`**, never in the engine.
2. **The baseline is read, not retyped**, so a price change in the game changes the next simulation.
3. **Cohorts, not actors.** Players are grouped by (element × archetype), so 10,000 players cost the
   same as one and a 90-day run finishes in milliseconds.
4. **A day is the step**, because every modelled rate is a rate per day; a per-second loop would buy no
   accuracy and cost the ability to run the population scenarios in a test.
5. **No randomness at all.** The same scenario always produces the same numbers, which is what makes a
   finding reproducible rather than anecdotal.

## The model in one page

| System | How it is modelled | Where |
| --- | --- | --- |
| Production | actions/day = min(time the archetype has, island capacity) × yield per action | `simulate.ts` |
| Actor archetypes | CASUAL 20 min/day, NORMAL 1 h, HARDCORE 3 h, AUTOMATED 10 min + workers; capacity usage 0.25-0.95 | `model.ts` |
| Storage | a per-resource cap, doubling per tier, built from gold + wood + stone; overflow is wasted | `model.ts`, `simulate.ts` |
| NPC workers | actions/day per worker, gated by housing, fed staples + protein, paid gold, starved into a lower rate | `model.ts` |
| Processing | recipes that consume inputs and produce one output per batch, bounded by lanes | `model.ts` |
| Livestock | pens producing meat and eggs while eating staples | `model.ts` |
| Market | surplus meets deficit at a scarcity-scaled clearing price; the fee is the only thing destroyed | `simulate.ts` |
| NPC shop | a safety net: a daily purchase cap per item and a markup on anything it sells | `model.ts` |
| Sinks | logistics and military consume provisions, timber, resin, steel, tools and gold per player per day | `model.ts` |

## Scenarios

| Id | Question | Features |
| --- | --- | --- |
| A | Today's economy, one normal player, 30 days | described |
| B | Do comparative advantages alone create trade? 100 players | market |
| C | When does storage bite, and does upgrading beat trading? | + storage, upgrades |
| D | Do workers pay for themselves? | + workers |
| E | Does processing + trade beat self-sufficiency? 500 players | + processing, livestock |
| F | Can logistics and military absorb a mature economy? 1,000 players, 90 days | + sinks |
| G | What breaks when the population leans to Water and Fire? 500 players | 40% Water, 30% Fire |
| H | Self-sufficient island against specialised trader | market, all systems |

## What the simulation found

These are the V16.0 results, reproducible with `npx vitest run tests/economy-sim` and printed by
`formatResult`. They are findings, not balance decisions.

1. **Gold inflation is structural today.** Scenario B: 21,511 gold created per day against 1,515
   destroyed - a net of 87% of all creation. Only building, fees, wages and sinks can fix that, and none
   of them exist yet. Expected, and the reason the economy phase exists.
2. **Elements are far too self-sufficient.** Even with trade on, self-sufficiency stays at 99-100% and
   market volume is 0.2% of produced value. The 0.6-1.9 capacity spread is not enough to make an island
   need its neighbours; specialisation is a small advantage (24%) rather than a necessity.
3. **Storage as modelled is far too small.** Pressure arrives on day 1 in every storage scenario,
   because 500 units per resource is nothing next to a working island's output. The first decision is
   therefore "upgrade immediately", not "choose what to keep" - the opposite of the intent.
4. **Automation amplifies specialisation past the target band.** Workers push the strongest element to
   +177% value per player (against the 20-40% target) and productivity stays at 90%, so workers are
   close to a runaway unless housing, food and wages bite harder or the element spread narrows.
5. **Livestock and stone are the first real bottlenecks** once industry is on: eggs and meat run at ~40%
   unmet demand and stone at 25%, because nothing in the model builds more pens or mines more deposits.
6. **Home Island capacity never binds in these scenarios** (0.8-1.3% utilisation). That is a modelling
   gap, not a result: the scenarios do not yet let a player buy many more tiles, spots or deposits, so
   the ceiling the brief cares about is not yet reachable.

## What the model cannot answer yet

- **Time to 25/50/80/100% of Home Island capacity.** The scenarios have no land-purchase or
  deposit-expansion step, so utilisation never approaches 100%. Faking a number would be worse than
  saying so.
- **Ship and naval payback.** The sinks are modelled as consumption; there is no ship to buy, so there is
  no payback period to measure.
- **Tool and machine payback.** Equipment does not exist in the model; the extension point is a recipe or
  a worker-shaped modifier.
