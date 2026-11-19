# Ships, voyages and naval combat

Status: W5a is built (ships and timed voyages). W5b to W5d are designed here and not started.

The owner's vision (2026-11-18): naval battles, with ships firing at each other on the sea, so that
players meet one another out there. The world map (`docs/design/WORLD_MAP.md`) gives the sea its
places; this document gives it ships.

## Owner decisions (2026-11-19)

| Question | Decision |
|---|---|
| How fights play | **Realtime**: steer the ship and fire broadsides; the server decides every hit |
| Who fights | **Pirates (PvE) first**, other players (PvP) later |
| What losing costs | **The ship is damaged** and costs materials to repair. Nothing is taken from the warehouse or the island |
| Ships and travel | **Ships are built at the dock**, and going far takes time |

## Owner decisions (2026-11-19, second round)

- **Seeing the sea:** other players' ships are shown sailing on the chart and the horizon.
- **Pirates:**
  - They ambush a player's voyage at random places.
  - There are also a few **pirate lairs**: dungeon-like places where several players fight pirates
    together.
  - Later, **sea monster** grounds are fought the same way, together.
- **PvP is open world.** Everyone may fire on everyone. The brake is **PK points**: a player who
  sinks many ships gains PK points, and a player with PK points loses more when sunk. The exact
  mechanism is to be worked out with the owner before it is built.
- **Cloudflare requests are kept low**: no polling, nothing a client can compute itself is asked of
  the server, and new data rides on reads the game already makes.

## The plan that follows from it

1. **Ships at sea, seen (W5b-lite).**
   - The chart's and the archipelago's existing reads also carry the voyages in the reader's charted
     world.
   - Each client computes where every ship is from its departure and arrival times, and animates it
     locally. No new request.
2. **Pirate ambushes (W5c).**
   - The server decides, when a voyage starts, whether and where on the way pirates strike. This rides
     on the request that starts the voyage.
   - The fight is played in realtime on the player's device with a **deterministic simulation shared
     by client and server** (`packages/domain`). The device records only the player's inputs.
   - One request submits them, and the server replays the fight from the same seed to decide hull
     damage and the result. The client never reports a hit or a winner.
3. **Pirate lairs, sea monsters, open-world PvP with PK (later).** These need several players in one
   fight at the same moment, so they run in a Durable Object per lair or sea area. The object steps
   the same simulation the solo fights use.

## W5b-lite: ships at sea, seen (built)

- `GET /world/chart` (for an island with a place) and `GET /world/archipelago` now also carry
  `voyages`: every voyage under way (arrived or not) from or to a place in the reader's charted world,
  at most 200, newest first. Each carries:
  - from and to;
  - the ship's tier;
  - departure and arrival time;
  - the voyager's island name, never a player id;
  - whether it is the reader's own.
  Both reads also carry `readAt`, the server time.
- The client works out where each ship is (`chartShips`, `horizonShipPose`), by the server's clock,
  and moves it itself:
  - on the chart, once a second while the chart is open, laid over a cached drawing of the chart;
  - on the horizon, on the scene's ambient tick.
  No request is made for movement, and no polling.
- A voyage the player starts is shown by reading the archipelago once more; everyone else's ships
  appear on the next chart or archipelago read the game already makes.
- Migration 0048 adds two partial indexes on `ship_voyages` (from, to; where under way) for this read.

## W5c: pirate ambushes (server built; client next)

- **When pirates strike.**
  - `planAmbush` (game data) decides, when a voyage starts, whether pirates strike and when, between
    30% and 70% of the way. It also picks the seed and who attacks.
  - The chance is the voyage's length × 1/2000, capped at 50%: about 12% to a neighbour, about 40% to
    another archipelago.
  - The roll is fixed by the player, the route and the day, so calling the ship home and setting out
    again changes nothing.
  - Rowboats carry no guns and are never ambushed.
  - Parties grow with the ship's tier: cutters for a sloop; raiders or two cutters for a brig;
    corsairs for a frigate.
  - All of these numbers are a first proposal, in `packages/game-data/src/pirates`.
- **The fight.**
  - `GET /ships/fleet` and the voyage replies carry `voyage.ambush`: when it strikes, its status, and
    the exact simulation setup (seed, the player's ship with its current hull, the pirates).
  - The device plays it live and submits its inputs with `POST /voyages/ambush { inputs: [[tick,
    action], …] }` (at most 3,600). The server refuses before the strike (`AMBUSH_NOT_READY`), replays
    the fight, and writes the outcome and the ship's hull in one guarded batch.
  - A second submission answers with the decided outcome and takes no inputs.
  - The ambushed ship starts still with its sails struck, so a captain who gives no orders is sunk.
    Ignoring a fight is never a way out.
- **Before the fight is fought:**
  - a visit (`AMBUSH_PENDING`) and an onward voyage are refused;
  - calling the ship home plays the fight out with no orders, and its damage stands.
- **Losing.**
  - The ship is towed home with its hull at 0, and cannot sail (`SHIP_DAMAGED`) until it is repaired.
  - `POST /ships/repair { requestId }` costs 2 gold and 0.25 wood per missing hull point (proposal).
    It goes through the ledger as `SHIP_REPAIR`, in the same guarded batch as a build, and is
    idempotent.
- **Rewards for a win** are not given yet: that is an economy decision for the owner.
- Migration 0049 adds the voyage's ambush columns.

## Phases

| Phase | What ships | Server work |
|---|---|---|
| W5a (built) | A ship per player, built a class at a time; voyages that take time; a visit needs the ship there | migration 0047, `GET /ships/fleet`, `POST /ships/build`, `POST /voyages`, `POST /voyages/end` |
| W5b | The sea in realtime: a sea area you sail your ship around, other ships in sight | a Durable Object per sea area, a WebSocket protocol, server-authoritative movement |
| W5c | Pirates: broadsides, hits, hull damage, sinking, repair at the dock | combat rules in the domain, `SHIP_REPAIR` through the ledger (the reason exists since 0047), rewards |
| W5d | Players at sea: duels, then open waters | consent rules, matchmaking or zones, anti-cheat |

## W5a: ships and voyages (built)

### Ships

- One ship per player. With no stored row, the player has the dock's **rowboat** (class 1), which
  costs nothing, so everyone can sail to their neighbours from the start.
- Each next class is **built at the dock** and replaces the one there. Gold goes through the economy
  ledger (`SHIP_BUILD`, referencing `ship_<player uuid>`). Wood and ore go through the inventory
  service. All of it, the ship row and the receipt are one batch, guarded like the mine upgrade.
- A ship away from its dock cannot be rebuilt (`SHIP_AT_SEA`).
- The classes are game data (`packages/game-data/src/ships`). The numbers below are a **first
  proposal** for the owner to confirm or tune:

| Class | Level | Cost | Speed (tiles/min) | Hull | Cannons |
|---|---|---|---|---|---|
| Rowboat (`ship_class_rowboat`) | 1 | free | 40 | 60 | 0 |
| Sloop (`ship_class_sloop`) | 10 | 800 gold, 150 wood, 60 ore | 70 | 150 | 2 |
| Brig (`ship_class_brig`) | 25 | 3,000 gold, 500 wood, 300 ore | 100 | 320 | 6 |
| Frigate (`ship_class_frigate`) | 45 | 12,000 gold, 1,600 wood, 1,200 ore | 130 | 600 | 12 |

### Voyages

- A voyage goes from where the ship lies (its dock, or the place its last voyage reached) to a place
  on the player's own chart. It takes the chart distance divided by the ship's speed, never less than
  a minute. The client names only the place.
- Nothing ticks. The row stores when the ship left and when it arrives, and "arrived" is read from
  server time. A ship still at sea cannot set out again (`VOYAGE_UNDERWAY`).
- **Home** ends the voyage, and the ship is at its dock at once. Sailing home in real time belongs to
  W5b.
- **A visit needs the ship there.** `POST /world/visit` is refused (`VOYAGE_NOT_ARRIVED`) unless the
  player's voyage has arrived at that place. Home is always visible.
- A retried `POST /voyages` with the same `requestId` answers with the voyage it started.

### In the client

- The chart window shows the ship on one line (class, speed, hull) and, while the ship is at its
  dock, a button to build the next class with its price and level.
- A tapped place offers:
  - **Set sail · ~N min**, an estimate from the chart distance and the ship's speed (the server's time
    is the one kept);
  - **Visit**, where the ship lies;
  - nothing on home.
  While the ship is at sea, the button only says so.
- The voyage shows in the activity tray: a countdown to arrival, then "Arrived at …, tap to look
  around". Tapping it opens the visit view. Leaving the visit view brings the ship home
  (`POST /voyages/end`).
- Files: `apps/web/src/sea-chart-modal.ts` (`placeAction`, `describeFleet`),
  `apps/web/src/activity-tray.ts` (the `VOYAGE` card), and `main.ts` (`refreshFleet`, `setFleet`,
  `voyageActivity`).

## W5b to W5d: the sea and its fights (design only)

- **Realtime sea (W5b).** Each sea area is a Durable Object. Players connect over an authenticated
  WebSocket and send *intent* only: rudder, sails, fire this side. The object steps the simulation at
  a fixed rate, owns every position, and broadcasts validated state. The client draws and predicts,
  but decides nothing.
- **Combat (W5c).**
  - A broadside is fired by the server along the ship's side, with its class's cannons.
  - Hits are computed by the server from its own positions, never reported by a client.
  - Hull falls to zero and the ship is towed home damaged: no loss of goods.
  - Repair costs gold (the `SHIP_REPAIR` ledger reason, already in the ledger) and materials, scaled
    by the damage.
  - Pirates are server-run ships with simple behaviours.
- **PvP (W5d).** Only after PvE is balanced. Consent and fairness rules are an owner decision to come
  (duels, opt-in flags, or zones).
- **Rewards.** Pirate loot is an economy decision for the owner. Until then a win gives experience and
  nothing else.

## Security notes

- The client never sends a class, a price, a time, a position (in W5a), a hit, or a hull value.
- Builds are idempotent per `requestId`, race-safe (the ship row is written only over the tier and
  version read), and audited in the ledger.
- Voyages are written only over the version read. A second voyage cannot start while one is under
  way, and a replay is answered rather than repeated.
