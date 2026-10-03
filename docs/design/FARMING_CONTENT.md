# Farming content

Status: V14.5. This is the roster of everything a player can grow - eight field crops and three
orchard trees - and the role each one plays. The numbers behind them are in
`docs/design/FARMING_BALANCE.md`; the definitions are in `packages/game-data/src/{crops,trees}` and
nothing else knows them.

## Field crops

| Crop | Level | Growth | Seed | Yield | Produce | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Carrot | 1 | 5 min | carrot seed | 2 | carrot | The starter: fastest, cheapest, lowest profit per seed |
| Wheat | 2 | 15 min | wheat seed | 3 | wheat | The dependable workhorse |
| Corn | 3 | 30 min | corn seed | 3 | corn | The mid-value staple |
| Potato | 4 | 20 min | potato seed | 4 | potato | The bulk crop: the best gold per minute |
| Tomato | 5 | 45 min | tomato seed | 7 | tomato | A steady premium crop |
| Strawberry | 6 | 60 min | strawberry seed | 8 | strawberry | The capital-efficient premium |
| Cabbage | 7 | 75 min | cabbage seed | 8 | cabbage | The long, patient crop |
| Pumpkin | 8 | 90 min | pumpkin seed | 10 | pumpkin | The long bet: the largest profit per harvest |

### Roles, not labels

The roles are design intent; the game never shows them. Each crop is a different answer to "what do I
do with my time and my gold":

- **Carrot** is what a new player starts with. It finishes while they are still watching, so
  plant-harvest-sell happens in the first minutes.
- **Wheat and corn** are slower but repay their seed better; the player who checks in every so often
  leaves with more gold per seed planted.
- **Potato** is the answer for an active player: the highest gold per minute in the game, paid for
  with a mid-sized seed and a mid-sized harvest.
- **Tomato, strawberry, cabbage and pumpkin** trade turnover for capital efficiency. Their net profit
  per harvest climbs with their growth time, so the player who plans around a session away from the
  screen is rewarded, while the player who farms continuously is rewarded with potato's pace.

## Orchard trees

| Tree | Level | Sapling | First fruit | Cycle | Yield/cycle | Fruit | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Apple | 3 | apple sapling | 60 min | 15 min | 3 | apple | The introduction to the orchard |
| Orange | 5 | orange sapling | 90 min | 20 min | 3 | orange | A bigger, slower bet |
| Peach | 9 | peach sapling | 120 min | 25 min | 4 | peach | The long-term orchard investment |

### The tree lifecycle

```text
buy sapling -> plant -> grow (firstReadySeconds) -> ready -> harvest
                                                             |
                                        regrow (regrowSeconds) -> ready -> harvest -> ...
```

A tree is **not** a crop that happens to be taller. It stays in the ground and produces again, so it
costs more than any seed, takes an hour or more to bear its first fruit, and pays less per minute
than the best field crop. What it buys the player is not doing anything: no replanting, no seed
purchases, and a harvest waiting whenever they return. Its XP per cycle is deliberately below the
crops' rate, so the orchard is an income plan, not the experience path.

## Where the content lives

| Thing | File |
| --- | --- |
| Crop definitions (growth, stages, yield, XP, unlock level, seed) | `packages/game-data/src/crops/index.ts` |
| Tree definitions (first ready, regrow, yield, XP, unlock level, sapling) | `packages/game-data/src/trees/index.ts` |
| Produce items, seeds, saplings | `packages/game-data/src/items/index.ts` |
| Market buy/sell prices | `packages/game-data/src/shops/index.ts` |
| Derived economy figures | `packages/game-data/src/balance.ts` |
| Crop models | `tools/asset-pipeline/node/specs.mjs` -> `apps/web/src/assets/models/*.glb` |

Adding a crop is a definition plus an item plus two shop entries plus a model spec. No use case, no
route, and no client list changes: the catalogue endpoints already serve whatever the definitions
say, the planting picker and the market are built from that catalogue, and `tests/web/farm-assets.test.ts`
fails if a plantable crop has no model.

## Visuals

Every crop ships one generated model, distinguishable at a glance from the field camera: a leafy
root mound for potato, a staked red-fruited bush for tomato, a low berry clump for strawberry, a fat
head with an outer-leaf skirt for cabbage, and a ribbed orange globe for pumpkin. The three orchard
trees share one canopy model and differ by the colour of the fruit on a ready tree - red apple,
orange, peach - which is the cheap, honest signal until species art exists. Nothing in the farming
logic reads any of this.

## Deliberately absent

No fishing, mining, forestry, animals, processing, or region-specific crops. The requirement model on
each definition is a level today; a future world (region, zone, biome) adds a field rather than
rewriting the lifecycle. See `docs/design/FARMING_PROGRESSION.md`.
