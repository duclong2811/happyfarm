# Livestock minimum loop — contract draft

Status: design-only, not shipped gameplay.

This document records the smallest livestock vertical slice that can follow the
current server-authoritative farming, shop, inventory, warehouse, version and
idempotency patterns. It does not add game data, a migration, an API route, or
client UI. The values in the economy section are proposals, not live balance.

## Current source audit

| Surface | State | Evidence | Consequence |
| --- | --- | --- | --- |
| Animal definitions | Missing | `packages/game-data/src/animals/index.ts` exports an empty registry | No species can be selected or validated |
| Animal items | Missing | `packages/game-data/src/items/index.ts` has no animal, feed, or animal-product category | Shop and inventory cannot represent the loop |
| Coop asset | Present and usable as presentation | `farm.coop.t1.glb`, `place_coop`, and `farm.coop.t1` model mapping | Placement can render a coop, but this is not an animal instance |
| Coop production metadata | Present but not wired | `place_coop` is `FOUNDATION_ONLY` and its effect is descriptive | No timer or collect command exists |
| Shop | Present for existing systems only | Shop validation allows seeds, aquaculture stock, and current produce/materials | No chick/feed/egg entries |
| Domain/API | Missing | No livestock use case, route, DTO, or client API method | No authoritative command exists |
| Persistence | Missing | No animal-instance or livestock-cycle table/migration | Reload and concurrency cannot be implemented safely |
| Automation | Missing by contract | `LIVESTOCK` has no valid job target prefix | No NPC/Auto work should be enabled |
| Asset animation | Missing for gameplay | Coop model exists; no animal model/animation registry exists | Do not imply live animals from the coop asset |
| Tests | Missing for livestock | Existing livestock references are vocabulary/economy-simulation coverage only | No settlement evidence is available |

## Selected first species

Chicken is the proposed first species because the repository already ships a
chicken-coop asset and placement row. No animal species is currently complete
enough to implement. The first slice should be one species only:

```text
place_coop -> buy chicken -> place chicken in coop -> server-time production
-> collect egg -> Warehouse -> sell egg
```

The first slice does not include disease, breeding, age, death, happiness,
automation, NPC workers, or a new movement/proximity authority.

## Proposed data contract

These identifiers are drafts and must not be added to registries until the
economy decision is approved:

- animal: `animal_chicken`
- purchase item: `item_chicken`
- feed item: `item_poultry_feed`
- output item: `item_egg`
- production host: a persisted `place_coop` construction

An animal instance should contain a stable ID, farm ID, coop construction ID,
animal definition ID, state, production anchor timestamps, version and audit
timestamps. The server, never the browser, derives the next ready time.

Suggested commands, after contracts exist:

- `POST /farms/:farmId/livestock/purchase` — buy one server-defined chicken;
- `POST /farms/:farmId/livestock/:animalId/place` — bind an owned chicken to an
  owned coop, guarded by coop capacity and expected coop version;
- `POST /farms/:farmId/livestock/:animalId/feed` — consume the server-defined
  feed amount and start/advance the server-time cycle;
- `POST /farms/:farmId/livestock/:animalId/collect` — settle only when the
  server clock says ready, atomically crediting Warehouse and advancing the
  animal version.

Every mutation must carry a request ID. The settlement must guard actor/farm
ownership, coop capacity, animal version, Warehouse capacity and idempotency in
one atomic repository operation. A replay returns the original result and does
not grant another egg.

## Construction policy required before shipping

The existing Move/Rotate/Store/Delete construction actions must consult one
livestock policy. While a coop has bound animals:

- rotate is allowed only if the existing occupancy policy can preserve the
  binding;
- move requires an atomic revalidation of the destination and keeps the same
  coop ID and animal timers;
- store/delete must be refused unless a separate, explicit animal-transfer
  command exists;
- no action may reset production timestamps or silently discard animals.

Until this policy and the animal rows exist, the current construction controls
must not claim to manage livestock.

## Economy proposal — not official

One concrete starting option for review:

| Parameter | Proposal |
| --- | ---: |
| Chicken purchase | 20 gold each |
| Coop capacity | 4 chickens |
| Feed per chicken per cycle | 1 `item_poultry_feed` |
| Feed purchase | 1 gold per unit |
| First/next production time | 900 seconds |
| Output | 1 egg per ready chicken |
| Egg sale | 4 gold |
| Gross margin per fed cycle | 3 gold/chicken before coop cost |

This proposal intentionally does not reuse the existing potato seed or crop
price as feed. The current economy model's representative livestock pen and
`item_eggs` values are simulation inputs, not runtime item/shop definitions.

## UI contract after the server surface exists

Clicking a livestock-capable coop may open a dedicated livestock panel. The
construction Move/Rotate/Store panel remains separate. The livestock panel must
derive actions from server capability and show explicit states:

- loading/error;
- empty: `Đưa gà vào chuồng`;
- occupied but unfed: `Cho ăn`;
- producing with server-derived ready time;
- ready: `Thu trứng`;
- Warehouse-full or stale-state error with a refresh from the mutation response.

The panel must update egg quantity only after collect success. It must not poll
per frame, auto-settle on selection, or claim that a standing character/NPC has
fed an animal.

## Acceptance matrix for the future implementation

The isolated local farm test must cover:

1. buy chicken debits gold and creates exactly one owned purchase result;
2. place refuses a foreign coop, a full coop, and stale coop version;
3. feed debits exactly the server-defined feed amount;
4. collect before ready is refused; collect at/after ready credits exactly one
   egg and advances the server timestamp/version;
5. duplicate request IDs replay without a second debit or grant;
6. cross-farm, stale-version, insufficient inventory and Warehouse-full cases
   leave state unchanged;
7. reload/reconciliation uses persisted timestamps and never resets or doubles
   production;
8. Move/Store/Delete cannot lose a bound animal or reset its timer.

No livestock browser PASS can be claimed until these commands exist and a real
browser session completes buy -> place -> feed -> wait -> collect -> sell.
