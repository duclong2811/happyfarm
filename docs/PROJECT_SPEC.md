# Project Specification

## Product vision
A relaxing, scalable 3D browser farming game with the accessibility and long-term farm progression of Farm Together-style games, while using original content, visual identity, balance, and code.

## MVP gameplay loop
1. Create player and farm.
2. Unlock starter land.
3. Buy seeds/items from shop.
4. Plant on valid farm tiles.
5. Growth progresses using server timestamps, including while offline.
6. Harvest when mature.
7. Receive server-calculated items, XP, and/or currency.
8. Sell/use items.
9. Gain levels and unlock new content/land.
10. Invite visitors/helpers under explicit permissions.

## MVP systems
- Player/account identity
- Farm ownership and membership
- Logical tile/grid system
- Crop definitions and crop instances
- Plant/grow/harvest
- Offline progression
- Inventory
- Wallet/currency
- Economy ledger
- Shop buy/sell
- XP/levels/unlocks
- Farm expansion
- Basic multiplayer farm room
- Farm roles/permissions
- Save/persistence
- Admin-safe audit foundation

## Post-MVP systems
- Trees
- Animals
- Fish/water plots
- Buildings
- Production/crafting machines
- Decorations
- Tractor/vehicle tools
- Quests/events
- Trading only after economy/security model is mature
- Rich 3D character animation and final UI

## Explicit non-goals for early phases
- High-fidelity art
- Complex combat
- 60 Hz authoritative movement simulation
- Player-to-player economy/trading in MVP
- Blockchain/NFT systems
- Copying proprietary Farm Together data/assets/UI

## Multiplayer roles
OWNER: all farm management actions.
EDITOR: gameplay + building/placement actions allowed by policy.
HELPER: limited farming actions such as plant/water/harvest where enabled.
VISITOR: view and limited safe interactions.

Permissions are server-enforced. Hiding a button is not authorization.

## Economy principles
- Server calculates all prices and rewards.
- Every currency change has a reason and ledger entry.
- Duplicate/replayed requests must not duplicate value.
- Avoid player-to-player transfers until exploit protections and audit tooling exist.

## Save/offline behavior
No per-crop daemon/timer. Persist timestamps and compute elapsed state on access. Realtime broadcasts update connected clients, but reconnecting clients can rebuild from persistent authoritative state.

## Admin requirements
Admin operations must use separate authorization, require explicit reason for high-risk mutations, and create audit records. Admin UI is not part of the first gameplay phase.

## Delivery phases
Phase 0: repo/documentation/tooling/security baseline.
Phase 1: player, farm, tile, IDs, game-data foundation.
Phase 2: crop planting/growth/harvest and offline time.
Phase 3: inventory, economy, shop, ledger, idempotency.
Phase 4: XP, levels, unlocks, farm expansion.
Phase 5: D1 persistence hardening + migrations + integration tests.
Phase 6: Durable Object FarmRoom, multiplayer presence, permissions, ordered commands.
Phase 7: trees, animals, fish, buildings/production.
Phase 8: browser renderer, character/vehicle, UI polish, asset pipeline.
