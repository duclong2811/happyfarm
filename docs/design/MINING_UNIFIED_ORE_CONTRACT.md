# Unified ore mining contract

## Decision

The active Home Island mining contract exposes one definition, `resource_ore`, one
drop, `item_ore` (2 units), and one display name: **Mỏ quặng** / **Quặng**.
It reuses the existing `resource_stone` GLB because that is the closest loaded
ore visual and does not introduce an asset dependency. The active node keeps the
stable id `node_stone_ridge` and is placed at tile `(12, -12)`, on the
server-approved mining slope.

Mining is continuous actor labor: an enabled `MINING` assignment for the Main
Character yields 2 ore every 6 seconds into actor cargo. The node is a durable
work anchor and access/Work Area check; it has no depletion cooldown. The
legacy production-rate settlement endpoint refuses `resource_ore`, so the same
ore cannot be paid once into Warehouse and again through Auto cargo.

The local sell-price proposal is 1 gold per `item_ore`, matching the former
starter stone row until the mining economy is intentionally rebalanced.

The Main Character is exclusive while `AUTO_CONTROLLED`: direct production starts
and manual crop production are refused at the API/settlement boundary, while Shop,
Warehouse reads and cargo unload remain available. Auto movement is server-anchored;
the client cannot settle a mine beat before the recorded arrival. A clear Stop
returns control to the player, abandons an unfinished walk without teleporting, and
leaves completed cargo/rewards intact. The Main Character's Auto timeline carries a
finite 180-second lease renewed at most once per 60 seconds by online Auto requests; mining settlement
compares the simulated event time to that lease, so a late reconcile does not pay beyond expiry.

## Legacy safety

`item_stone`, `item_copper_ore`, `item_coal`, `item_iron_ore` and their old
resource definitions remain registered for already-recorded actions, receipts,
inventory, warehouse costs and idempotent replay. They are not active nodes and
are not returned by the runtime resource catalogue for new starts. No inventory,
ledger, receipt or D1 row is converted by this change.

There is no remote migration in this change. Existing production bindings that
explicitly target a retired mining definition need a separately approved local
compatibility/migration plan before they are reactivated; this avoids silently
granting both legacy and unified outputs.

## Visibility/access evidence

Before the change, the API returned `node_stone_ridge`, the scene resource group
was attached to the HOME scene, and the existing resource GLB loader/picker path
was live. Its authored position `(12, -12)` was on the western volcano flank,
well away from the north road and outside the default camera frame around the
owned starter parcel. This was a discoverability/placement failure, not a
missing-model failure.

The active position is on walkable volcano slope ground, keeps the existing
interaction radius, and is outside the farm field, buildings and road cell.
The Work Area validator and the runtime resource catalogue use the same
`MINING` capability, so the visual target cannot be assigned on non-mining
ground.
