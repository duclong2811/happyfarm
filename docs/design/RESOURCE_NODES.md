# Resource nodes

Status: V15.2. The generic gather lifecycle that mining introduces and forestry reuses. `docs/design/MINING.md`
is the mining-specific view; `docs/design/MINING_BALANCE.md` is the numbers.

## Definition, instance, state

Three layers, deliberately separate, because conflating them is how "a rock" ends up holding a price:

| Layer | What it is | Where it lives | Example |
| --- | --- | --- | --- |
| **Definition** | What a *kind* of deposit is: verb, timings, drop table, model, level | game data (`packages/game-data/src/resources`) | "an iron deposit takes 13s, comes back in 10 minutes, drops 2 iron ore, needs level 6" |
| **Placement** | Which definition stands where, in which zone | game data | "`node_iron_west` is an iron deposit at tile (-2, -28) on the home island" |
| **State** | When *this* node is next available | D1 (`resource_node_states`, keyed by `(zone_id, node_id)`) | "depleted at 11:00, available again at 11:10" |

A node with no state row has never been gathered, which means it is available. State is written lazily
by the first successful gather, exactly as a wallet is written by the first settlement.

Nothing static is duplicated into the state row: no sell value, no drop weight, no timing. A balance
change is a one-line game-data edit and the next read reflects it.

## The lifecycle

```text
AVAILABLE --(start)--> ACTIVE(action) --(settle)--> node DEPLETED until availableAt --> AVAILABLE
                                      \
                                       --(cancel, or walk away)--> node untouched
```

The *action* and the *node* are separate states and separate rows, and that separation is what makes the
rules verifiable:

- the action owns "a gather is in progress, by this actor, against this node, and it becomes ready at X";
- the node owns "this deposit is gone until Y";
- only a settlement moves either forward. A cancel touches the action and nothing else, so giving up
  never costs the island a deposit.

## Persistence

One additive migration (`0017_resource_nodes.sql`), two tables:

- `resource_node_states(zone_kind, zone_id, node_id, available_at, depleted_at, version, timestamps)`,
  primary key `(zone_id, node_id)`. No foreign key to a node: nodes are game data, not rows.
- `resource_actions(action_id, actor_player_id, zone_kind, zone_id, node_id, definition_id, verb,
  status, started_at, ready_at, settled_at, version, timestamps)`, with the actor's live attempt behind
  a partial unique index.

Neither table is farm-scoped, and neither stores anything a definition already says.

## Regeneration

Regeneration is a comparison, not a job:

```text
available = no state row, or available_at <= server time
```

There is no cron, no per-second update and no heartbeat write. A player who mines, closes the game and
returns tomorrow finds the deposit ready because the clock passed the instant, not because anything
ran. The client shows the countdown from the server's own `availableAt`.

## Concurrency

Two independent guarantees, because a node is a finite thing:

1. **One live gather per player**, enforced by a partial unique index on
   `resource_actions(actor_player_id) WHERE status = 'ACTIVE'`. Two simultaneous starts cannot both win.
2. **One depletion per node per window.** The settlement's receipt only commits when the node was still
   available when the batch ran, so if two attempts somehow target one node - two actions, or two
   players in a shared ground later - exactly one depletes it and the other is refused
   (`RESOURCE_NODE_DEPLETED`).

Both are tested, the second by seeding a competing action directly at the storage layer, which is what a
shared zone would eventually produce.

## Zone relationship

A placement declares its `zoneKind`; the server resolves the actor's own zone
(`HomeIslandZoneResolver`) and refuses a node whose kind is not that zone's. The action stores
`zone_kind` + `zone_id`, so nothing in the lifecycle assumes the player's farm.

## Forestry reuse

The whole point of the abstraction is that `CHOP` is a value, not a second system:

| Mining | Forestry |
| --- | --- |
| `verb: "MINE"` | `verb: "CHOP"` |
| a rock model | a tree model |
| drops stone/copper/iron/coal | drops wood, saplings, fruit |
| same start/settle/cancel commands | same commands |
| same node-state table and guards | same table and guards |

The domain, the use cases, the routes, the interaction layer and the settlement are verb-agnostic today;
`tests/web/mining-interaction.test.ts` exercises a `CHOP` node that no shipped content declares, to
pinned that nothing in the interaction layer knows what a rock is.

**A production orchard tree is not a forestry node.** The apple/orange/peach trees are farming lifecycle
entities on farm tiles, grown from a sapling and paid through the harvest settlement. A forestry tree
would be a *wild* node with its own id, position, state row and `CHOP` verb. Nothing in this phase lets
a chop touch an orchard tree.

## Future shared zones

Home Island is the only zone with nodes, and each player's own island has its own state rows because the
key includes `zone_id`. A shared resource ground is therefore the same tables with a different `zone_id`,
plus the presence authority this phase still lacks (see `docs/design/FISHING.md`). Not implemented: no
region, no shared zone, no depletion competition, no respawn scheduler.
