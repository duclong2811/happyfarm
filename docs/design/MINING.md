# Mining

Status: V15.2, first playable slice. Mining is the second Character profession: walk to a deposit, hold
the interaction, and the **server** decides what comes out and when the deposit returns. The generic
lifecycle is `docs/design/RESOURCE_NODES.md`; the numbers are `docs/design/MINING_BALANCE.md`.

## The loop

```text
explore the volcano flank -> [E] Mine -> wait ~6-13s -> material + XP -> node depleted
                                                                          |
                                          server clock passes availableAt -> node returns
```

## Where the deposits are

Nine nodes on the volcano's flank and foothill, in fixed positions verified against the real terrain
(walkable ground, away from the starter parcel):

| Node | Definition | Position (tiles) |
| --- | --- | --- |
| `node_stone_ridge` | stone | 12, -12 |
| `node_stone_west` | stone | -3, -23 |
| `node_stone_south` | stone | 20, -30 |
| `node_copper_east` | copper | 24, -23 |
| `node_copper_north` | copper | 4, -16 |
| `node_coal_west` | coal | -2, -24 |
| `node_coal_deep` | coal | -3, -27 |
| `node_iron_west` | iron | -2, -28 |
| `node_iron_north` | iron | 12, -10 |

They are **not** the island's decorative rocks. Scenery stays editable scenery - selectable, movable,
storable, deletable in Estate view - while a resource node is a gameplay entity with its own id, its own
state row and its own verb. Moving a rock cannot move a deposit, and deleting a rock cannot delete one.

## Interaction

Mining is **Character** gameplay and reuses the V14.1 system: the node is adapted into an ordinary
interaction target whose `action` is the node definition's verb, bucketed by cell and ranged like
everything else. An available deposit offers `[E] Mine`; a depleted one offers only `Inspect`, with the
server's own countdown, exactly as a growing crop does. There is no mining proximity scanner and no
Mining control in the Estate rail.

The verbs are data. A definition that says `CHOP` produces a Chop prompt through the same code, which is
the seam forestry lands in.

## Authority

| Fact | Owner |
| --- | --- |
| Whether the node is available | Server (`resource_node_states.available_at` vs the server clock) |
| Whether the actor may mine it | Server (actor -> zone, and the definition's level) |
| Which material and how much | Server (the definition's drop table, drawn with the server's entropy) |
| Experience | Server (the definition) |
| Depletion and regeneration | Server |
| Where the character is standing | **Client** (presentation only) |

The start command carries `{ requestId, nodeId }`; the settle carries `{ requestId, expectedActionVersion }`.
Neither carries a material, a quantity, an experience amount or a cooldown, and the schemas are strict, so
an extra field is a refusal rather than a hint.

### Position-trust limitation

Unchanged from V15.1, and stated plainly: character movement is client-side, so the server validates the
node, the zone, the level, the node's state and the clock, but it does not verify that the character was
standing at the rock. A shared or contested resource zone has to add presence authority first; that is a
deliberate later phase, not something this slice pretends to have.

## Server commands

```text
GET  /resource-nodes                     the catalogue: placements + the actor's zone's availability
GET  /resource-actions/active            the actor's live gather, or null (resume after a refresh)
POST /resource-actions/start             { requestId, nodeId }
POST /resource-actions/:actionId/settle  { requestId, expectedActionVersion }
POST /resource-actions/:actionId/cancel  { requestId, expectedActionVersion }
```

The routes are deliberately node-generic rather than `/mine/...`: forestry's chopping is the same
resource action with a different verb, and no shipped API is speculative - every route has a caller
today.

## Time, cancel and refresh

- `started_at` and `ready_at` are stamped by the server; a settle compares `ready_at` with the server
  clock, so start-then-immediately-settle is refused. The client's countdown is presentation.
- Walking more than 2.5 m from where the swing started cancels the gather: no material, no experience,
  **and no depletion**, because only a settlement spends a deposit.
- A refresh resumes a live gather from `GET /resource-actions/active` (one indexed row) and settles it
  when the server's `readyAt` passes.

## Inventory and market

- A mined material is an ordinary `MATERIAL` item in the same inventory, with its own tab, drawn with the
  deposit's own model so the card shows the rock the ore came from.
- Raw materials sell through the **same** market and the same economy settlement as produce, at
  deliberately conservative prices (1-4 gold). They are the inputs crafting and building will want, so
  selling is early cash rather than obviously the best use of them. The name "Farm Market" is now a
  little narrow; a future segmentation (harbour market, material trader) is recorded rather than
  pre-built.

## Experience

Mining awards the existing player progression through the same settlement the harvest uses, and only when
the gather settles. Starting, cancelling, a refused early settle and an attempt at a depleted node all pay
nothing.

## Deliberately absent

No pickaxe, tool tiers, durability, repair or equipment; no energy or stamina; no crafting; no ore rarity
ladder; no mining minigame; no vein depletion across a region; no shared resource zone; no boats or world
map. The drop table supports weighted multi-entry tables and quantity ranges already, so richer deposits
are data rather than code.
