# World architecture: world, region, zone, presence

Status: the direction and the contracts, written in V14.1. **Nothing in this document is a system that
exists yet** beyond the first line of it - one farm is one `HOME_ISLAND` zone - and the point of
writing it down now is that the gameplay passes of V14-V17 must not be able to hard-code "the world is
the player's farm" by accident.

Read this before adding anything that assumes a player owns the place they are standing in, before
adding a second island table, or before writing an authorization rule that starts from a location.

## The hierarchy

```text
World
  |
  +-- Region (0,0)            a chunk of the map; the unit the client may ever load
  |     +-- Zone: Home Island of player A
  |     +-- Zone: Home Island of player B
  |     +-- Zone: Fishing Ground #12
  |
  +-- Region (0,1)
  |     +-- Zone: Resource Island #3
  |     +-- Zone: Central Port
  |
  +-- ...

Presence:   player X is in zone Z
Interaction: player X uses target T in zone Z
```

Five words, and the distinction between them is the whole document:

| Word | What it is | Today |
| --- | --- | --- |
| **Player** | The durable gameplay owner: wallet, inventory, progression, and the farms they own. | Exists (`players`). |
| **Farm** | Persistent farm state - land, tiles, crops, trees, built things - owned by a player. | Exists, one per player. |
| **Zone** | A place where gameplay happens. A zone is *inhabited*, not owned. | Conceptual: one farm *is* one `HOME_ISLAND` zone, by adapter. |
| **Presence** | Which zone a player is currently in. | Not implemented; today it is implied by "the player's own farm". |
| **Interaction** | Something a present player can do to a target in that zone. | V14.1: `docs/design/INTERACTION_SYSTEM.md`. |

The current `ZoneRef` is two fields - a kind and an id - and it carries no owner, no role and no
permission. That is deliberate, and it is the invariant this architecture exists to protect:
**a location is not an authorization.**

## Zone kinds

The vocabulary is fixed now (`ZONE_KINDS` in `packages/contracts`) even though one entry is in use,
because the *names* are what make the future readable in code review:

| Kind | Meaning | Status |
| --- | --- | --- |
| `HOME_ISLAND` | The island a player's farm is on. Authorized by farm ownership. | In use |
| `PLAYER_ISLAND` | Another player's island, visited. Authorized by permission granted by its owner. | Named only |
| `SHARED_FISHING` | A fishing ground several players share. Authorized by presence and resource state. | Named only |
| `SHARED_RESOURCE` | A shared gathering area - wood, stone, ore. | Named only |
| `CONTESTED` | A zone whose control is in question, with an ownership window or a contest state. | Named only |
| `PORT` | Travel, trade, and the hub between regions. | Named only |
| `EVENT` | A time-boxed place: a festival, a seasonal competition. | Named only |

Nothing reads the unused kinds. They are a contract: a reader should be able to see what is coming, and
a future pass should be able to add a zone without renaming anything.

## What belongs to whom

| Belongs to | Examples | Persistence |
| --- | --- | --- |
| **Player** | wallet, inventory, progression, identity links, owned farms | permanent |
| **Farm** (owned by a player) | tiles, crops, trees, constructions, storage | permanent |
| **Zone** | zone identity and kind, its rules, its resource state, its contest state | permanent for home islands; resource state may be seasonal or reset |
| **World** | the map, the region grid, the zone catalogue, event definitions | permanent, authored |
| **Presence** | which player is in which zone | ephemeral - a session fact, never a durable record of ownership |

The rule that follows from this table: **durable player progress lives on the player and the farm;
places hold place-state.** A fishing ground does not hold a player's fish, a contested island does not
hold a player's buildings, and no zone row may ever become the authoritative copy of a farm's rows.

## Regions, and why the client must never see the whole world

The world map is spatially partitioned into regions (chunks). A region holds a bounded set of zones,
and a client is only ever told about the region it is in plus whatever it can see from it.

```text
World
  Region(rx, rz)   a chunk of the map
    Zone(s)        bounded in number by the region
```

The reason is not elegance, it is arithmetic: at a few hundred players, "every island" is a query no
client can afford and no Worker should answer. Every future map read - "what is near me", "what
regions are populated", "which zones in this region are open" - must be answerable from the region,
and the answers must never require walking the world.

Not built yet: no region table, no coordinates, no spatial queries. The contract V14.1 pins is only
that a zone is addressed by `(kind, zoneId)` and that its *region* will be a property of the world
map, not of the gameplay code that happens to live in it.

## Home Island today

```text
player logs in  ->  their farm  ->  HOME_ISLAND zone  ->  presences and interactions resolve inside it
```

`homeIslandZoneRef(farmId)` derives the zone from the farm and `farmIdFromHomeIslandZone` maps it back.
Two rules about that pair:

1. **The farm is the source of truth.** There is no island table, no second copy of the land, and no
   migration of existing farm rows into speculative world tables. Deriving the zone is what keeps the
   current game exactly as it was.
2. **The reverse lookup is a lookup, not a permission.** `farmIdFromHomeIslandZone` says *which* farm
   was meant. It says nothing about who may act on it. Every command is still authorized server-side
   from the authenticated actor against the farm's own rows, exactly as before.

When the world map arrives, a home island becomes one zone among many and this pair becomes the adapter
that already exists, rather than the assumption that has to be unpicked.

## Presence

```text
PlayerPresence { player, zone }
```

Presence is *where a player is*, and it is the thing that makes a shared zone possible: two players can
stand in one fishing ground while remaining two players with their own inventories.

Not implemented in V14.1, and deliberately not faked. Today presence resolves to "the player, and their
own home island", which is exactly what the current code does implicitly. A shared zone will need
server-side presence - a durable object or a Durable Object, a decision for that phase - because
"everyone in this zone" is a server question. The client must never be the authority on who is present,
for the same reason it is never the authority on what it owns: it can lie.

## Shared zones: authorization stops being ownership

This is the main reason V14.1 exists.

```text
HOME ISLAND                     SHARED ZONE
  actor owns farm                 actor is present in zone
  -> allowed by ownership         resource node is present and unexhausted
                                  zone rules allow this action
                                  competition rules allow it right now
```

Interaction *discovery* and *execution* are separated (see `INTERACTION_SYSTEM.md`) precisely so that
the question "what is near me?" has one answer everywhere, while "may I do this?" stays a server
decision that changes per zone kind. An executor written around "the actor owns the farm that contains
the target" would have to be rewritten the day a fishing ground opens; an executor that sends an intent
and lets the server decide does not.

## Contested zones (documented only)

```text
Player A  ---.
              >--- same zone ---> resource node
Player B  ---'
```

A contested zone's authorization may depend on zone state, an ownership window, the current contest,
teams, cooldowns or resource availability. None of that is decided here, and none of it is built. What
V14.1 must not do is make it *impossible*: no interaction code may assume that owning the land is the
only way to be allowed to act.

## PvP (documented only)

Combat, if it is ever added, is a different action domain: server-authoritative resolution, a latency
strategy, anti-cheat, and presence synchronization. It is explicitly not part of V14.1, and nothing in
this pass may imply that a client can decide a fight. A client sends an intent; the server decides what
happened.

## Travel, sailing and seasons (documented only)

Travel is a change of presence: a player leaves one zone and arrives in another, and *everything about
them that is theirs travels with them* - the player, the wallet, the inventory, the progression. What
does not travel is the place: a farm stays where it is, and another player's island does not become
yours because you moored there.

Seasons are a property of **places and rules**, not of players: which zones are open, which resources
have respawned, which competition is running. A season ending must not delete a player's farm, wallet,
inventory or progression, because those belong to the player and not to the season.

## Authority boundaries

Server-side, always:

* who a caller is (the session: `docs/design/IDENTITY.md`);
* what they own and what they have (wallet, inventory, progression, farm rows);
* whether they may act on a zone and on a target;
* every economy, inventory, ownership, progression and settlement outcome;
* what a zone contains, who is present, and what a shared or contested zone allows.

Client-side, never authoritative:

* where the character is standing (client-local presentation);
* which target is nearest (a convenience: the server re-checks the action);
* the zone it believes it is in (a descriptor; it grants nothing);
* the outcome of any interaction.

## What V14.1 actually ships

* The vocabulary above, in `packages/contracts` (`ZONE_KINDS`, `ZoneRef`, `homeIslandZoneRef`,
  `farmIdFromHomeIslandZone`).
* A client `GameplayContext` that keeps the player and the place apart
  (`apps/web/src/interaction/context.ts`).
* An interaction framework whose execution path does not assume farm ownership
  (`docs/design/INTERACTION_SYSTEM.md`).
* Tests that pin the boundary: the current farm resolves to one `HOME_ISLAND` zone, the zone carries no
  player, a shared zone never resolves back to a farm, and no command has a field for a location.

No world map, no region table, no zone persistence, no travel, no boats, no shared fishing, no
resource spawning, no contest, no combat, no presence sync, no matchmaking, no seasons.

## V15.1: fishing uses this vocabulary without extending it

Fishing is the first system to *use* the hierarchy rather than just describe it, and it needed no new
words: four static spots in the player's `HOME_ISLAND` zone, a `FishingSpot` that declares its zone
kind, and an action that stores `zone_kind` + `zone_id`.

- The zone is resolved from the **actor** (`HomeIslandZoneResolver`), never sent by the client.
- No shared, contested, port or event zone exists; the enum is still a contract and nothing more.
- The fishing action row lives on the player, not the farm: the zone *describes where*, it never owns
  the catch.

See `docs/design/FISHING.md`. A shared fishing ground is the first thing that will need presence, and
that is a deliberate V15.x decision rather than something V15.1 pre-built.
