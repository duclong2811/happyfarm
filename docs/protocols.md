# API and Realtime Protocols

## Versioning
Public contracts start at `v1`. Breaking payload changes require an explicit versioning decision.

## Authentication context
Actor identity comes from verified server auth/session context, never from a client-supplied player ID.

## REST envelope
Successful responses may use:

```json
{"ok":true,"data":{}}
```

Errors:

```json
{"ok":false,"error":{"code":"CROP_NOT_READY","requestId":"..."}}
```

Do not expose SQL messages, stack traces, secrets, or internal implementation details.

## WebSocket envelope

```ts
type GameMessage = {
  type: string;
  requestId?: string;
  sequence?: number;
  payload: unknown;
};
```

Every payload is runtime validated before use.

## Example command
Client -> server:

```json
{
  "type":"crop.harvest",
  "requestId":"uuid",
  "payload":{"farmId":"farm_123","tileId":"tile_42"}
}
```

Server validates auth, farm permission, crop state, server time, and idempotency. Then it persists result and broadcasts a validated event.

Server -> clients:

```json
{
  "type":"crop.harvested",
  "requestId":"uuid",
  "payload":{
    "farmId":"farm_123",
    "tileId":"tile_42",
    "cropId":"crop_carrot",
    "itemsAdded":3,
    "xpAwarded":8,
    "currencyAwarded":24
  }
}
```

## Stable error codes
Initial set:
- NOT_AUTHENTICATED
- NOT_AUTHORIZED
- INVALID_INPUT
- RESOURCE_NOT_FOUND
- FARM_PERMISSION_DENIED
- TILE_INVALID
- TILE_OCCUPIED
- TILE_NOT_PLANTABLE
- CROP_DEFINITION_NOT_FOUND
- CROP_NOT_READY
- CROP_NOT_FOUND
- CROP_NOT_MATURE
- CROP_ALREADY_HARVESTED
- CROP_LEVEL_REQUIRED
- ITEM_DEFINITION_NOT_FOUND
- INVENTORY_LIMIT_EXCEEDED
- INSUFFICIENT_ITEMS
- SHOP_ENTRY_NOT_ALLOWED
- INSUFFICIENT_FUNDS
- REQUEST_ALREADY_PROCESSED
- CONFLICT_STALE_STATE
- IDEMPOTENCY_CONFLICT
- RATE_LIMITED
- INTERNAL_ERROR

## Retry/idempotency
Client may retry network requests. High-value commands use a request ID. A duplicate request must not duplicate currency, items, XP, unlocks, or rewards.

## Client authority restrictions
Never accept authoritative balance, reward, maturity, price, level, XP, ownership, or permission values from clients.

## Phase 2B HTTP commands

- `POST /farms/:farmId/crops/:cropInstanceId/harvest` accepts only `requestId` and `expectedCropVersion`. Reward item, quantity, maturity, and time are server-derived.
- `GET /inventory` returns only the authenticated player's entries. Phase 5 added
  `displayNameKey` and `category` so the client can name and group what it holds without keeping a
  list of item IDs; the quantity is still the server's authoritative stack.
- There is no generic client inventory mutation route.

## Phase 3 shop command contracts

`BuyItem` and `SellItem` accept only:

```json
{"requestId":"economy_123","shopEntryId":"shop_carrot","quantity":2}
```

The schemas are strict. Price, currency, player identity, wallet balance, reward, and inventory result are server-owned and rejected when supplied by a client. Phase 3A defines these contracts but does not expose HTTP routes or execute settlement.

Phase 3D exposes `POST /shop/buy` and `POST /shop/sell`. Both authenticate the actor, resolve the authoritative shop entry and prices, and atomically persist wallet, inventory, ledger, and generic idempotency effects. Successful retries return the stored presentation-safe settlement result without repeating any mutation.

## Phase 3E read-only economy reads

- `GET /shop` requires authentication (route policy: `/health` is public, every other API route is authenticated) and returns presentation-safe catalog entries projected from the authoritative game-data shop registry: `{ shopEntryId, itemDefinitionId, itemDisplayNameKey, category, currencyId, currencyDisplayNameKey, buyPrice, sellPrice, maxQuantityPerRequest }`. Displayed prices are informational; `POST /shop/buy` and `POST /shop/sell` still resolve prices server-side and reject client-supplied price fields. Since Phase 5 a price may be `null`, which means this entry does not trade that way: seeds carry `buyPrice`, harvested produce carries `sellPrice`, and the client renders one button per non-null price.
- `GET /wallet` requires authentication and returns only the authenticated actor's wallets as `{ currencyId, displayNameKey, balance }` entries under `{ "wallets": [...] }`. A player with no persisted wallet receives `{ "wallets": [] }`. Phase 3C lazy wallet creation remains mutation-only: this route never creates a wallet row and never writes wallet, ledger, inventory, or idempotency state.
- Neither read route accepts `playerId`, `userId`, `walletOwner`, or any pricing/authority input from the route, query string, body, or headers.

## Phase 3.5B farm read route and development UI

- `GET /farms/:farmId/tiles` requires authentication and membership of that farm, and returns the
  farm's unlocked land as `{ "tiles": [ ... ] }` ordered by `y` then `x`, where each entry is
  `{ farmId, x, y, terrainType, state, version, updatedAt }`. Failures are `NOT_AUTHENTICATED`
  (401), `NOT_AUTHORIZED` (403) for a non-member, `RESOURCE_NOT_FOUND` (404) for an unknown farm,
  and `INVALID_INPUT` (400) for a malformed id.
- The route exists because `POST /farms/:farmId/crops` requires the authoritative
  `expectedTileVersion` of an existing tile: without a read route, planting could only be driven
  from a hand-seeded database.
- This is a pure projection. It creates, mutates, and unlocks nothing, accepts no identity,
  coordinate, or authority input beyond the path id, and never accepts a `playerId` query
  parameter or header.
- A dynamic path segment that is not valid percent-encoding (`GET /farms/%/tiles`,
  `POST /farms/%/crops`, `GET /farms/%zz`) is `INVALID_INPUT` (400) on every route that takes an
  id, never `INTERNAL_ERROR`. A malformed id is a client error, so it is classified as one.
- The development UI is a client of these contracts only. It holds the development bearer token in
  browser storage, sends it as an `Authorization` header, and validates every response against the
  `@happy-farm/contracts` zod schemas. It derives no price, reward, timer, maturity, balance, or
  identity value of its own; growth and wallet values are rendered exactly as returned.
- The UI talks to `/api/*` on its own origin. That prefix is a development-only convenience mapped
  by the Vite dev server; the production API base URL is a deployment decision that remains open.

## Phase 4A experience and levelling

- `POST /farms/:farmId/crops/:cropInstanceId/harvest` now returns `{ "harvest": { ... },
  "progression": { ... } }`. Both objects are strict, and the endpoint has gained no input: the
  request still accepts only `requestId` and `expectedCropVersion`.
- The `progression` member of a harvest response is the award that settlement paid:

  ```json
  {
    "xpAwarded": 4,
    "leveledUp": false,
    "progression": { "level": 1, "xp": 4, "xpIntoLevel": 4, "xpForNextLevel": 120, "maxLevel": 50 }
  }
  ```

  `xpAwarded` comes from the harvested crop's definition, never from the request. `level`,
  `xpIntoLevel`, `xpForNextLevel`, and `maxLevel` are derived by the server, so no client
  reimplements the curve or guesses how far the next level is.
- A replayed harvest returns the stored award exactly as the original call returned it, including
  the level at that moment. The response is not recomputed, so a replay never reports a level it did
  not cause.
- `GET /progression` requires authentication and returns
  `{ "progression": { "level", "xp", "xpIntoLevel", "xpForNextLevel", "maxLevel" } }` for the
  authenticated actor only. A player who has never earned experience reads as level 1 with `xp` 0.
  The route is a projection: it creates no progression row and writes no state.
- Neither route accepts `playerId`, `userId`, `level`, `xp`, or any other levelling input from the
  path, query string, body, or headers.
- The progression domain codes (`INVALID_PROGRESSION`, `PROGRESSION_LIMIT_EXCEEDED`) are not part of
  the API error vocabulary and never reach a client: a stored row this curve could not have produced
  is refused as `INTERNAL_ERROR` rather than written forward. A concurrent-award race is
  `PROGRESSION_CONFLICT` (409), which the server retries internally before answering.

## Phase 4B crop catalogue and level-gated unlocks

- `GET /crop-definitions` requires authentication and returns
  `{ "definitions": [ { "cropDefinitionId", "displayNameKey", "growthDurationSeconds",
  "seedItemDefinitionId", "seedItemDisplayNameKey", "harvestItemDefinitionId", "baseQuantity",
  "harvestXp", "requiredLevel" } ] }` for every crop this deployment can plant. It is a pure
  projection of game data: it reads no database, mutates nothing, and reveals no player state.
  `requiredLevel` is always present, with 1 meaning "no requirement", so a client never infers a rule
  from a missing field. Phase 5 added the seed the crop consumes and the display keys the client
  translates; the player's own seed count is not part of this route.
- Crops a player has not unlocked are **listed**, not filtered out. The client needs them to explain
  what to work towards; the server is what refuses the command.
- `POST /farms/:farmId/crops` now enforces the requirement. A crop above the actor's level is refused
  as `CROP_LEVEL_REQUIRED` (403) — a new code, chosen because `NOT_AUTHORIZED` means "not allowed on
  this farm" and 400 would call a well-formed command malformed. The refusal names neither a level
  nor a curve in the response body, which stays `{ "code", "requestId" }`; the client already knows
  its own level from `GET /progression` and the requirement from the catalogue.
- The requirement has gained no input. `POST /farms/:farmId/crops` still accepts only `requestId`,
  `cropDefinitionId`, `x`, `y`, and `expectedTileVersion`, and no route accepts `level`, `xp`, or a
  crop's requirement from the path, query string, body, or headers.
- A refused plant is not a processed request: it writes no crop row and no idempotency record, so the
  same request id stays usable once the player reaches the level.
- Reading is never gated. `GET /farms/:farmId/crops` still reports every planted crop, including one
  a retuned curve would no longer let the player plant, and `GetFarmCrops` filters nothing by level.
- Unlocks are permanent: a level only ever rises, so a crop that has been unlocked stays unlocked.
  Expiring or consumable unlocks are deliberately out of scope.

## Phase 4C farm expansion

- `GET /farms/:farmId/plots` requires farm membership and returns every server-defined plot with
  `plotId`, `plotIndex`, `currencyId`, `price`, `requiredLevel`, and farm-specific `unlocked` state.
- `POST /farms/:farmId/plots` is owner-only and accepts exactly `{ "requestId": "..." }`. The server
  chooses the next plot; plot ID, coordinates, price, currency, level, and wallet values are never
  accepted from the client.
- A successful response contains `{ "expansion": { "plotId", "plotIndex", "currencyId",
  "amountSpent", "newBalance", "tilesAdded" } }`. Replays return the originally stored result.
- `PLOT_LEVEL_REQUIRED` is 403; `PLOT_LIMIT_REACHED`, insufficient funds, and settlement races are
  conflicts. A refused request writes neither land nor an idempotency record.

## Phase 5 seed economy, uproot, and bilingual HUD

### Planting costs a seed

- `POST /farms/:farmId/crops` accepts exactly the same five fields as before. The crop definition now
  names the seed it consumes (`seedItemDefinitionId`), and the server spends exactly one of it
  through the centralized inventory service inside the same transaction as the crop insert and the
  idempotency record. The command never carries an item ID, a quantity, or a cost.
- A player with no seed of the chosen crop is refused with `INSUFFICIENT_ITEMS` (409). The refusal
  writes no crop, no idempotency record, and no inventory change.
- A replayed request returns the stored crop and spends nothing further. A connected pair of
  requests that only one seed can satisfy leaves one planting and a seed stack at zero; the loser is
  refused with `INSUFFICIENT_ITEMS` or `CONFLICT_STALE_STATE` rather than overspending.
- `SHOP_ENTRY_NOT_ALLOWED` (400) is the stable refusal for asking the shop to trade an item the
  wrong way: the shop sells seeds and buys produce, and no entry does both for one item.

### Uprooting

- `POST /farms/:farmId/crops/:cropInstanceId/uproot` is owner-only and accepts exactly
  `{ "requestId": "...", "expectedCropVersion": 1 }`. It is available for a growing crop and for a
  mature one.
- Uprooting refunds nothing: no seed, no gold, no produce, and no experience. It deletes the crop
  row and records the idempotency receipt in one transaction, so a replay returns the stored result
  and never deletes a second crop.
- The response is `{ "removed": { "cropInstanceId": "..." } }`: there is no reward field, because
  there is no reward.
- Authorization and membership are re-read before a stored result is returned, exactly as harvest
  does, so a replay cannot outlive the access that allowed the original command.

### Starter seeds and the client

- The development bootstrap grants the configured player exactly 36 `item_carrot_seed`, once, through
  `GrantStarterSeed`. There is no HTTP route for granting items: the grant is an onboarding step the
  server performs for the identity it just authenticated, and a repeated bootstrap, a second farm, or
  a replay finds the receipt and credits nothing.
- The client's planting control lists each crop with its name and the player's seed count, disables
  planting when the tile is not empty soil, the crop is not unlocked, or no seed is held, and says
  which of those is missing. Nothing is subtracted optimistically: the dock re-renders from
  `GET /inventory` and `GET /farms/:farmId/crops` after every command.
- The HUD is bilingual (`vi`/`en`). Language is presentation only: no route accepts a language, and
  every authoritative value -- level, price, seed count, maturity -- is unchanged by the switch.
## Phase 6 - Trees and repeating harvests

- `GET /tree-definitions` requires authentication and returns
  `{ "definitions": [ { "treeDefinitionId", "displayNameKey", "saplingItemDefinitionId",
  "saplingItemDisplayNameKey", "firstReadySeconds", "regrowSeconds", "growthStages",
  "harvestItemDefinitionId", "baseQuantity", "harvestXp", "requiredLevel" } ] }` for every tree this
  deployment can plant. Reads are never gated by level: a tree the player has not unlocked is listed
  with the level it needs. The player's own sapling count is not part of this route.
- `GET /farms/:farmId/trees` requires farm membership and returns `{ "trees": [ TreeState ] }` where a
  tree state carries `treeInstanceId`, `definitionId`, `tileX`, `tileY`, `plantedAt`,
  `lastHarvestedAt` (nullable), `readyAt`, `secondsUntilReady`, `ready`, `phase`
  (`GROWING`|`READY`|`REGROWING`), `growthStage`, `growthProgress`, and `version`. Every readiness
  field is projected from server time; no route accepts a client clock.
- `POST /farms/:farmId/trees` (owner only) takes `{ "requestId", "treeDefinitionId", "x", "y",
  "expectedTileVersion" }` and answers `201 { "tree": TreeState }`. The sapling comes from the
  definition and exactly one is spent in the same transaction that inserts the tree; a tile that
  already holds a crop or a tree is refused with `TILE_OCCUPIED` (409).
- `POST /farms/:farmId/trees/:treeInstanceId/harvest` (owner only) takes `{ "requestId",
  "expectedTreeVersion" }` and answers `{ "harvest": { "treeInstanceId", "itemDefinitionId",
  "quantityAdded" }, "progression": XpAward }`. The tree is not removed: the revision advances and
  the next cycle begins. A cycle the server has not reported ready is refused with `TREE_NOT_READY`
  (409), and a second harvest of the same cycle cannot settle.
- `POST /farms/:farmId/trees/:treeInstanceId/remove` (owner only) takes `{ "requestId",
  "expectedTreeVersion" }` and answers `{ "removed": { "treeInstanceId" } }`. There is no reward and
  no refund, exactly like uprooting a crop.
- Tree error codes: `TREE_DEFINITION_NOT_FOUND` (404), `TREE_NOT_FOUND` (404), `TREE_NOT_READY`
  (409), `TREE_LEVEL_REQUIRED` (403). The shared codes (`TILE_OCCUPIED`, `TILE_NOT_PLANTABLE`,
  `INSUFFICIENT_ITEMS`, `INVENTORY_LIMIT_EXCEEDED`, `CONFLICT_STALE_STATE`,
  `IDEMPOTENCY_CONFLICT`, `PROGRESSION_CONFLICT`) keep their existing meanings.
