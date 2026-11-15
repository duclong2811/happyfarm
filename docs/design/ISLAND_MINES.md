# Island Mines

Status: Phase B server slice (agreed with the project owner on 2026-11-15). It replaces the hold-to-mine
ore node and Auto's continuous mining with **tiered mines that fill on their own and are emptied in one
dig**. The client panel and the retirement of the old ore node follow in the next slice.

## The loop

```text
mine fills at its level's rate from server time ── stops at 4 hours of output
      │
      ├─ [Dig] -> as much ore as the warehouse (and the stack) has room for; the rest stays banked
      │           +1 XP per 20 ore over the mine's whole life
      │
      └─ [Upgrade] -> gold (ledger) + wood + ore (inventory) -> next level, gated on the owner's level;
                      everything mined at the old rate is banked first
```

## Numbers (`packages/game-data/src/mines`)

| Level | Ore/hour | Player level | Upgrade cost (gold / wood / ore) |
|---|---|---|---|
| 1 | 60 | 1 | – |
| 2 | 90 | 8 | 500 / 80 / 150 |
| 3 | 130 | 15 | 1,000 / 160 / 300 |
| 4 | 180 | 25 | 2,200 / 300 / 600 |
| 5 | 240 | 35 | 4,700 / 600 / 1,200 |
| 6 | 310 | 45 | 10,000 / 1,100 / 2,400 |
| 7 | 390 | 55 | 21,000 / 2,200 / 4,900 |
| 8 | 480 | 70 | 45,000 / 4,300 / 9,900 |
| 9 | 580 | 85 | 95,000 / 8,300 / 20,000 |
| 10 | 700 | 100 | 200,000 / 16,000 / 40,000 |

- Accumulation cap: 4 hours of the current level's output.
- Slots open with the owner's level: 1 / 20 / 50 on most islands, 1 / 10 / 20 / 35 / 50 / 70 on Kim islands.
- Experience: one point per 20 ore, counted over the mine's lifetime (`ore_dug_total`), so many small
  digs pay exactly what one large dig would.

## Where mines stand

- The hand-composed island: `COMPOSED_ISLAND_MINE_POSITIONS` (slot 0 is the old ore ridge).
- A chosen island: its own `ORE` sites first, then a fixed outward search around the first one on solid
  ground, clear of the dock and camp (`islandMineTiles`). It reads only the stored cells and sites, so
  the server and the browser always agree and the frozen generator never changes.

## Authority

- No ticking: `farm_mines` stores `banked_milli` and `accrued_since`; what a mine holds is computed from
  server time on read (`packages/domain/src/mine.ts`). Thousandths of an ore keep partial digs and
  mid-hour upgrades lossless.
- Rows are created lazily, only by the owner's own read, once the owner's level has opened the slot.
- Any member may read `GET /farms/:farmId/mines`; only the owner may `POST .../mines/:slot/collect` or
  `.../mines/:slot/upgrade` (body `{ requestId }` only - the client never names a level, price or amount).
- Both writes are one D1 batch: the mine row changes only at the version the caller read, and the receipt
  is written only if the row carries that write's own marker at the next version (plus, for an upgrade,
  the wallet, the ledger row and each consumed stack exactly where the write left them). Any mismatch
  rolls the whole batch back and the use case re-reads and retries.
- Gold moves through the economy service with reason `MINE_UPGRADE`, reference type `MINE`, reference id
  `mine_<farm uuid>_<slot>` (migration `0044` rebuilds the ledger's CHECKs exactly as `0018` did).
- Stable errors: `MINE_NOT_FOUND`, `MINE_SLOT_LOCKED`, `MINE_EMPTY`, `MINE_MAX_LEVEL`,
  `MINE_LEVEL_REQUIRED`, `MINE_CONFLICT`, plus the shared `WAREHOUSE_FULL`, `INSUFFICIENT_ITEMS`,
  `INSUFFICIENT_FUNDS`.

## Not yet

- Client: mine models per level, the dig/upgrade panel, and retiring `node_stone_ridge` and Auto MINE jobs.
- Mines do not yet block placement on chosen islands (production sites, task "production sites on chosen
  islands").
- Helpers/editors working someone else's mines, and NPC miners, are later phases.
