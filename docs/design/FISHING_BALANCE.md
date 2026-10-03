# Fishing balance

Status: V15.1, **alpha-tuned**. Every figure is computed from the catch tables by
`packages/game-data/src/balance.ts` (`fishingBalance`) and checked by
`tests/game-data/fishing.test.ts`; this table is that computation, not a second source.

## The action

One fishing action takes **15 seconds** on the server's clock (`FISHING_ACTION_SECONDS`): the cast, the
wait, and the catch. It is deliberately short for an alpha - long enough to be a beat, short enough to
play - and it is the denominator of every rate below.

## Species and catch tables

Two tables, one per kind of water. Weights are relative; the probability is the weight over the table's
total.

### Freshwater (the pond)

| Species | Weight | Probability | Sell | XP | Gold contribution | XP contribution |
| --- | --- | --- | --- | --- | --- | --- |
| Tilapia | 50 | 0.50 | 2 | 1 | 1.00 | 0.50 |
| Carp | 30 | 0.30 | 3 | 2 | 0.90 | 0.60 |
| Catfish | 20 | 0.20 | 6 | 3 | 1.20 | 0.60 |
| **Expected per action** | 100 | 1.00 | | | **3.10 gold** | **1.70 XP** |

### Coastal (the harbour quay)

| Species | Weight | Probability | Sell | XP | Gold contribution | XP contribution |
| --- | --- | --- | --- | --- | --- | --- |
| Sardine | 45 | 0.45 | 2 | 1 | 0.90 | 0.45 |
| Mackerel | 30 | 0.30 | 3 | 2 | 0.90 | 0.60 |
| Snapper | 20 | 0.20 | 5 | 3 | 1.00 | 0.60 |
| Tuna | 5 | 0.05 | 15 | 8 | 0.75 | 0.40 |
| **Expected per action** | 100 | 1.00 | | | **3.55 gold** | **2.05 XP** |

### Rates

| Water | Gold/action | XP/action | Gold/minute | XP/minute |
| --- | --- | --- | --- | --- |
| Freshwater | 3.10 | 1.70 | **12.4** | **6.8** |
| Coastal | 3.55 | 2.05 | **14.2** | **8.2** |

## Comparison with farming

Farming's figures are per **tile**: the best crop is potato at 0.50 gold/minute and every crop pays
0.80 XP/minute, and a farm's throughput is that rate times the number of tiles the player keeps
working.

| | Gold/minute | XP/minute | Scales with | Costs |
| --- | --- | --- | --- | --- |
| One crop tile | 0.36-0.50 | 0.80 | - | seed, land, replanting |
| A 24-tile potato field | ~12 | ~19 | tiles (parallel) | seeds, land, many actions |
| Fishing (freshwater) | 12.4 | 6.8 | attention (one at a time) | nothing but time |
| Fishing (coastal) | 14.2 | 8.2 | attention (one at a time) | nothing but time |

The intent, and what the test asserts:

- **Fishing is worth doing.** It beats a single crop's rate by a wide margin, because an action is one
  catch rather than one tile of many.
- **It does not replace farming.** It is in the same band as a *well-worked mid-size field*, it pays
  less experience than that field, and it cannot scale: a player fishes one spot at a time, while a farm
  grows by buying land and planting more of it.
- **It is not free money.** There is no energy or bait cost yet, so the balancing cost is the action
  itself - fifteen seconds of attention per catch, and no way to run several at once.
- The coastal table pays a little more than the freshwater one, and the harbour spot is farther from
  the farm than the pond, which is the whole of the risk/reward for V15.1.

## What is alpha-tuned and expected to change

- The 15-second action. With energy, bait, or a fishing minigame, the duration and the values both move.
- Absolute sell prices. They are set against the crop prices above, not against a real fish market.
- The rare end of the coastal table (tuna at 5%). One rare species is enough to make a cast
  interesting; a real rarity ladder waits for more content.
- The XP ratio. Fishing earns less per minute than an equivalent farming effort on purpose, so the
  profession is an income route rather than a levelling shortcut.
- Spot placement and count. Four spots on one island is the foundation, not the final geography.
