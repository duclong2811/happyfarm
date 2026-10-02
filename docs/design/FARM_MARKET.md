# The Farm Market

Status: V14.3. The market is the local system market - the village buying produce and selling seed -
and it is where the first complete farming loop closes. Read this before changing its prices, its
presentation, or the way a character reaches it.

## The loop it closes

```text
gold -> buy seeds -> plant -> grow -> harvest -> produce in the inventory -> sell -> gold
```

Every step is server-authoritative: the buy and the sell are commands the Worker settles, and the
harvest has been since V13. The market adds no economy of its own - it is a new *window* onto the shop,
buy and sell infrastructure that already existed (`packages/application/src/shop.ts`,
`/shop/buy` and `/shop/sell`).

## Two directions, one shelf

| Tab | Shows | Bounded by |
| --- | --- | --- |
| **BUY** | everything the catalogue sells (seeds, saplings) | the wallet's gold and the entry's per-request ceiling |
| **SELL** | only what the player actually owns and the catalogue buys (produce) | what they hold |

A selling tab full of things the player has none of is a form, so zero-owned rows are not listed at
all; an empty SELL tab says so and points at the harvest.

## Price authority

Prices are **game data**, full stop: `packages/game-data/src/shops/index.ts`. A card displays the
catalogue's number, and the server charges or pays its own. Nothing in the client computes a price, and
no request carries one - a buy or sell names the entry and a quantity, and the settlement comes back
with the amount and the new balance.

Current values (unchanged in V14.3; the loop is positive by design):

| Item | Buy | Sell | One planting yields |
| --- | --- | --- | --- |
| Carrot seed / carrot | 2 | 2 | 2 carrots (4 gold for 2) |
| Wheat seed / wheat | 3 | 3 | 3 wheat (9 gold for 3) |
| Corn seed / corn | 6 | 6 | 3 corn (18 gold for 6) |
| Apple sapling / apple | 20 | 6 | 3 apples per cycle (18 gold), repeating |

Only seeds and saplings can be bought and only harvested produce can be sold - enforced structurally
when the catalogue is built, so no entry can create a buy-low-sell-high loop. Static prices only:
supply, demand, regional and player-driven pricing are later phases with their own telemetry.

## The settlement path

```text
client: { requestId, shopEntryId, quantity }
  -> validate the payload (strict schema; no price, no total, no balance)
  -> authorize the actor from the session
  -> read the catalogue entry and its price for that direction
  -> idempotency: a replayed requestId returns the first settlement, unchanged
  -> atomically: move the items, move the gold, write the ledger row
  -> return amountSpent/amountReceived and the new balance
```

The ledger records `SHOP_BUY` and `SHOP_SELL` with the actor, the currency, the delta and the reference,
exactly as the V3 economy architecture requires. A trade that cannot settle moves nothing: the wallet
and the inventory are one transaction, so there is no state where gold arrived without the goods or
the goods left without the gold.

The client's own quantity bounds (affordability, stock, the per-request ceiling) exist so the button is
honest, not because they are authority: the server checks all of it again, and a client that ignored
every bound would still be refused.

## The Market Stall

The island's market stall (`world.market_stall`, the two-cell landmark in the village square) is a real
interaction target: walk up to it in character view and it offers **Trade**.

* **Identification is data.** The definition carries `service: "FARM_MARKET"`, which travels to the
  client in `GET /world-objects`. Nothing keys off a model name, a mesh, a screen position or a
  hard-coded coordinate, so a second stall - or a stall on another island - is a row in game data.
* **Discovery and execution stay separate.** The interaction adapter turns the service into a `TRADE`
  candidate like any other target; opening the market is a UI action, and it sends no command.
* **Proximity applies.** The stall is reached through the same range table as every other target, so a
  character cannot trade from across the island.
* **Putting the stall away loses the walk-up market, not the market.** The stall is an ordinary movable
  starter building: storing it removes the interaction (and the object), while Estate view keeps its own
  Market module. That is a fair reading of putting the stall away, and it is deliberate.

## Opening, closing and input

* **Estate**: the module rail's Market button opens the panel directly, as it always has. A player who is
  managing does not have to walk anywhere.
* **Character**: `E` / the Interact button at the stall opens the same panel, on SELL when there is
  anything to sell and on BUY when there is not.
* **The mode does not change.** Opening the market is a service overlay: the camera mode, the camera
  pose, the character's position and the world are untouched, and closing it returns to the same state.
* **A panel owns the world while it is open.** Movement, run and interaction are all suppressed, and the
  touch stick is put away (and released) with the panel - a player cannot walk away underneath a trade.

## Presentation

The market uses the V14.2 item language: a grid of visual cards (thumbnail, name, unit price, owned
quantity, selected state) and **one** transaction panel for the selected card - quantity stepper, MAX,
total, and one Buy/Sell button. Quantity controls are not on every card; browsing and transacting are
separate concerns, and the panel is where the decision is made.

It reuses `items/card.ts`, `items/thumbnails.ts` and `items/visuals.ts` with no second pipeline: a
carrot is drawn once per session whatever surfaces show it. See `docs/design/ITEM_PRESENTATION.md`.

## What this is not

**Farm Market is the system/NPC market**: static, authoritative catalogue prices, one seller, no
haggling. A **player market** - players trading with each other, auction houses, dynamic or regional
pricing, supply and demand - is a different system for a later phase, and nothing here pretends
otherwise: the API names a catalogue entry and a quantity, and the catalogue belongs to the game.

Also deliberately absent: fishing, mining, forestry, boats, travel, a world map, shared or contested
zones, PvP, seasons, energy, taxes and market fees. The first loop is meant to be understandable.
