# V16.2.3D1 World resource zones

## Scope and audit

This slice establishes the zone/resource foundation only. It does not bind Forestry, Mining, or
Fishing to Production Rate and does not add rewards or a migration.

The existing architecture already contains the required bounded seams:

- `apps/web/src/render/world-cell.ts` is the client coordinate vocabulary. It separates terrain,
  zone, ownership, occupancy, capabilities, and production capability.
- `packages/game-data/src/world/geography.ts` is the server-readable island rule. `groundCapabilities`
  maps dry land to Forestry-capable ground, volcano foothill to Forestry, volcano slope to Mining,
  and the shallow shelf to Aquaculture. Water, harbour protection, crater, and protected ground are
  refused by the same rule.
- `packages/domain/src/work-area.ts` stores `FARM | ORCHARD | FORESTRY | MINING | LIVESTOCK |
  AQUACULTURE`, derives the required ground capability, bounds member cells, and derives the current
  Home Island zone id from the authenticated farm. Work Area membership is metadata, not ownership or
  occupancy.
- `packages/game-data/src/resources/index.ts` already provides mining and forestry definitions,
  drop tables, static node placements, finite regeneration timings, and the `MINE`/`CHOP` verb.
  Apple/orchard trees remain separate farm lifecycle entities.
- `packages/application/src/resources.ts` already provides server-authoritative node availability,
  action timing, level checks, bounded zone-scoped reads, regeneration-by-clock comparison, and
  atomic settlement through the existing resource state/action repositories.
- `packages/game-data/src/fishing/index.ts` already provides explicit Home Island fishing spots,
  freshwater/coastal tables, fish definitions, and fish output items. Fishing is water/shore based,
  not a land-farming node.
- `packages/domain/src/job.ts` and `packages/application/src/jobs.ts` already validate Forestry and
  Mining targets against resource definitions. Aquaculture remains storable as a Work Area kind but
  is intentionally not an executable worker target yet.
- `packages/domain/src/production-rate.ts` and Orchard binding remain unchanged. D2 must add a
  resource-to-Production binding separately; it must not reuse Orchard's Apple source identity.

## Zone model

No new generic zone abstraction was added because the repository already has the smallest shared
contract needed: `zoneKind + zoneId` on Work Areas, resource actions, resource node state, and fishing
definitions. The current zone is `HOME_ISLAND`; the id is derived as `zone_home_island_<farmId>` and
is never accepted from a client. A future shared/contested zone can use the same state keys after
adding its presence/authorization authority.

Eligibility is authoritative and bounded:

- Forestry: land/woodland or volcano foothill cells with `FORESTRY` capability; target nodes use
  `CHOP`, Wood/Resin/Hardwood tables, and regeneration state.
- Mining: volcano slope cells with `MINING` capability; target nodes use `MINE`, Stone/Copper/Coal/
  Iron tables, and finite node regeneration. Ore is never created from an unlimited client value.
- Fishery: authored pond/harbour spots use explicit Home Island zone metadata and water/coastal
  positions. Aquaculture Work Areas are stored for the future distinct fishery source model, but no
  land farming rule or Production Rate binding is introduced here.

Visual meshes are not authoritative. Node definitions and server geography decide eligibility;
renderer models are presentation only. Reads remain zone-scoped and event-driven; regeneration is a
timestamp comparison, not a timer, cron, per-node process, frame loop, or whole-world rebuild.

## Persistence and ownership

No persistence change was needed. Existing migration `0017_resource_nodes.sql` stores mutable node
availability keyed by `(zone_id, node_id)` and active resource actions. Static definitions and
placements remain game data. Existing Home Island ownership/authentication derives the zone from the
authenticated player/farm; request bodies cannot select another owner's zone. Migration `0029` was
not modified.

There is no economic cutover in D1. Manual mining, forestry, and fishing continue through their
existing authoritative Warehouse settlement paths. Auto/Production Rate integration is explicitly
deferred to D2.

## Validation coverage

Existing deterministic tests cover the foundation:

- `tests/domain/work-area.test.ts`: capability mapping, invalid ground, bounded/deduplicated cells,
  and Home Island zone derivation.
- `tests/domain/resource.test.ts`: finite drop validation, MINE/CHOP lifecycle shape, regeneration,
  and server-time availability.
- `tests/game-data/mining.test.ts`, `tests/game-data/fishing.test.ts`, and the forestry portions of
  the resource catalogue tests: definitions, placements, material/fish references, and zone metadata.
- `tests/api/mining-loop.test.ts` and `tests/api/forestry-loop.test.ts`: authenticated start/settle,
  finite node state, regeneration, replay/race guards, and Warehouse settlement.
- `tests/web/world-cell-capabilities.test.ts`, `tests/web/mining-interaction.test.ts`, and
  `tests/web/forestry-interaction.test.ts`: client presentation follows the shared cell/node
  vocabulary without making visuals authoritative.

Recommended focused command:

```text
npx vitest run tests/domain/work-area.test.ts tests/domain/resource.test.ts tests/game-data/mining.test.ts tests/game-data/fishing.test.ts tests/api/mining-loop.test.ts tests/api/forestry-loop.test.ts tests/web/world-cell-capabilities.test.ts tests/web/mining-interaction.test.ts tests/web/forestry-interaction.test.ts
```

## D2 recommendation

D2 should add only a resource-node Production Rate adapter: resolve a Forestry/Mining Work Area's
eligible nodes from authoritative member cells, preserve node state/regeneration, use a distinct
source/assignment identity, and settle actual finite output through the centralized inventory/
Warehouse path. Fishing should remain a distinct source family (or explicit future aquaculture
source type), with water/coast eligibility and fish stock semantics rather than a land-node reuse.
No NPC visual state, client timer, mesh scan, or new generic god service should be part of that work.
