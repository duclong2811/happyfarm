# Forestry balance

**PROVISIONAL — GLOBAL ECONOMY REBALANCE PENDING.**

These numbers are playable, data-driven and easy to retune, and they are **not final**. HappyFarm now
has four income systems (farming, fishing, mining, forestry) and no sinks: no warehouse capacity, no
building costs, no NPC wages, no shipbuilding. The next major design phase models the economy as a
whole and will move these values; nothing here should be treated as a permanent rate, and no existing
profession was rebalanced to make forestry fit.

Every figure is computed from the definitions by `packages/game-data/src/balance.ts`
(`forestryBalance`) and checked by `tests/game-data/forestry.test.ts`.

## The wild trees

`gold/gather = quantity x sell price`. `sustained gold/min` is
`nodes x goldPerGather / max(nodes x actionSeconds, regenerationSeconds)` - the honest rate, after the
stump has to grow back.

| Tree | Verb | Action | Regeneration | Nodes | Drop | Qty | Sell | XP | Gold/gather | Sustained gold/min | Sustained XP/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wild tree | CHOP | 5 s | 2 min | 5 | wood | 2 | 1 | 2 | 2 | **5.00** | 5.00 |
| Resin pine | CHOP | 7 s | 4 min | 4 | resin | 2 | 2 | 6 | 4 | **4.00** | 6.00 |
| Hardwood tree | CHOP | 11 s | 8 min | 3 | hardwood | 2 | 3 | 12 | 6 | **2.25** | 4.50 |
| **Island total** | | | | 12 | | | | | | **11.25** | **15.50** |

Unlock levels: wild tree 1, resin pine 3, hardwood 5 - wood is what a new player can gather
immediately, and the two richer woods arrive alongside the mining deposits at similar levels.

## Comparison with mining

| | Gold/min | XP/min | Nodes | Identity |
| --- | --- | --- | --- | --- |
| Mining (all deposits) | 8.77 | 12.27 | 9 | burst income, long regeneration, ore for crafting |
| Forestry (all trees) | **11.25** | **15.50** | 12 | faster regeneration, bulk material for construction |

Forestry is deliberately a little higher than mining: wood is the bulk input for the buildings, docks
and ships that do not exist yet, so the tree that feeds them should be worth walking to. The two are
within a factor of ~1.3 of each other, which is the check the balance test holds (`forestry` between
0.5x and 2x mining), so neither profession makes the other pointless. Fishing remains the best
per-minute active income (12.4-14.2), which is intentional: it also has no cooldown to wait out.

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
