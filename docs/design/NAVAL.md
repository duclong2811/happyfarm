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
    action], [tick, action, aim], …] }` (at most 3,600). The server refuses before the strike
    (`AMBUSH_NOT_READY`), replays the fight, and writes the outcome and the ship's hull in one guarded
    batch.
  - A second submission answers with the decided outcome and takes no inputs.
  - The ambushed ship starts still with its sails struck, so a captain who gives no orders is sunk.
    Ignoring a fight is never a way out. Pirates also ram a ship that lies still.
- **How a fight plays (owner decisions 2026-11-19: realtime, "open-world Gunny").**
  - **Steering:** A/D (or ◀ ▶) rudder; W/S (or − +) three sail settings; Space (or "Chèo nhanh") rows
    a 2-second burst at 1.6× top speed, then the crew rests 10 seconds.
  - **Aiming, Gunny-style:** hold a side's fire (Q/E, or the button) to charge it: the longer the
    hold, the farther the shot, from 20 to 95 units, full after 1.5 s. While holding, Z/C (or sliding
    the finger) swings the aim up to about 35° either side of the beam, and a dashed arc shows where it
    will fall. Letting go fires. The camera swings over the other beam while aiming, and stays a moment
    after, so the whole reach is in view.
  - **The charge is the server's.** The device sends only when it began to charge and when it fired
    (and the aim); the simulation measures the power from the ticks between. Nothing about a shot's
    reach is taken from the device.
  - **Stone balls fly an arc** under gravity, from a fixed 30° elevation, each gun scattering a few
    degrees and a few percent of reach. A ball that comes down onto a hull strikes it (8 damage).
  - **Wind, partly.** Each fight has a wind fixed by its seed, light to strong. It pushes a ball in
    flight (at most about a tenth of its reach) and helps or slows sailing by up to 10%. The fight
    shows it as an arrow turned to the ship's heading, and a word.
  - **Ramming.** Ships collide and are pushed apart. A ship driving into another deals its closing
    speed × 3 × its weight (its hull over 150, between 0.6 and 2.5) and takes a quarter of what it
    deals. So the ship rammed takes the blow, and a head-on meeting hurts both alike. Pirates never
    hurt one another.
  - **Pirates** close at full sail, circle broadside-on between 40 and 70 units, and fire whenever the
    player is inside a broadside's arc and reach, leading the player's motion but not allowing for the
    wind. A player lying still or crawling is rammed.
  - Measured with a test captain that leads its shots but ignores the wind (20 seeds each): a sloop
    beats a cutter 16 times in 20, hitting about 38% and losing about 70 of 150 hull; a brig beats a
    raider 19 times in 20. A captain who gives no orders always loses.
- **Before the fight is fought:**
  - a visit (`AMBUSH_PENDING`) and an onward voyage are refused;
  - calling the ship home plays the fight out with no orders, and its damage stands.
- **Losing.**
  - The ship is towed home with its hull at 0, and cannot sail (`SHIP_DAMAGED`) until it is repaired.
  - `POST /ships/repair { requestId }` costs 2 gold and 0.25 wood per missing hull point (proposal).
    It goes through the ledger as `SHIP_REPAIR`, in the same guarded batch as a build, and is
    idempotent.
- **Rewards for a win (bounties).** The owner chose the generous scale (2026-11-19):

  | Pirate sunk | Gold | Wood | Ore | XP |
  |---|---|---|---|---|
  | Cutter | 160 | 40 | 0 | 60 |
  | Raider | 500 | 120 | 40 | 180 |
  | Corsair | 1,200 | 240 | 120 | 400 |

  - Paid only when the whole fight is won, summed over the party. A fight lost, fled or timed out
    pays nothing.
  - The server pays it in the same batch as the fight's outcome: gold through the ledger as
    `PIRATE_BOUNTY` (reference: the player's ship), wood and ore through the inventory, experience
    through the progression. The receipt (`PIRATE_BOUNTY`) is the guard: anything that moved refuses
    the whole batch, and the use case reads again.
  - **Once per route per day.** The same route on the same day meets the same pirates with the same
    seed, so the same recorded orders would win again. The bounty is therefore keyed by the route and
    the day, like the ambush itself: a second win there is decided and pays nothing.
  - Materials go only into the warehouse's free room (and each stack's limit), wood before ore. What
    does not fit is reported as left behind and is not owed later. Gold and experience are always paid.
  - The reply to `POST /voyages/ambush` carries `bounty`, and a retried request reports the same one.
  - Numbers are game data (`packages/game-data/src/pirates`, `PIRATE_SHIPS[].bounty`).
- Migration 0049 adds the voyage's ambush columns; migration 0050 rebuilds the ledger to admit
  `PIRATE_BOUNTY`, and adds the bounty receipt guard.

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
  - Broadsides are aimed and charged as in the solo fight (W5c), stepped by the server.
  - Hits are computed by the server from its own positions, never reported by a client.
  - Hull falls to zero and the ship is towed home damaged: no loss of goods.
  - Repair costs gold (the `SHIP_REPAIR` ledger reason, already in the ledger) and materials, scaled
    by the damage.
  - Pirates are server-run ships with simple behaviours.
- **PvP (W5d).** Only after PvE is balanced. Consent and fairness rules are an owner decision to come
  (duels, opt-in flags, or zones).
- **Rewards.** A won pirate fight pays a bounty (see W5c above).

## How ships look

- Every class and every pirate has its own model, in the look of old Vietnamese boats and war junks:
  - rowboat: a **ghe** with a bamboo mui and a sculling oar;
  - sloop: a **ghe bầu** with one bat-wing sail;
  - brig: a black war junk with two sails, oars and guns;
  - frigate: a **lâu thuyền rồng** with a stern castle and a dragon prow.
- Pirates sail the **tàu Ô**, black ships with dark ragged sails.
- The models are generated (`tools/asset-pipeline/node/ships.mjs`, `docs/HAPPYFARM_ART_BIBLE.md`).
  `apps/web/src/render/ship-models.ts` picks a model by class id, pirate id or tier, and fits it to a
  scene.
- The fight draws each ship with its model once loaded; a block ship stands in until then. The
  horizon draws each voyage's ship by its tier, hazed like the islands, the player's own less so.
- **At home, the ship is moored at the island's pier** (a chosen island's dock), on the far side of the
  pier from the little fishing boat, sized by tier (2.6 m rowboat to 7.2 m frigate). It shows while
  the fleet read says `HOME` and is gone while the ship is at sea or at another place.
- **The ship's panel.** Tapping the moored ship opens "Tàu của bạn" (`apps/web/src/ship-panel.ts`):
  - the class and its picture, the hull, speed and cannons, and where it is (at the pier, at sea
    with the minutes left, or arrived at a place);
  - what it can do from there, led by the likeliest:
    - at the pier: set sail (the chart picks the place), repair (with its price) and build the next
      class (with its price, or the level it needs);
    - at sea: call it home;
    - at a place: look around, sail on, or come home;
    - pirates that have struck come first ("Đánh cướp biển!"), and calling the ship home warns that
      the crew then fights without orders.
  - Every button is one of the existing requests (`POST /voyages`, `/voyages/end`, `/ships/repair`,
    `/ships/build`, the visit and the fight). The panel refreshes from the fleet each one answers
    with, and counts a voyage's minutes down without asking the server.
- Presentation only: a model never changes a ship's numbers, which stay in game data.

## Taking the helm (S1, built)

The player can sail their own ship by hand round the home island's waters. It is the first of four
steps toward an open sea (owner approval, 2026-11-19):

| Step | What | Server |
| --- | --- | --- |
| **S1** | Sail round home waters; the edge offers the chart. | Nothing: it is the player's own screen. |
| S2 | One set of controls and one camera for the helm and the sea battle. | Unchanged. |
| S3 | A shared, realtime sea (a Durable Object): pirate lairs, sea monsters, other players. | New. |
| S4 | A fleet of several ships, one at the helm at a time. | A migration. |

How S1 works:

- **Taking it.** The ship's panel offers "Cầm lái" while the ship is moored at home with hull above 0
  and the 3D view is drawing it. The ship leaves the pier bow first and the camera flies in behind it.
  - The camera switch shows a third pill, **"Tàu"**, while the player has the helm. Picking "Toàn
    cảnh" or "Nhân vật", pressing F, Esc, or "Xuống tàu" steps ashore: the ship goes back to the pier
    and the camera flies to that view.
  - The character stays on the island, standing still; the movement keys sail the ship instead.
    Taps on the island and the E interaction do nothing while at the helm.
- **Controls.** The same as a sea battle, in the same wooden bar:
  - A/D or ◀ ▶ held: the rudder;
  - W/S or − +: the sails (struck, half, full);
  - Space or "Chèo nhanh": a 4-second sprint at 1.6x, then a 10-second rest.
- **Handling** (`apps/web/src/helm/helm.ts`, pure and tested):
  - Top speed in tiles per second by tier: 3.5, 4.5, 5.2, 6. Turn rate falls as the hull grows
    (1.3 down to 0.65 rad/s), and the rudder still bites a little with no way on.
  - The hull (bow, middle and stern) must lie on open sea or shallows, and clear of the pier. A ship
    that would run aground stops instead and says so ("Nước cạn phía trước"); it can turn away.
  - **Home waters are a circle round the island**: its grid's half-width plus 20 tiles (68 tiles
    for a 96-tile island), well short of the neighbours on the horizon. Past the grid everything is
    open sea. At the edge the ship stops and offers the chart ("Mở Hải đồ"). The helm waits while the chart is open: it sails on if the chart is
    closed, and ends if a voyage is begun, because the ship has then left for real.
  - Frames are cut into steps of at most 0.05 s, and a pause longer than 0.5 s is not sailed, so a
    stutter cannot carry the ship through a spit of land.
- **Nothing is sent.** The server still has the ship at home, and the only way to another island is
  still the chart's timed voyage. That is why the helm may live in the browser: it decides nothing
  anyone else sees or is paid. When S3 makes the sea shared, the ship's position becomes the server's.
- The loop sleeps once the ship lies still with its sails struck: an idle helm costs no frames.

## Security notes

- The client never sends a class, a price, a time, a position (in W5a), a hit, or a hull value.
- Builds are idempotent per `requestId`, race-safe (the ship row is written only over the tier and
  version read), and audited in the ledger.
- Voyages are written only over the version read. A second voyage cannot start while one is under
  way, and a replay is answered rather than repeated.
