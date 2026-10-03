# Fishing

Status: V15.1, foundation. Fishing is the first profession that does not happen on the farm: the player
walks to water, casts, waits, and the **server** decides what they caught. This document is the
architecture; the numbers are in `docs/design/FISHING_BALANCE.md`.

## Why it exists beyond the feature

Before V15.1 every reward in the game came out of a farm row. Fishing is the proof that the architecture
is not "farm = entire game": it is a Player -> Zone -> system shape that happens to run on the island
today and will run on shared water later. The pieces that make that true are small and deliberate:

- a fishing action belongs to the **actor**, never to a farm;
- it names the **zone** it happened in, explicitly;
- progression is the existing **player** level, not a farm level and not a new profession system;
- the catch is chosen from a **catch table**, so a new water is data rather than code.

## Zone relationship

```text
Player  ->  Zone (kind, zoneId)  ->  FishingSpot  ->  FishingTable  ->  Fish
```

A spot declares `zoneKind: HOME_ISLAND`. At settlement time the server resolves *the actor's own* home
island zone through `HomeIslandZoneResolver` (`zone_home_island_<farmId>` today) and refuses a spot whose
kind is not that zone's kind. The client never sends a zone, and the spot is never assumed to be the
player's.

That is the seam a shared ground uses later: a `SHARED_FISHING` spot resolves a different zone through a
different adapter, and the start/settle/cancel use cases do not change. None of that is implemented -
there is no shared zone, no presence, no depletion, and no second zone kind in use.

## The spot

A **FishingSpot** is the smallest authoritative thing in the water:

| Field | Why |
| --- | --- |
| `id` (`spot_pond_north`) | A stable name the command carries and the server validates |
| `displayNameKey` | The name the interaction prompt shows |
| `zoneKind` | Which kind of zone the spot is in (explicit, never implied) |
| `position` | Fractional tile coordinates - the client converts them with the one world frame |
| `interactionRadiusTiles` | How far the *client* offers the interaction |
| `tableId` | The catch table this water draws from |
| `enabled` | An operator can close a spot without removing it |

Spots are **static game data** (`packages/game-data/src/fishing/index.ts`), not rows. Home Island's water
is authored, the spots do not move, and nothing depletes, so a table would be a second copy of the map.
The boundary: a spot that becomes shared or depletable gets *its own* zone state later; this catalogue
does not grow a column to pre-empt it.

There are four spots today: three on the island's pond bank (freshwater) and one in the sea off the
harbour quay (coastal). Each was checked against the real terrain - the spot sits in water with walkable
ground within a metre or two, so the character can stand on the bank and reach it.

## Interaction

Fishing is **Character** gameplay and reuses the V14.1 interaction system end to end:

```text
walk near water -> registry finds the spot -> prompt shows "[E] Fish" -> press -> server command
```

- The spot is adapted into an ordinary `InteractableTarget` (`kind: FISHING_SPOT`, `action: FISH`) and
  bucketed by the cell it falls in, so discovery is the same bounded neighbourhood scan every other
  target uses. There is no fishing-only proximity scanner and no per-frame coastline walk.
- `interactionActivation` turns it into `{ kind: "FISH", spotId }` after re-asking discovery, so a
  stale prompt activates nothing.
- Estate view does not offer fishing. The spot may be visible from above, but fishing is not a
  precision management action and no Fishing control exists in the module rail.

## Action lifecycle

```text
IDLE -> (POST /fishing/start)  ACTIVE  -> (POST /fishing/:id/settle)  SETTLED -> IDLE
                              \
                               -> (POST /fishing/:id/cancel)  CANCELLED -> IDLE
                                     or walking away
```

There is no cast animation state machine and no per-second write. One row per attempt records the actor,
the zone, the spot, the table, the two timestamps and a status; the wait itself is a comparison.

## Authority

| Fact | Owner |
| --- | --- |
| Which fish is caught | Server (`selectCatch` over the table, with a server roll) |
| When a catch is claimable | Server (`ready_at` against the server clock) |
| How much experience | Server (the fish definition) |
| Whether the player may fish here | Server (actor -> zone -> spot) |
| Where the character is standing | **Client** (presentation only - see below) |

The client's start command carries `{ requestId, spotId }`. The settle command carries
`{ requestId, expectedActionVersion }`. Neither carries a fish, a quantity, a price, an experience
amount, a zone, or a duration; the request schemas are strict, so an extra field is a refusal rather
than a silently ignored hint.

### Position-trust limitation (documented, not hidden)

Character movement is still **client-side**. The client decides what is in reach and sends the intent;
the server validates the *spot*, the *zone*, the *action state* and the *clock*, but it does not verify
that the character was standing at the water. So V15.1 has:

- authoritative **what** and **when** (spot, zone, table, reward, time, idempotency);
- client-asserted **where** (there is no presence record to check against).

This is honest for a single-player island, and it is exactly what a future shared or competitive zone
has to fix: presence (a Durable Object or a validated movement stream) is the missing piece, and it is
deliberately not faked here. The server still refuses an unknown spot, a closed spot, a spot in another
zone kind, an early settle, a replayed settle, a foreign action and a malformed body.

## Server time

`started_at` and `ready_at` are written by the server from its own clock
(`fishingReadyAt(startedAt, FISHING_ACTION_SECONDS)`). A settle compares `ready_at` with the server's
current time; the client's countdown is presentation. There is no way to start and immediately settle,
and no client timer is trusted. Tests move the injected clock; nothing sleeps.

## Idempotency, concurrency and replay

- **Start** is idempotent on `(actor, FISHING_START, requestId)`: the receipt is written with the action
  in one batch, so a replay returns the same action. A second *live* attempt is refused
  (`FISHING_ALREADY_ACTIVE`) and the database reinforces that with a unique partial index on
  `(actor_player_id) WHERE status = 'ACTIVE'`.
- **Settle** is idempotent on `(actor, FISHING_SETTLE, requestId)`. The whole payout - the action
  transition, the fish in the inventory, the experience award and the receipt - is one D1 batch whose
  receipt cannot commit unless the action actually moved to `SETTLED` at the expected revision, the
  experience row is where the caller read it, and the stack has room. A replay returns the stored catch
  and pays nothing; two simultaneous settles produce exactly one reward.
- **Cancel** is idempotent on `(actor, FISHING_CANCEL, requestId)` and moves the same row with the same
  guard. Cancelling a settled action is refused rather than ignored.

## Refresh, disconnect and cancel

The attempt is durable, so a refresh does not lose it: the page reads `GET /fishing/active` once at load
(one indexed row) and, if the server says the attempt is live, resumes the wait and settles it when the
server's own `readyAt` passes. If the wait already elapsed while the page was closed, the settle simply
succeeds on the spot.

Walking more than 2.5 m from where the cast started cancels the attempt: no fish, no experience, and the
action is closed so a late settle is refused. Cancel is best-effort on the wire - if the request fails
the attempt stays live until it is settled or cancelled later - but it can never pay out a cancelled
action, because the server's state, not the page's, is what a settle checks.

## Randomness

The roll is a port. Production uses `CryptoFishingRandom` (platform entropy, rejection-sampled so the
value is uniform over `[0, 1)`); tests inject a scripted sequence. The *selection* is a pure domain
function over integer weights (`selectCatch`), so a table is reviewable and a result is reproducible
without `Math.random` anywhere in the logic.

## Money and experience

- A caught fish is an ordinary inventory item in the `FISH` category, sold through the **same** market
  and the same economy settlement as produce. There is no fishing economy.
- Experience is the existing player progression, awarded only when the catch settles, through the same
  `createXpAward` + guarded update the harvest uses. Starting, cancelling, failing and opening the
  catalogue pay nothing.
- "Farm Market" is a slightly narrow name for a shelf that now buys fish. The UI is deliberately not
  redesigned; a future **Harbour Market** (a different stall, a different shelf) is the natural split
  and is recorded here rather than pre-built.

## Deliberately absent

No energy, stamina, bait, rods, hooks, reels, durability, boats, minigame, timing bar, fish fighting,
shared grounds, depletion, rare events, regions, weather, seasons, or fisherman skill tree. The catch
table is the extension point for river/lake/deep-sea/regional/rare fishing, and `zoneKind` is the
extension point for shared water.
