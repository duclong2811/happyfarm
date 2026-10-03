# Forestry

Status: V15.3, foundation. Forestry is the **second consumer** of the V15.2 resource-node lifecycle:
the same domain rules, the same tables, the same use cases, the same settlement - a different verb, a
different drop, a different picture. If it had needed a new lifecycle, the abstraction would have
failed; nothing here is a forestry-specific backend.

The generic lifecycle is `docs/design/RESOURCE_NODES.md`; the numbers are
`docs/design/FORESTRY_BALANCE.md`.

## The three kinds of tree

This is the distinction the phase exists to make explicit, and it is never inferred from appearance:

| | Orchard tree | Decorative tree | Wild forestry tree |
| --- | --- | --- | --- |
| What it is | a **farming** entity on a farm tile | **scenery** the player may edit | a **resource node** in the world |
| Ids | `treeinst_…` (a tree row) | `construct_…` (a construction row) | `node_…` (a resource placement) |
| Lifecycle | sapling → mature → fruit → harvest → regrow | selected, moved, rotated, stored, removed | available → chop → stump → regenerate |
| Verb | `HARVEST` (Character) | Estate selection and editing | `CHOP` (Character) |
| Pays | the fruit and its XP, through the harvest settlement | nothing | wood/hardwood/resin and its XP, through the resource settlement |
| Table | `tree_instances` | `farm_constructions` | `resource_node_states` + `resource_actions` |

Two consequences are tested rather than asserted:

- **An orchard tree cannot be chopped.** Its id has no `node_` shape, so a resource command naming it
  is refused by the request schema before any lookup; and the interaction layer offers `HARVEST` on a
  production tree, never `CHOP`. The harvest lifecycle is untouched.
- **A decorative tree cannot be turned into a reward.** Sending a construction's id to the resource
  API is refused the same way, and moving or deleting a scenery tree cannot move or delete a deposit
  or a wild tree, because they are different rows in different tables.

## Gameplay

```text
explore the island's woods -> [E] Chop -> wait 5-11s -> wood/hardwood/resin + XP
                                                              |
                                       server clock passes availableAt -> the tree returns
```

Twelve wild trees stand in the island's two woodland masses (`wood_north` and `wood_east`), in fixed
positions checked against the real terrain and kept at least four tiles from every mining deposit, so
a player never finds two kinds of node inside one interaction range.

## Interaction and authority

Forestry reuses the V14.1 interaction system end to end: a node is an ordinary target whose action is
the definition's verb, cell-bucketed and ranged like everything else. An available tree offers
`[E] Chop`; a felled one offers only `Inspect` with the server's own countdown. The Estate view draws
the trees but offers no Forestry control, and a wild tree cannot be moved as if it were scenery.

| Fact | Owner |
| --- | --- |
| The verb | the node **definition** (`CHOP`), never the client |
| Availability | the server (`available_at` vs its clock) |
| Level requirement | the server |
| Material, quantity, XP | the server (the drop table and the definition) |
| Depletion and regeneration | the server |
| Where the character is standing | the client (presentation only) |

The start command carries `{ requestId, nodeId }`; a `verb`, an item id or a quantity in the body is a
schema refusal. The position-trust limitation documented in `FISHING.md` and `MINING.md` applies
unchanged.

## Visuals

Each wild tree is one generated model - a broadleaf, a resin pine, and a taller hardwood - that reads
as uncultivated next to the orchard's tidy models. A felled tree draws its **stump** model, named by
the definition's `depletedModelId`; mining deposits leave that absent and the renderer shrinks them
instead, which is the whole of the difference and is data.

## Inventory, market and progression

- Wood, hardwood and resin are ordinary `MATERIAL` items in the same inventory, with the existing
  Materials tab and the existing picture pipeline (a card draws the tree the material came from).
- They sell through the same market and the same economy settlement as produce and ore, at provisional
  prices (1-3 gold). Selling raw wood is early liquidity, not its purpose.
- Experience is the existing player progression, awarded only when the chop settles. There is no
  forestry skill, no axe, no tool tier and no durability.

## Boundaries this phase deliberately keeps open

- **Warehouse.** Inventory is storage today. A later economy phase introduces finite capacity; the
  settlement already goes through the generic inventory boundary, so nothing here has to change.
- **NPC workers.** Automation will eventually gather without a character animation. The settlement is
  an ordinary use case taking an actor, a node and a request id - the Character interaction is the
  current *initiation*, not the architecture.
- **Economy.** The numbers here are provisional on purpose; see `FORESTRY_BALANCE.md`.
- **World.** A node declares its `zoneKind`, and its state is keyed by `(zone_id, node_id)`, so a
  forest on a wild island or in a shared resource zone is another zone id rather than a rewrite. No
  region table, no world map, no boats.

## Deliberately absent

No crafting (no planks, no sawmill), no equipment, no NPCs, no warehouse capacity, no lumber market,
no world map, no shared forests, and no conversion of the island's existing scenery trees into
resource nodes.
