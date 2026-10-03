# Island Warehouse (V16.2) - IMPLEMENTED

Status: **IMPLEMENTED** (backend + API) as of V16.2. It is the first production economic
infrastructure built on the V16 economy model. The five-profession model
(`docs/economy/FIVE_ELEMENT_CAPACITY_MODEL.md`) is untouched: the warehouse contains no element
assumptions and no processing specialisation.

## What it is

The Warehouse is **capacity over the existing inventory**, not a second inventory. Stored goods stay
in `inventory_items`; the warehouse is the one budget that bounds them, per Home Island. That is what
lets every existing grant path - crop harvest, production tree, fishing, mining, forestry, shop buy,
the starter package - be constrained without a second check each of them could forget.

```text
usedCapacity   = SUM(inventory_items.quantity) for the player
capacity       = the warehouse row's capacity, derived from its tier
available      = max(0, capacity - usedCapacity)
```

## Capacity unit and starter capacity

One inventory item quantity = **one storage unit**. That is the simplest abstraction the current
catalogue allows (all items are stackable material/produce/fish/seed), and it leaves room for a future
`storageWeight` without a schema rewrite.

Starter capacity is **1,000 units**, then **2,500 / 6,000 / 15,000** across three upgrades. Normal
starter play does not fill it immediately; the first upgrade is a real economic decision. The numbers
are provisional production-alpha values, isolated in `packages/game-data/src/warehouse/index.ts`.

## Tiers and upgrade costs

| Tier | Capacity | Upgrade cost (to the next tier) |
| --- | --- | --- |
| 0 Starter | 1,000 | 500 gold + 50 wood + 50 stone |
| 1 Early | 2,500 | 2,000 gold + 150 wood + 150 stone |
| 2 Developing | 6,000 | 8,000 gold + 400 wood + 400 stone |
| 3 Mid (max) | 15,000 | - |

Only current production goods are required (gold, wood, stone). Higher tiers may add steel/timber when
those goods exist.

## Ownership and the inventory compatibility bridge

The warehouse belongs to the player's **HOME_ISLAND zone**, not to the player globally:
`home_island_warehouses(owner_player_id PRIMARY KEY, zone_kind, zone_id, tier, capacity, version,
timestamps)`. `zone_id` is the farm id when one exists. Current inventory is player-scoped, so the
**bridge** is `owner_player_id`: until per-zone inventories exist, the HOME_ISLAND warehouse is 1:1 with
the player. A future expansion island is another row with its own `zone_id`, not a redesign. Location
still grants no authority: every read and mutation is scoped to the authenticated actor.

## Server-authoritative capacity

Capacity is enforced **inside the database transaction** by two triggers on `inventory_items`
(`warehouse_capacity_guard_insert` / `_update`). They refuse any row that would push
`SUM(quantity)` past the player's capacity, so concurrent grants cannot overflow (the whole settlement
rolls back). A player with no row is held to the starter capacity by the guard's default. The domain
rule `assertStorageDeltaFits(capacity, used, deltas)` is the same arithmetic for application code, and
it takes a **net delta**, so a future recipe that consumes 10 and produces 6 is evaluated on its net
change. The client never sees or supplies capacity, tier or cost.

## Full-storage behaviour (implemented paths)

The guard is shared, so every grant path behaves the same: the transaction rolls back.

| Path | When the warehouse is full |
| --- | --- |
| Crop / tree harvest | Settlement aborts; the crop/tree stays and can be harvested after space is freed; no XP is written |
| Fishing / gathering | Settlement aborts; the completed action stays ACTIVE and claimable; no re-roll, no item, no XP |
| Shop buy | Aborts; **no gold is debited and no item is granted** |
| Shop sell, consumption, planting | Always allowed - the guard only fires when a stack grows, so selling frees capacity immediately |

The API maps the guard's database error to the stable code `WAREHOUSE_FULL` (HTTP 409), so the client
gets a gameplay-meaningful error rather than a 500.

## Legacy / grandfathering

Existing players are backfilled to the starter tier by the migration, and new players get a row in the
same transaction as their `players` row. A player whose existing inventory exceeds the capacity keeps
**every item**: no deletion, no truncation, no refused login. Grants are refused until space is freed
or the warehouse is upgraded; selling and consuming always work. This is tested.

## Upgrade semantics

`POST /warehouse/upgrade` is server-authoritative: the server decides the next tier and its cost (the
client sends only a `requestId`), validates ownership, gold and materials, and writes the ledger row,
the consumed materials, the new tier and the idempotency receipt in one transaction. One step per
request; there is no skip. Gold moves through the centralized economy service and its ledger under the
new `WAREHOUSE_UPGRADE` reason (`reference_type = 'WAREHOUSE'`).

## API

- `GET /warehouse` -> `{ warehouse: { tier, capacity, used, available, overCapacity, nextTier, nextUpgrade } }`
- `POST /warehouse/upgrade { requestId }` -> the same shape after the upgrade

## D1 / query behaviour

Status reads two bounded statements: the one capacity row and one aggregate over the player's own
inventory rows. There is no warehouse polling, no full-table scan, and no per-item round trip. The
upgrade is one batch. This respects the V14.3.2 read-cost work.

## Future (documented, not implemented)

- **Character Backpack**: a separate storage location. Today's inventory behaves as Home Island stored
  goods through the player/zone bridge.
- **Ship Cargo**: future storage; the zone-keyed table does not prevent it.
- **Multi-island**: another warehouse row per zone.
- **Processing / crafting**: the net-delta primitive (`assertStorageDeltaFits`) is the capacity rule the
  future transaction will call.
- **Player market / NPC workers**: enforcement on delivery and output throttling both sit on the same
  capacity check.
- **Warehouse 3D building and client UI surface**: not part of this commit (see the V16.2 report).
