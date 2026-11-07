# Economy baseline: what the game actually pays today

Status: measured, not proposed. Every number below comes from the shipped game data through
`packages/economy-sim/src/baseline.ts`, and `tests/economy-sim/baseline.test.ts` fails if this document's
source drifts from the catalogue. It is the "implemented today" column of the economy bible.

## What exists

| System | Content | Where the numbers live |
| --- | --- | --- |
| Farming | 8 crops, 3 production trees | `packages/game-data/src/crops`, `trees` |
| Fishing | 4 spots, 2 catch tables, 7 species | `packages/game-data/src/fishing` |
| Mining | 4 deposits, 9 placements | `packages/game-data/src/resources` |
| Forestry | 3 wild trees, 13 placements | `packages/game-data/src/resources` |
| Market | 30 catalogue entries, one buy or sell direction each | `packages/game-data/src/shops` |
| Land | 8 plots, level-gated, gold-priced | `packages/game-data/src/plots` |
| Progression | 50 levels, triangular curve, `xpStep` 120 | `packages/game-data/src/progression` |
| Storage | none - inventory is effectively unlimited | - |
| Workers, processing, crafting, ships, army | none | - |

## Per-minute rates, as the balance docs compute them

| System | Gold/minute | XP/minute | Unit |
| --- | --- | --- | --- |
| Farming (a crop tile) | 0.36-0.50 | 0.80 | one tile |
| Farming (a tree) | 0.40-0.48 | 0.60 | one tree |
| Fishing | 12.4-14.2 | 6.8-8.2 | one spot, active |
| Mining | 8.77 | 12.27 | the whole island's deposits |
| Forestry | 12.25 | 16.50 | all thirteen wild trees |

The units are the point: farming's rate is per tile and scales with land, while fishing, mining and
forestry are per-island rates bounded by spots, deposits and regeneration. A player's actual income is
the mix of those they keep working.

## Gold faucets and sinks, as implemented

| Direction | What | Notes |
| --- | --- | --- |
| Faucet | **The market buying produce** (`/shop/sell`) | The only way gold enters the world |
| Sink | **The market selling seeds and saplings** (`/shop/buy`) | Gold leaves when a player plants |
| Sink | **Land expansion** (8 plots, 100-8,000 gold) | One-off, level-gated |
| Sink | (none else) | No fees, no wages, no upkeep, no crafting |

A player is a net gold *creator*: a carrot seed costs 2 and its harvest sells for 4, so every loop pays
the player. The quantity of gold in the world therefore only grows, and the brief's own rule is that
this is expected until sinks exist. The simulator measures exactly this and reports it as an inflation
pressure rather than a bug.

## Resource sources and sinks, as implemented

| Resource | Source | Sink |
| --- | --- | --- |
| Crops, fruit | planting and harvesting | eaten by nothing; only sold |
| Fish | fishing spots | sold only |
| Stone, coal, copper, iron | mining deposits (regenerating) | sold only |
| Wood, hardwood, resin | wild trees (regenerating) | sold only |
| Seeds, saplings | bought | consumed by planting |

Nothing in the game *consumes* a produced good yet except planting inputs, so every resource accumulates.
The ledger records each currency mutation with reason, reference and balances; there is no resource
ledger because nothing has needed one.

## Time

Every timed system is server-clock derived: crops and trees from `planted_at`, fishing from a persisted
`ready_at`, resource nodes from `available_at`. Regeneration is a comparison rather than a job, which is
why the simulator can model a day as a single step.
