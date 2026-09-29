# Architecture

## Goal
A Cloudflare-native browser farming game whose core simulation is independent from its final 3D renderer.

## High-level system

```text
Browser (React + Three.js)
        |
        | HTTPS / WSS
        v
Cloudflare Workers API / Durable Objects -------- R2 (assets)
        |
        v
packages/application
        |
        v
packages/domain
        ^
        |
repository ports implemented by infrastructure adapters
        |
        +---- D1 (persistent player/business state)
```

The browser never imports application services, domain services, repositories, or infrastructure adapters. It sends validated intent through contracts to Workers/Durable Objects.

## Compile-time dependency rules

```text
apps/web -> packages/contracts

workers/* -> packages/contracts
workers/* -> packages/application
workers/* -> infrastructure adapters where required

packages/application -> packages/domain
infrastructure adapters -> implement ports/interfaces owned by application/domain
```

- `packages/domain` has no dependency on React, Three.js, Cloudflare APIs, D1, Durable Objects, browser APIs, transport code, or frontend code.
- `packages/contracts` has no dependency on application or infrastructure.
- `packages/game-data` contains static definitions/configuration, not player state. It has no dependency on frontend or infrastructure and should avoid depending on application.
- Domain/application code consumes validated game data through explicit interfaces or loaders. Circular dependencies are forbidden.

## Layers
### Domain (`packages/domain`)
Pure deterministic game rules: farming, inventory rules, economy rules, progression, animals, fishing, buildings, world rules, permissions. No I/O.

### Application (`packages/application`)
Use cases such as PlantCrop, HarvestCrop, BuyItem, SellItem, UnlockLand, PlaceBuilding, FeedAnimal. Coordinates repositories and domain rules.

### Contracts (`packages/contracts`)
Versioned REST/WebSocket DTOs, identifiers, error codes, and runtime validation schemas. Do not expose raw DB rows directly.

### Game data (`packages/game-data`)
Static definitions for crops, trees, animals, fish, items, buildings, shops, recipes, progression, and permissions. Player-owned or mutable instance state does not belong here.

### Infrastructure
Workers, D1 repositories, Durable Objects, R2 asset lookup, auth adapters, logging.

## Farm scaling model
Use `farmId` as the natural realtime partition key. A busy farm should not block unrelated farms.

## Offline simulation
Persist timestamps and state anchors. Compute current state from server time when needed. Avoid per-object ticking.

## Persistent versus realtime state
D1: player accounts, farm ownership/membership, inventory, wallets, ledger, progression, durable farm state, idempotency records, audit events.

Durable Objects: active presence, ordered farm commands, WebSocket sessions, temporary realtime coordination, broadcasts, optional hot state cache.

## Rendering boundary
Server stores logical entities and coordinates. Renderer maps logical state to Three.js objects. Changing models/materials/UI must not require gameplay migrations.

The client's world is anchored to a **fixed coordinate frame**: the centre of the starter land is world
origin for the life of the farm, and `apps/web/src/render/layout.ts` owns the only tile-to-world
mapping. Camera framing, zoom, and pan are separate concerns and can never change a tile's world
position, so unlocking land does not move crops, trees, scenery, the spawn, or (later) the player. The
static world - island, water, paths, pond, farmhouse yard, decorative scenery, and the reserved future
regions - comes from `apps/web/src/render/world-config.ts` and is client/static, never authoritative:
land ownership stays in `farm_tiles`, and crop/tree occupancy stays in their instance rows.

## Security boundary
Everything from browser, query strings, storage, headers, HTTP body, and WebSocket messages is untrusted until validated, authenticated, and authorized server-side.

## Core invariants
- Frontend never owns authoritative economy.
- Frontend never talks directly to D1.
- Server time determines progression.
- Inventory and economy mutations have single authoritative services.
- Schema changes use migrations.
- Multiplayer never bypasses domain/application rules.
- Rendering never becomes a dependency of domain logic.
