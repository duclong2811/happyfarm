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
