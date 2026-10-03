# Farming balance

Status: V14.5, **alpha-tuned**. These numbers are chosen to make the early game a set of real choices
now, and are expected to move as more content, land, and player data arrive. They are computed from
the definitions by `packages/game-data/src/balance.ts` and checked by
`tests/game-data/farming-balance.test.ts`; the table below is that computation, not a second source.

## Field crops

`net = yield x sell - seed`. `gold/min = net / growth`. `xp/min = xp / growth`.

| Crop | Lvl | Growth | Seed | Yield | Sell | Gross | Net | ROI | Gold/min | XP | XP/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Carrot | 1 | 5 min | 2 | 2 | 2 | 4 | 2 | 1.00 | 0.400 | 4 | 0.80 |
| Wheat | 2 | 15 min | 3 | 3 | 3 | 9 | 6 | 2.00 | 0.400 | 12 | 0.80 |
| Corn | 3 | 30 min | 6 | 3 | 6 | 18 | 12 | 2.00 | 0.400 | 24 | 0.80 |
| Potato | 4 | 20 min | 6 | 4 | 4 | 16 | 10 | 1.67 | **0.500** | 16 | 0.80 |
| Tomato | 5 | 45 min | 12 | 7 | 4 | 28 | 16 | 1.33 | 0.356 | 36 | 0.80 |
| Strawberry | 6 | 60 min | 14 | 8 | 5 | 40 | 26 | 1.86 | 0.433 | 48 | 0.80 |
| Cabbage | 7 | 75 min | 18 | 8 | 6 | 48 | 30 | 1.67 | 0.400 | 60 | 0.80 |
| Pumpkin | 8 | 90 min | 22 | 10 | 6 | 60 | **38** | 1.73 | 0.422 | **72** | 0.80 |

## Production trees

A tree's cycle revenue is pure income (the sapling was paid once). `payback` is how many cycles it
takes to repay the sapling.

| Tree | Lvl | Sapling | First fruit | Cycle | Yield | Sell | Revenue/cycle | Gold/min | XP | XP/min | Payback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple | 3 | 12 | 60 min | 15 min | 3 | 2 | 6 | 0.400 | 9 | 0.60 | 2.0 cycles |
| Orange | 5 | 18 | 90 min | 20 min | 3 | 3 | 9 | 0.450 | 12 | 0.60 | 2.0 cycles |
| Peach | 9 | 24 | 120 min | 25 min | 4 | 3 | 12 | 0.480 | 15 | 0.60 | 2.0 cycles |

## The rules the numbers hold to

These are the invariants `tests/game-data/farming-balance.test.ts` asserts. If a future edit breaks
one, the test names it.

1. **Every seed is repaid by one harvest, and every sapling by two.** No definition is a trap.
2. **Experience is time, not clicks.** Every crop pays exactly `0.8 xp/min`; a tree pays `0.6`. The
   game never rewards spamming the shortest crop, and a slow crop is never punished.
3. **Net profit strictly increases with growth time.** A crop that finishes sooner must give up
   something - its harvest is smaller. This is what makes non-domination provable: a shorter crop can
   never beat a longer one on every axis at once.
4. **No crop dominates another** on growth, net, gold/min, XP/min, and ROI together.
5. **The best metric belongs to a different crop each time**: fastest is carrot, gold/min is potato,
   profit/harvest is pumpkin, capital efficiency is wheat.
6. **Trees are a longer bet, not a better crop.** A tree's gold/min is at or below the best field
   crop's, its XP/min is lower, and its first fruit takes at least one cycle's worth of waiting.
7. **No item is both bought and sold.** The market has one direction per item, so no buy-then-sell
   round trip exists.

## Where the money comes from and goes

- Gold enters the economy only through the market buying produce; it leaves only through the market
  selling seeds and saplings and the land catalogue selling plots.
- The starter package (10 carrot seeds, 100 gold) is enough to run the carrot loop and choose between
  more seeds and the first plot; the plot ladder
  (`packages/game-data/src/plots/index.ts`) runs level 1-8 at 100 to 8,000 gold.
- A player who farms continuously earns at potato's pace; one who plants and walks away earns at
  pumpkin's or the orchard's. Neither path is strictly better, which is the point.

## What is alpha-tuned and expected to change

- Absolute prices and yields. They are set so a five-minute wait is worth a couple of gold, not to
  model a real farm economy.
- Growth times. The longest crop is 90 minutes because this is still a small alpha; a production
  curve would stretch the late crops and re-tune the payout around it.
- The `0.8 xp/min` flat rate. It is deliberate for now (no XP exploit, no XP-poor crop), but a later
  phase with more content may want a gentler curve that rewards the first harvest of a new crop.
- Tree gold/min vs. crops'. The orchard currently sits just below the best crop; the ratio is a
  balance knob and should move once players actually run orchards for a season.
- The land ladder's prices. They were written for the pre-V14.5 economy and are only mildly coherent
  with it; see `docs/performance/D1_READ_AUDIT.md` and the V14.5 audit note about the starter parcel.
