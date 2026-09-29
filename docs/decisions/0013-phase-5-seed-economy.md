# ADR 0013: Phase 5 seed economy, uprooting, and the bilingual HUD

Status: Accepted (independent audit completed 2026-09-29; pending commit)

## Context

Planting was free and every item was `category: "CROP"`, so the economy had an output (harvest,
sell) and no input. Gold could only go up, the shop sold the same produce it bought, and nothing in
the game explained what a crop cost to grow. The roadmap's Phase 5 called for a seed economy, and the
product decision behind this phase also added two things the same prompt asked for: a way to remove a
crop planted by mistake, and a Vietnamese/English interface.

## Decision

### Seed mapping is game data

- `ItemDefinition.category` is a closed set, `CROP | SEED`, and three seed items ship:
  `item_carrot_seed`, `item_wheat_seed`, `item_corn_seed`.
- Every `CropDefinition` carries `seedItemDefinitionId`. Game data refuses a crop whose seed is
  missing, whose seed is not category `SEED`, or whose seed is already claimed by another crop, so a
  planting can never be ambiguous about what it costs.
- The crop catalogue contract therefore gained `seedItemDefinitionId` (plus `displayNameKey` and
  `seedItemDisplayNameKey` for the client's translation layer). The command did not change: planting
  still carries only `requestId`, `cropDefinitionId`, `x`, `y`, and `expectedTileVersion`.

### The shop trades one way per item

- A shop entry's price may be absent, and an absent price is the server's statement that the
  direction is closed: seeds carry `buyPrice`, harvested produce carries `sellPrice`. Game data
  refuses a buyable non-seed and a sellable non-crop, so gold can never buy produce directly and a
  seed can never be sold back.
- `calculateShopTotal` refuses a null price rather than pricing it at zero, and `BuyItem` /
  `SellItem` refuse the wrong direction with the stable `SHOP_ENTRY_NOT_ALLOWED` (400) before any
  price is read. The contract sends `null`, never `0`, so the client renders no button for a closed
  direction.
- Prices are chosen so each crop repays its seed at least twice over and the gold per second is the
  same for all three crops (carrot 2 -> 4, wheat 3 -> 9, corn 6 -> 18). Game-data tests assert both
  the loop closing and the absence of any buy-and-sell-back pair.

### Planting spends a seed, atomically

- `PlantCrop` resolves the seed from the crop definition, prepares the removal through the
  centralized `InventoryService`, and hands the expected inventory row to
  `CropInstanceRepository.plantAtomically`.
- One D1 batch spends the seed (guarded on the exact quantity and version the caller read), inserts
  the crop (guarded on the tile's version and terrain), and finalizes the generic idempotency record.
  The final statement commits only when the crop row exists *and* the seed row is at the post-removal
  quantity and version, so a failure at any step rolls the whole planting back. There is no second
  inventory mutation path and nothing is subtracted on the client.
- Replay identity is `(actor, PLANT_CROP, requestId)` with a payload fingerprint like every other
  command, so a replay returns the stored crop and spends nothing. Two concurrent requests that only
  one seed can satisfy leave one planting; the loser re-reads the state it contended over and is
  refused with `INSUFFICIENT_ITEMS`, or `CONFLICT_STALE_STATE` when the stack moved but was not
  emptied. A plant that fails for any other reason is refused before anything is written: no crop, no
  idempotency record, no spent seed.

### The starter grant happens once per player

- `0007_seed_economy.sql` adds `starter_seed_grants(player_id PRIMARY KEY, item_definition_id,
  quantity, created_at)` and an `AFTER INSERT` trigger that credits `inventory_items`. The receipt
  insert *is* the command, so the credit and the record of it are one statement: there is no window
  with one and not the other, and the player-scoped primary key is what makes the grant one-time.
- `GrantStarterSeed` is an application use case, not a route. It takes the item and the quantity from
  validated game data (36 x `item_carrot_seed`) and prepares the addition through `InventoryService`.
  The development bootstrap calls it for the identity it just authenticated, so a player who predates
  the seed economy still receives the grant exactly once, and a repeated bootstrap, a second farm, or
  a replayed call credits nothing. A production onboarding step can call the same service.

### Uprooting refunds nothing

- `POST /farms/:farmId/crops/:cropInstanceId/uproot` is owner-only and accepts only `requestId` and
  `expectedCropVersion`. The crop ID is in the route, exactly as harvest's is.
- `UprootCrop` re-checks the farm, the membership, and the crop's farm and version, then deletes the
  crop row and writes the idempotency receipt in one batch. It writes no inventory, currency, or
  experience, which is why it can be settled by a deletion and a receipt and nothing else. The
  response carries a crop ID and no reward field.
- Authorization is re-read before a stored result is returned, as harvest does, so revoking access
  makes the replay fail too. A duplicate request ID replays the stored answer and cannot delete a
  second crop; a fresh request for an already-removed crop is `CROP_NOT_FOUND`.
- The client asks for confirmation before sending the command, in the current language, and refreshes
  the field, the crops, the selection, and the dock afterwards.

### Internationalisation is presentation only

- `apps/web/src/i18n.ts` is the client's one translation module: a typed dictionary for HUD strings,
  a game-data display-name dictionary keyed by the keys the server sends, and a fallback to the
  stable ID for a key this client has never seen. No crop, item, or currency list lives in the code.
- Language is chosen from `localStorage` when a choice exists, otherwise from `navigator.language`
  (leading `vi` -> Vietnamese, everything else -> English), is persisted on change, and re-renders
  the page in place. `document.documentElement.lang` follows the switch.
- No route accepts a language and no authoritative value changes with it: level, prices, seed counts,
  maturity, and rewards are exactly what the server sent.

## Consequences

- Planting now has a cost, so `INSUFFICIENT_ITEMS` is a routine refusal and the client has to explain
  it. `plant` responds by disabling itself with the reason shown and pointing at the market.
- The seed is a normal inventory row, so seeds and produce share one inventory, one service, and one
  settlement shape; only the shop's per-entry direction distinguishes them.
- The starter grant adds the first write to the bootstrap path, which means a development bootstrap
  now requires migration `0007`. A player who never completes onboarding has no seeds and therefore
  cannot plant, which is the intended, visible state.
- Uprooting is deliberately lossy. It is a convenience for a mis-planted tile, not an undo, and no
  refund path exists to abuse.
- The HUD can only be translated as far as the client knows the display keys. A crop added to game
  data without a translation still renders, under its stable ID.
