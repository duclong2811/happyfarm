# Island Warehouse (V16.2) - IMPLEMENTED

Status: **IMPLEMENTED** (backend + API + client surface) as of V16.2. It is the first production economic
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
| Fishing / gathering | Refused before the roll; the completed action stays ACTIVE and claimable; no re-draw, no item, no XP |
| Shop buy | Aborts; **no gold is debited and no item is granted** |
| Shop sell, consumption, planting | Always allowed - the guard only fires when a stack grows, so selling frees capacity immediately |

The API maps the guard's database error to the stable code `WAREHOUSE_FULL` (HTTP 409), so the client
gets a gameplay-meaningful error rather than a 500.

### Rewards that are rolled must not be redrawn

A fishing catch and a gather are *chosen* by a random port at settlement time, and the database guard
only refuses when the batch runs. That ordering would let a full warehouse discard the drawn result and
let the retry draw a different one. So both settlements ask a pre-flight question first:
`assertWarehouseHasRoom` (`packages/application/src/storage.ts`) runs the same net-delta arithmetic
*before* the roll. A fishing catch is exactly one item, so the question is exact; a gather reserves the
largest quantity its table can produce, which is conservative on purpose. This pre-check does not
reserve space: another grant can fill storage before the payout batch runs.

V16.2.1 therefore pins server entropy on the action before payout (`0020_action_reward_rolls.sql`).
Fishing stores one roll; gathering stores selection and quantity rolls together. A conditional write
chooses one winner under concurrency, and every contender reads that same stored outcome. The rolls
are immutable and survive a payout rollback, a new request ID, and a Worker restart. A retry of the
same attempt uses the pinned rolls; it cannot obtain a different catch because storage filled after
the pre-check. Rolls never appear in the client contract. XP, inventory, action completion, node
depletion and the successful receipt still commit together in the original settlement transaction.

The net-delta domain rule permits non-positive deltas even when legacy usage remains over capacity,
matching the database guards. See `docs/qa/V16_2_1_WAREHOUSE_FULL_QA.md` for boundary and race evidence.

## Upgrade settlement: the step marker

`0019_warehouse_upgrade_marker.sql` adds `home_island_warehouses.last_upgrade_transaction_id`, the
economy transaction that last raised the tier. The upgrade's idempotency receipt is written only when
the row still names *that* transaction.

Without it, two upgrades racing from the same tier could both settle: one moves the row, the other's
step is refused by the `tier`/`version` guard, but its receipt was satisfied by the *winner's* tier and
version - so it committed its ledger row and charged for a tier it never raised. With the marker the
loser names the winner's transaction, so its whole batch rolls back and it fails closed.
`UpgradeWarehouse` also re-reads the row on a lost race and answers `CONFLICT_STALE_STATE` when the tier
moved, rather than retrying a step that belongs to the past.

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

- `GET /warehouse` -> `{ warehouse: { tier, tierDisplayNameKey, capacity, used, available, overCapacity, nextTier, nextCapacity, nextUpgrade } }`
- `POST /warehouse/upgrade { requestId }` -> the same shape after the upgrade

## Client surface

One compact strip at the top of the existing Inventory panel (`#warehouse` in `index.html`,
`renderWarehouse()` in `main.ts`): the tier name, `used / capacity`, a capacity bar, the next capacity
and its cost, and an Upgrade button. It is the only management surface; Character View gets the same
concise `WAREHOUSE_FULL` feedback through the shared error table and no panel of its own.

The status is read with the rest of the account - on load and after a mutation that changed what the
island holds - and never on a timer. There is no warehouse polling, no per-frame query, and an upgrade
redraws only the strip.

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
- **Warehouse 3D building**: not part of this phase. The management surface is the Inventory strip
  above.
