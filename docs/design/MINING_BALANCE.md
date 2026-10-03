# Mining balance

Status: V15.2, **alpha-tuned**. Every figure is computed from the node definitions by
`packages/game-data/src/balance.ts` (`miningBalance`) and checked by `tests/game-data/mining.test.ts`;
this table is that computation, not a second source.

## The deposits

`gold/gather = quantity x sell price`. `sustained gold/min` is the honest rate: for one node type it is
`nodes x goldPerGather / max(nodes x actionSeconds, regenerationSeconds)` - mining every node of that
type back to back and then waiting out the first regeneration.

| Deposit | Verb | Action | Regeneration | Nodes | Drop | Qty | Sell | XP | Gold/gather | Sustained gold/min | Sustained XP/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stone outcrop | MINE | 6 s | 2 min | 3 | stone | 2 | 1 | 3 | 2 | **3.00** | 4.50 |
| Copper deposit | MINE | 8 s | 5 min | 2 | copper ore | 2 | 2 | 6 | 4 | **1.60** | 2.40 |
| Coal deposit | MINE | 10 s | 7 min | 2 | coal | 3 | 3 | 9 | 9 | **2.57** | 2.57 |
| Iron deposit | MINE | 13 s | 10 min | 2 | iron ore | 2 | 4 | 14 | 8 | **1.60** | 2.80 |
| **Island total** | | | | 9 | | | | | | **8.77** | **12.27** |

Unlock levels: stone 1, copper 2, coal 4, iron 6 - a new player can mine immediately, and the richer
deposits wait until they have been farming or fishing for a while.

## Why these numbers

- **Mining is instant-reward but supply-capped.** A single swing pays in seconds, which is why the
  per-gather numbers look generous next to a crop; the regeneration is what stops that from being the
  whole economy. The sustained column is the number that matters, and it is the one compared below.
- **A quicker deposit is never also the richer one.** Stone is the fastest and the poorest per swing;
  iron is the slowest and the richest per swing but pays the same per minute as copper. A player who
  wants cash now mines stone; one who wants future crafting stock mines iron.
- **The level gate is on the *node*, not the material.** Copper and iron are visible from the start and
  refused with a level requirement, so the world shows a player what is ahead of them.
- **One material per deposit.** The tables support weighted, multi-entry drops and quantity ranges (the
  draw is the fishing catch table's own function, with the shared random port), but V15.2 ships
  deterministic yields on purpose: a predictable rate is easier to balance and to test than a loot roll,
  and there is no rarity ladder to justify one yet.

## Comparison with farming and fishing

| | Gold/min | XP/min | Scales with | Costs |
| --- | --- | --- | --- | --- |
| One crop tile | 0.36-0.50 | 0.80 | land (parallel) | seed, land, replanting |
| A 24-tile potato field | ~12 | ~19 | land (parallel) | seeds, land, many actions |
| Fishing (active) | 12.4-14.2 | 6.8-8.2 | attention (one at a time) | nothing but time |
| Mining (all nine deposits) | **8.77** | **12.27** | attention and the regeneration clock | walking |

Mining must not obsolete fishing, and it does not: the whole island's deposits, mined as fast as one
player can walk them, pay less gold per minute than a single fishing spot. What mining brings instead is
*burst* income - a swing pays in seconds - and a reason to explore the volcano, at the cost of the
longest travel and a deposit that then has to come back. In practice a player shuttling between nine
nodes earns less than the table's 8.77, because the walking is real.

## What is alpha-tuned and expected to change

- Absolute sell prices (1-4 gold). They are deliberately low: stone, copper, iron and coal are the
  inputs crafting and building will consume, so selling should be useful early cash, never obviously
  better than keeping the ore.
- Regeneration times (2-10 minutes). They are the main lever on mining's sustained rate; a longer iron
  regeneration makes iron rarer without changing a single swing.
- Yields and action durations. A pickaxe or a stamina system would retune all of them.
- The node count and placement. Nine hand-placed deposits on the volcano are the foundation; regional
  scarcity and shared grounds wait for the world map.
