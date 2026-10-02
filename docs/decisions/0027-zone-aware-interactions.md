# 0027 - Gameplay interactions are zone-aware, and player-owned state is not a location

Status: accepted (V14.1).

## Context

The game was built around one sentence: *a player owns a farm, and everything happens on it*. Every
read and every command names a farm, ownership is the only authorization rule, and the client resolves
"where am I?" as "which farm did I load?".

The product direction is larger than one farm: a world map, regions, home islands, visitable islands,
shared fishing grounds, shared resource zones, contested territory, travel and events. In that world a
player *is present in* a place rather than *owning* it, two players can stand in the same place with
their own inventories, and "may I do this?" depends on the place's rules as much as on who is asking.

Rewriting the current game around that model now would be speculative churn: none of those systems
exists, and migrating live farm rows into world tables would risk real data for a design that has not
been played yet.

## Decision

1. **A location is not an authorization.** A zone reference is a descriptor - a kind and an id - with
   no owner, no role and no permission, and receiving one from a client grants nothing. Every command
   is still authorized server-side from the authenticated actor against the resource it names.
2. **Player-owned state stays on the player and the farm.** Zones hold place-state, not player
   progress. There is no island table, no second copy of a farm, and no migration of existing rows.
3. **The current farm *is* the current `HOME_ISLAND` zone, by adapter.** `homeIslandZoneRef(farmId)`
   derives one from the other, and the reverse lookup is a lookup rather than a permission.
4. **Interaction is split into discovery and execution.** Discovery asks what is near the player and
   never mutates; execution takes an intent to the server. The executor must not assume that the actor
   owns the zone that contains the target, because a shared or contested zone will not authorize that
   way.
5. **Two actions ship as the proof**: `INSPECT` (uses the existing authoritative rows, sends nothing)
   and `HARVEST` (the existing server-authoritative command, unchanged).

## Consequences

* The current game keeps working exactly as it did: one farm, one island, no new tables, no new
  endpoints, no change to economy, inventory or authorization.
* Adding a shared zone becomes a change of *authorization rules* rather than a rewrite of discovery:
  the same "what is in reach" code, a different server-side answer to "may I".
* A no-command-has-a-location rule is now testable: a request carrying a `zoneId` is rejected as
  invalid input rather than silently ignored (`tests/api/handler.test.ts`).
* Cost: one more concept (a zone) in the codebase before a second zone exists, and a
  `GameplayContext` that today only ever resolves to one kind. Accepted deliberately: the concepts are
  what stop the next gameplay pass from hard-coding the farm as the world.

## Alternatives considered

* **No abstraction yet - keep "farm" everywhere.** Rejected: every interaction added in V14 would have
  to assume ownership, and the shared-world passes would each have to unpick the previous one.
* **Build the world map and zone tables now.** Rejected: speculative persistence, a migration risk on
  live staging data, and no gameplay benefit in V14.1.
* **Let the client send a zone and trust it for range/authorization.** Rejected outright: a client can
  lie, and location would become a capability.

See `docs/design/WORLD_ARCHITECTURE.md` and `docs/design/INTERACTION_SYSTEM.md`.
