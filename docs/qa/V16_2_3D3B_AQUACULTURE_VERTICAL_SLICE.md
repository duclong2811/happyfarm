# V16_2_3D3B — Aquaculture first vertical slice

## Scope and verdict

This slice implements one manual, server-authoritative farmed-fish cycle. It does not add automatic
repeat cycles, feed, breeding, boats, sea cages, or a new Production Source type.

`V16_2_3D3B_AQUACULTURE_COMPLETE`

## Existing systems reused

- `WorldCell`/`classifyTile` and the existing shallow-water placement rule.
- The existing `AQUACULTURE` Work Area kind and explicit member-cell repository.
- The existing `place_fish_cage` construction and `prop_cage_small` asset as the first pond structure.
- The existing item registry's `item_fish_tilapia` stocking item.
- The existing `InventoryService`, Warehouse capacity trigger, request idempotency table, farm membership,
  and construction ownership rules.
- Server `Clock` injection, following crop/tree lifecycle projection without timers or per-frame writes.

No existing fishery stock table is reused: wild fishery stock is a different source and remains distinct.

## Pond eligibility and ownership

A pond is the existing active `place_fish_cage` construction, standing in a server-validated shallow-water
cell that belongs to an explicit `AQUACULTURE` Work Area. The construction placement path rejects land,
open water, protected ground, overlap, insufficient level, and insufficient funds. Stock and harvest
require authenticated farm OWNER or EDITOR membership; a construction from another farm resolves as not
found. The client cannot provide an owner, zone, terrain result, reward, or ready timestamp.

## Lifecycle and economy

Migration `0031_aquaculture_pond_cycle.sql` adds `aquaculture_pond_states`, keyed by the existing
construction id. It stores only species, `stocked_at`, `ready_at`, and a guarded version. The initial
cycle consumes exactly one `item_fish_tilapia` fingerling from Warehouse and, after 3,600 authoritative
server seconds, adds exactly one `item_fish_tilapia_adult` to Warehouse. The adult fish has its own sell
entry at 5 Gold; the fingerling purchase remains 3 Gold, so a complete buy/stock/harvest/sell cycle has
a server-defined +2 Gold margin per fish before cage cost. Existing `item_fish_tilapia` inventory is not rewritten because
its historical source cannot be inferred. Every new cycle therefore has a real input; there is no
unlimited fish creation or input returned as output.

Stocking is an atomic D1 batch: inventory subtraction, pond state transition, and idempotency receipt.
Harvest is an atomic D1 settlement: the settlement trigger validates the active pond, farm membership,
species, pond version, and ready time; it applies the Warehouse addition and resets the pond together.
The Warehouse capacity trigger is the final capacity authority. A full Warehouse aborts the settlement,
leaving the pond READY and the input/output inventory unchanged.

Repeated harvest with a new request after a successful harvest returns a conflict and adds zero. Reusing
the same request id replays the stored response. Pond versions and unique `(construction_id, pond_version)`
settlements protect multi-tab races.

## Production Rate decision

The existing Production Rate core models continuous, assignment-driven output. A stocked pond is a
discrete input → growth → harvest lifecycle, so forcing it into Wood/hour semantics would lose the
stocking and readiness invariants. D3B therefore uses the existing lifecycle/harvest shape with a
small aquaculture settlement adapter. Automatic worker execution and repeated cycles remain D2/D3C
follow-up work and are intentionally not enabled here.

## Visual states and performance

The existing cage model is reused. `GET /farms/:farmId/aquaculture/ponds` returns `EMPTY`, `STOCKED`,
`GROWING`, or `READY`, derived from the server clock. The web client reads that bounded list with the
construction refresh and shows the selected pond's state in the build status line. There is no frame
loop database request, hourly simulation loop, or client-authoritative growth.

## Acceptance proof

`tests/integration/aquaculture-vertical-slice-d3b.test.ts` uses `NodeD1Database(schemaSql())` and the
actual HTTP handler. It proves:

- valid shallow-water AQ area and real pond placement;
- land placement rejection and missing-area rejection;
- fish inventory is consumed by stocking;
- clock-only offline progression through Growing to Ready;
- Warehouse fish increase on real harvest;
- duplicate harvest adds zero;
- Warehouse-full harvest rolls back and leaves READY state intact;
- cross-farm pond access is rejected.

Migration 0031 is local only. Migrations 0029 and 0030 were not modified or applied remotely.

## Validation

- Focused D3B Vitest: passed (2 tests).
- Existing Apple, forestry/mining, and wild-fishery suites remain the regression set to run with the
  final validation commands.
- Required final checks: `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.

## Remaining automation work

Future automation needs an aquaculture-specific discrete-cycle assignment contract: worker travel and
pond interaction, repeat stocking input policy, feed (if introduced), bounded reconciliation, and a
settlement cursor that cannot manufacture cycles. It should remain separate from continuous Forestry,
Mining, and Wild Fishery Production Rate sources unless a discrete adapter is designed and tested.
