# Fleet: fishing boats, merchant ships, warships

Status: **proposal, waiting for the owner's decisions** (2026-11-20). Only the practice sea monster is
built (see NAVAL.md, "A monster off the island"). Nothing below changes the economy until the owner
signs off the open questions at the end.

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
| **Thuyền cá** (fishing) | thuyền thúng, ghe câu, ghe lưới, tàu cá vỏ gỗ | fishing trips; a small hold | no guns, can only flee |
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

### Phases

| Phase | Content | Migration | Economy |
| --- | --- | --- | --- |
| F0 (built) | Practice monster off the home island | no | none |
| F1 | Fleet of several ships, three roles, conversion of today's ship | yes | ship prices and upgrades |
| F2 | Fishing trips: grounds, catch tables, the warehouse | yes | fish values |
| F3 | Monster hunts with rewards, referee'd by the server (like pirate bounties) | yes | bounties |
| F4 | Player marketplace, escrow, deliveries by merchant ship | yes | fees, limits, anti-abuse |
| F5 | Escorts, pirate lairs; the shared realtime sea (S3) | yes | rewards |

## Questions for the owner

1. **Fleet:** do several ships at once suit you, capped by the dock's tier as above? Or one ship of
   each role?
2. **Conversion:** do today's sloop, brig and frigate become warships, and the rowboat a fishing boat?
3. **Fishing trips:** timed trips with a server-rolled catch (proposed)? Or something more hands-on
   at the helm, accepting that the server cannot see where the ship is?
4. **Marketplace:** who pays for delivery, the buyer or the seller? What market fee (for example
   5%)? Should prices be free or within a band around the shop's price? Should there be a minimum
   level to trade?
5. **A sunk merchant ship:** are its goods lost, insured, or returned to the seller?
6. **Monster rewards:** should real monster hunts (F3) pay like pirates do: gold, materials, XP?
