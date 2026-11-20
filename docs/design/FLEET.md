# Fleet: fishing boats, merchant ships, warships

Status: **F1 approved and in progress** (2026-11-20). The owner answered the open questions the same
day (below). F0, the practice sea monster, is built (see NAVAL.md, "A monster off the island").

## The owner's direction (2026-11-20)

> The weakest ship is the fishing boat, upgraded step by step. There are merchant ships too: a
> marketplace between players, and merchant ships carry the goods to the buyer's island. And warships,
> which fight - and can carry cargo as well. Upgrade the ships: fishing, ship roles, and combat.

## Proposal

### 1. A fleet of several ships, each with a role

Today a player owns exactly one ship whose class climbs one ladder (rowboat, sloop, brig, frigate).
The proposal is three ladders, and more than one ship at a time:

| Role | Ladder (tier 1 to 4) | What it is for | Fights |
| --- | --- | --- | --- |
| **Thuyền cá** (fishing) | thuyền câu, ghe câu, ghe lưới, tàu cá vỏ gỗ | fishing trips; a small hold | no guns, can only flee |
| **Tàu buôn** (merchant) | ghe bầu, thuyền mành, ghe chài, tàu buôn lớn | carrying goods: market deliveries, trade runs; a big hold | light guns |
| **Tàu chiến** (war) | thuyền chiến, chiến thuyền, lâu thuyền, chiến hạm rồng | fighting pirates and monsters, escorting; a small hold | full broadsides |

- The existing classes map onto these ladders: the rowboat becomes the first fishing boat, and the
  sloop, brig and frigate become the first three warships. A player keeps what they own.
- **Upgrades** within a ladder raise hold, speed, hull and guns. They are paid in gold, wood and ore
  through the ledger, as ship builds are today.
- **Fleet size** is capped by the dock's tier: 1 ship at first, then 2, 3 and 5.

### 2. Fishing trips (fishing boats)

- The client cannot be trusted with where a ship is: the helm is drawn on the player's own screen.
  So fishing at sea is a **timed trip**, like a voyage: send the boat to a fishing ground (home
  waters, or a farther ground on the chart) for a chosen time.
- The **server rolls the catch** from the ground, the boat's tier and its hold, and puts the fish in
  the warehouse when the boat returns. No client-sent catch, ever.
- Farther grounds give rarer fish, take longer, and carry the ambush risk that voyages already have.
- At the helm, the boat can still be shown casting nets in home waters. That is presentation only.

### 3. The player marketplace and deliveries (merchant ships)

- A seller lists items for a price. The items leave the seller's warehouse into **escrow on the
  server**.
- A buyer buys. Their gold leaves their wallet into escrow, in the same transaction.
- A **merchant ship carries the goods** from the seller's island to the buyer's. The delivery time
  comes from the chart distance; the ship can be ambushed on the way.
- On arrival, the items land in the buyer's warehouse and the gold is released to the seller, less a
  **market fee**. The fee is the gold sink.
- Every step is a ledger and inventory record, with idempotency, under the security review. Trading
  is one of the highest-risk features in the game: duplicate items, gold out of nothing,
  self-trading between alt accounts to move wealth.

### 4. Fighting (warships, and anyone attacked)

- The deterministic battle simulation stays the referee: the server re-plays the orders.
- New opponents: **sea monsters**, which ram and have no guns (built as the "BEAST" behaviour), and
  in time **pirate lairs** at sea.
- Warships can **escort** a merchant or fishing boat on its trip. An escorted trip that meets
  pirates fights with the warship's guns.

### Built (F1 server, 2026-11-20)

- Migration `0051_fleet_and_docks.sql`: `player_ships` keyed by ship, with a berth (a stored ship moved
  across into berth 1 with its id); `player_docks`; `ship_voyages.ship_id`; the ledger admits
  `DOCK_UPGRADE` pointing at `dock_<player uuid>`.
- Requests: `POST /ships/build { role }` builds rank 1 of a role into the first free berth (or in
  place of the lent rowboat); `POST /ships/upgrade { shipId }` moves one's own ship up its ladder;
  `POST /ships/dock` raises the dock; `POST /voyages { slotId, shipId? }` and
  `POST /ships/repair { shipId? }` name the ship. The fleet read lists every ship, what each role
  would cost to build, and the dock.
- A ship's id is the player's uuid (berth 1, as before) or the uuid with `_<berth>`: a ship id from
  another player's fleet is never found in one's own.
- New errors: `DOCK_FULL`, `DOCK_MAX_TIER`, `DOCK_LEVEL_REQUIRED`.
- Ships without guns meet no pirates. A ship lying at a place sails on; no other ship sets out until
  it is home.

### Built (F1 client, 2026-11-20)

- The ship panel is the fleet's panel (`apps/web/src/ship-panel.ts`): a berth row picks a ship or the
  empty berth; a ship offers sail, helm, repair and its upgrade; the empty berth offers a new ship of
  each role; the dock line offers the next tier. A ship at the dock waits while another is out.
- Laid out as a shipyard (redesign, 2026-11-20, after the owner found the first panel too wordy): berth
  tiles with each ship's picture, role badge, rank stars and hull bar, a "+" for a free berth and locks
  for the berths the next dock tier adds; the picked ship large on a stage tinted by its role; its
  numbers as bars with icons, the upgrade's gain striped in green; big buttons with one word and the
  price as resource chips that turn red when the island is short. Explanations are tooltips; only a
  warning that holds a button back is written out. Icons: `apps/web/src/assets/ui/fleet/`. Ship
  pictures are drawn on a clear backdrop (`ThumbnailRequest.backdrop`).
- The ship picked is the one drawn at the pier, taken to the helm, fought in the practice fight and
  sailed from the chart (`pierShipOf`, `sailingShipId` in `main.ts`).
- Every class has its own model (F1 art, `tools/asset-pipeline/node/ships.mjs`): fishing boats in
  sea-blue with a red band (the trawler with a white wheelhouse and squid lamps on its booms),
  merchant boats in oiled wood under mat sails with jars and bales, and the dragon warship in black
  lacquer and gold.
- Note: some upgrades take more wood and ore than the starting warehouse holds (the dock's tier 3 and
  up, the top ranks). A player needs a bigger warehouse for them, as with the high mine levels.

### Phases

| Phase | Content | Migration | Economy |
| --- | --- | --- | --- |
| F0 (built) | Practice monster off the home island | no | none |
| F1 (built) | Fleet of several ships, three roles, conversion of today's ship | yes (0051) | ship prices and upgrades |
| F2 | Fishing trips: grounds, catch tables, the warehouse | yes | fish values |
| F3 | Monster hunts with rewards, referee'd by the server (like pirate bounties) | yes | bounties |
| F4 | Player marketplace, escrow, deliveries by merchant ship | yes | fees, limits, anti-abuse |
| F5 | Escorts, pirate lairs; the shared realtime sea (S3) | yes | rewards |

## The owner's decisions (2026-11-20)

1. **Fleet:** several ships at once, capped by the dock's tier (1, 2, 3, then 5 berths). Approved.
2. **Conversion:** the rowboat becomes the first fishing boat; the sloop, brig and frigate become the
   first three warships. Approved.
3. **Fishing:** the catch depends on the boat's rank: a better boat brings in more (and, on farther
   grounds, rarer) fish. Read as: timed trips with a server-rolled catch, scaled by the boat.
4. **Marketplace:** only a player of the level to buy a merchant ship joins the market, for example
   level 50 (levelling is fast today, so the gate sits high). Open still: the market fee, who pays
   for delivery, and whether prices are free or banded.
5. **A sunk merchant ship:** the goods are lost and the trade fails. Read as: the buyer's gold comes
   back out of escrow in full; the goods were the seller's, on the seller's ship, and are gone.
6. **Monster hunts (F3):** pay as pirates do (gold, materials, experience), and also drop a **rare
   item** that is precious in the game. What that item is, is still open (ideas below).

## F1: the fleet (design, numbers provisional)

Everything here is game data and can be retuned without a migration. The numbers are a first proposal
on the scale of today's ships, mines and warehouse; they are marked provisional until the owner signs
them off.

### Rules

- A player's ships each take a **berth** at the dock. The dock's tier sets how many berths there are.
- **Building** a ship puts the first rank of a ladder into a free berth, paid in gold (ledger,
  `SHIP_BUILD`), wood and ore (inventory). A player with no ship of their own still has the dock's
  rowboat, lent for free; their first build takes its place, exactly as building a sloop does today.
- **Upgrading** a ship moves it one rank up its own ladder, in place: same ship, same berth. The role
  never changes; a fishing boat never becomes a warship.
- **Upgrading the dock** adds berths (ledger, `DOCK_UPGRADE`).
- Each class has a player level it needs. Merchant ships start at level 50: having one is what lets
  a player trade on the market (F4).
- A ship must be at home to be upgraded or repaired. The player sails **one ship at a time**: the
  voyage names the ship. The other ships wait at the dock (fishing trips and deliveries come with F2
  and F4).
- **Ship without guns** (fishing boats) do not meet pirates on voyages: they are small, and they could
  only run. Merchant ships and warships do.
- `tier` stays what it is today, the ship's size (1 to 4): it decides the model's scale, how it handles
  at the helm, and which pirate parties come for it. `rank` is its place on its own ladder.

### Dock

| Dock tier | Berths | Player level | Upgrade cost (gold / wood / ore) |
| --- | --- | --- | --- |
| 1 | 1 | 1 | the starting dock |
| 2 | 2 | 15 | 1,500 / 300 / 100 |
| 3 | 3 | 30 | 6,000 / 900 / 500 |
| 4 | 5 | 50 | 20,000 / 2,500 / 1,800 |

### Ships

Cost is what building rank 1 costs, or what upgrading from the rank before costs. Hold is cargo room
in items, for fishing trips (F2) and deliveries (F4); F1 only shows it.

| Role | Rank | Class | Name | Size tier | Level | Speed | Hull | Guns | Hold | Cost (gold / wood / ore) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fishing | 1 | `ship_class_rowboat` | Thuyền câu | 1 | 1 | 40 | 60 | 0 | 20 | 200 / 40 / 0 (the first is the dock's, free) |
| Fishing | 2 | `ship_class_line_boat` | Ghe câu | 1 | 8 | 55 | 90 | 0 | 40 | 400 / 80 / 20 |
| Fishing | 3 | `ship_class_net_boat` | Ghe lưới | 2 | 20 | 70 | 150 | 0 | 80 | 1,500 / 250 / 100 |
| Fishing | 4 | `ship_class_trawler` | Tàu cá vỏ gỗ | 3 | 35 | 85 | 240 | 0 | 140 | 5,000 / 700 / 400 |
| Merchant | 1 | `ship_class_coaster` | Ghe bầu | 2 | 50 | 70 | 220 | 1 | 150 | 6,000 / 900 / 300 |
| Merchant | 2 | `ship_class_junk` | Thuyền mành | 3 | 55 | 85 | 320 | 2 | 250 | 10,000 / 1,400 / 600 |
| Merchant | 3 | `ship_class_cargo_junk` | Ghe chài | 3 | 62 | 95 | 420 | 3 | 400 | 16,000 / 2,000 / 1,000 |
| Merchant | 4 | `ship_class_great_junk` | Tàu buôn lớn | 4 | 70 | 110 | 560 | 4 | 600 | 25,000 / 3,000 / 1,600 |
| War | 1 | `ship_class_sloop` | Thuyền chiến | 2 | 10 | 70 | 150 | 2 | 30 | 800 / 150 / 60 (today's) |
| War | 2 | `ship_class_brig` | Chiến thuyền | 3 | 25 | 100 | 320 | 6 | 50 | 3,000 / 500 / 300 (today's) |
| War | 3 | `ship_class_frigate` | Lâu thuyền | 4 | 45 | 130 | 600 | 12 | 80 | 12,000 / 1,600 / 1,200 (today's) |
| War | 4 | `ship_class_dragon` | Chiến hạm rồng | 4 | 65 | 140 | 900 | 16 | 120 | 30,000 / 3,500 / 2,800 |

### Conversion of today's ships

No row changes: the classes keep their ids, sizes and numbers. The stored ship becomes berth 1, and its
voyage is its voyage. A player who has a sloop keeps a sloop, now the first warship; its next upgrade
is the brig, as before. A player still on the dock's rowboat now upgrades it to a line boat; a
warship needs a second berth, or replaces the lent rowboat as their first build.

### Ideas for the rare monster drop (open)

- **Ngọc thuồng luồng** (serpent pearl): needed, with gold, for the top rank of each ladder (the
  dragon warship, the great junk, the trawler), so the best ships are hunted for, not only bought.
- Or a decoration only monster hunters can place (a serpent skull arch, a pearl shrine).
- Or a sail or figurehead that changes how a ship looks.

## Questions still open

- **Market (F4):** the fee (for example 5% of the price, taken from the seller); who pays for the
  delivery (proposed: the seller, because it is the seller's ship); free prices or a band around the
  shop's price (proposed: a band, against laundering gold between alt accounts).
- **The rare monster item (F3):** which of the ideas above, or something else.
- **F1 numbers:** the two tables above.
