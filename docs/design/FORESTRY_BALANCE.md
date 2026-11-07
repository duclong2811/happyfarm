# Forestry balance

**PROVISIONAL — GLOBAL ECONOMY REBALANCE PENDING.**

These numbers are playable, data-driven and easy to retune, and they are **not final**. HappyFarm now
has four income systems (farming, fishing, mining, forestry) and no sinks: no warehouse capacity, no
building costs, no NPC wages, no shipbuilding. The next major design phase models the economy as a
whole and will move these values; nothing here should be treated as a permanent rate, and no existing
profession was rebalanced to make forestry fit.

The shared resource-node figures are computed from the definitions by
`packages/game-data/src/balance.ts` (`forestryBalance`) and checked by
`tests/game-data/forestry.test.ts`. The persisted-tree rates below are defined in
`packages/game-data/src/forestry.ts` and `trees/index.ts`, with arithmetic locked by
`tests/game-data/forestry-construction.test.ts`.

## The wild trees

`gold/gather = quantity x sell price`. `sustained gold/min` is
`nodes x goldPerGather / max(nodes x actionSeconds, regenerationSeconds)` - the honest rate, after the
stump has to grow back.

| Tree | Verb | Action | Regeneration | Nodes | Drop | Qty | Sell | XP | Gold/gather | Sustained gold/min | Sustained XP/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild tree | CHOP | 5 s | 2 min | 6 | wood | 2 | 1 | 2 | 2 | **6.00** | 6.00 |
| Resin pine | CHOP | 7 s | 4 min | 4 | resin | 2 | 2 | 6 | 4 | **4.00** | 6.00 |
| Hardwood tree | CHOP | 11 s | 8 min | 3 | hardwood | 2 | 3 | 12 | 6 | **2.25** | 4.50 |
| **Island total** | | | | 13 | | | | | | **12.25** | **16.50** |

Unlock levels: wild tree 1, resin pine 3, hardwood 5 - wood is what a new player can gather
immediately, and the two richer woods arrive alongside the mining deposits at similar levels.

## Comparison with mining

| | Gold/min | XP/min | Nodes | Identity |
| --- | --- | --- | --- | --- |
| Mining (all deposits) | 8.77 | 12.27 | 9 | burst income, long regeneration, ore for crafting |
| Forestry (all trees) | **12.25** | **16.50** | 13 | faster regeneration, bulk material for construction |

Forestry is deliberately a little higher than mining: wood is the bulk input for the buildings, docks
and ships that do not exist yet, so the tree that feeds them should be worth walking to. The two are
within a factor of ~1.3 of each other, which is the check the balance test holds (`forestry` between
0.5x and 2x mining), so neither profession makes the other pointless. Fishing remains the best
per-minute active income (12.4-14.2), which is intentional: it also has no cooldown to wait out.

## Persisted starter trees and the planted specialist

The construction-backed pine and broadleaf trees are a separate economy surface from the shared
resource nodes above. They keep their management actions and lifecycle when stored, but their
ordinary regeneration is deliberately slower than the old 4-5 minute tuning. Wood remains worth
1 gold; the specialist wins through a larger batch and fewer visits rather than price inflation.

| Source | Drop | Regeneration | Gold/gather | Sustained gold/hour | Player operations/hour | Space |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Starter / placed broadleaf | 2 wood | 12 min | 2 | 10 | 5 | 1 world tile |
| Starter / placed pine | 2 wood | 15 min | 2 | 8 | 4 | 1 world tile |
| Planted Wildwood (one-shot) | 12 wood | 60 min | 12 gross / 9 net | 12 gross / 9 net | 1 + 1 replant | 1 farm plot |

Wildwood costs 3 gold per sapling. It has one productive cycle only: after the 60-minute harvest the
tree is depleted, and the player must clear the stump and buy/spend one new sapling. Its sustained
replant loop is therefore `(12 wood × 1 gold - 3 gold) / 1 hour = 9 net gold/hour`; there is no
automatic regrowth. Existing shared resource-node rates are unchanged.

The starter world currently contains 76 broadleaf and 61 pine construction trees. At full theoretical
cooldown throughput, the chosen rates are `76 × 10 + 61 × 8 = 1,248 gross gold/hour`; changing wood
to 2 gold would make that 2,496 gross gold/hour before any travel or attention cost. That doubles the
starter wood faucet relative to the current economy, so wood remains at 1 gold. For comparison, the
whole-island mining table is about 526 gold/hour and fishing is about 744–852 gold/hour; these are
aggregate profession baselines, not promises that one player can click every node continuously.

## Why these numbers

- **Wood is quick and bulk; hardwood is slow and valuable.** The wild tree chops in five seconds and
  comes back in two minutes, so a builder can gather a stack; hardwood takes eleven seconds and eight
  minutes for a material meant for advanced construction.
- **Resin is the intermediate with its own identity.** A slower chop than wood and a slower regrowth,
  paying more per unit but less total, so a pine is worth visiting without being a better wood tree.
- **A material per tree, deterministically.** The drop table supports weighted multi-entry tables and
  quantity ranges (the same draw as fishing's catch table), but V15.3 ships one deterministic entry
  per tree: a predictable rate is easier to balance now and to retune later, and there is no rarity
  ladder to justify a roll.
- **Prices are low on purpose.** Wood will be wanted in bulk for construction, so selling it is early
  liquidity rather than the obvious long-term use.

## What will move

- Prices, once the construction and crafting sinks exist and the value of a plank is known.
- Regeneration times, which are the main lever on the sustained rate.
- Yields and action durations, when tools or workers can change them.
- Whether any tree drops more than one material - a question for the economy phase, not this one.
