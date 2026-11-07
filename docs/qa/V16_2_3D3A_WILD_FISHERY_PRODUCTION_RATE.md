# V16.2.3D3A — Wild Fishery Production Rate

Status: bounded implementation complete; no deployment or remote migration was performed.

## Audit result

The existing fishing slice had the correct Player → Home Island → `FishingSpot` → `FishingTable` →
`Fish` shape, server-owned catch rolls, `fishing_actions`, weighted freshwater/coastal tables and
ordinary `FISH` inventory items. It did not have mutable spot stock or regeneration: the existing
spot catalogue was static and manual settlement changed only the action, inventory and progression.
There was also no wild-fishery Work Area/job kind; `AQUACULTURE` was reserved as a future water system.

The existing Production Rate contract is one assignment/source and one output item. It cannot emit a
weighted multi-species table directly, so the binding pins one server-random table entry once. Manual
fishing continues to roll the same weighted table per action. The pinned automated item is durable in
the Production Source row and is never client supplied.

## Implementation

- Added `FISHERY` as a distinct Work Area and Job kind. `AQUACULTURE` remains unavailable for jobs and
  was not cut over.
- Added the `FISHERY` terrain capability to natural water, including the authored pond and harbour
  water. Shallow water also keeps its existing `AQUACULTURE` capability.
- Added bounded fishing spot policy data: maximum stock, regeneration seconds and production units/hour.
- Added `fishing_spot_states` in migration `0030_wild_fishery_stock.sql`. State is keyed by
  `(zone_id, spot_id)` and stores stock, regeneration anchor and optimistic version. Regeneration is
  calculated with elapsed server time; there is no timer or per-fish row.
- Manual start checks stock and manual settle consumes the same state as Production Rate. The action,
  stock, inventory, XP and idempotency receipt commit atomically.
- Added wild-fishery Production binding/context. Eligibility re-reads the farm-owned Work Area,
  exact `WorldCell`, spot definition, natural-water capability, zone, enabled state and current stock.
  A spot outside the Work Area, on land, depleted, or belonging to another job family contributes zero.
- Production settlement guards assignment/source/warehouse/inventory and fishing spot state in one D1
  batch. The production source's finite stock is a derived snapshot/cache; fishing spot state is the
  authority and is updated in the same transaction when output is produced.
- Added worker-panel target data for authored fish spots and kept the existing shared reconcile result
  (`producedItems`) so the established offline-return popup path needs no redesign.

## Acceptance coverage

`tests/integration/wild-fishery-production-d3a.test.ts` proves through real HTTP and D1:

- manual fish consumption before binding;
- no pre-seeded assignment or source;
- FISHERY Work Area → FISHERY job → durable finite binding;
- five-hour settlement is bounded by regenerated spot stock;
- Warehouse/inventory output and idempotent reconcile;
- land Work Area rejection;
- Aquaculture/pond distinction;
- outside-spot Work Area exclusion;
- forestry/mining target exclusion under FISHERY.

Focused regression suites also pass for the existing fishing loop, fishing/game-data/domain rules,
Work Area/job contracts, D2 Forestry/Mining Production Rate, and migration foreign-key coverage.

## Migration and validation

- `0029_production_rate_core.sql`: untouched.
- `0030_wild_fishery_stock.sql`: new, not applied remotely.
- No deployment, commit or push.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `git diff --check`: pass; Git reports existing LF/CRLF normalization warnings only.
- Focused Vitest: pass (D3A acceptance plus fishing, Work Area/job, D2 regressions).

## Remaining boundaries

- Automated wild fishing pins one weighted species per assignment because the current Production Source
  DTO is single-output. A future multi-output source contract can model per-hour weighted species while
  preserving table semantics more literally.
- Aquaculture, boats, docks as economic/progression systems, shared water zones and presence/location
  trust remain out of scope.
- No production reward or Production Rate core rewrite was added; fish outputs use existing item and
  Warehouse paths.

## Recommended next scope

The next fishery slice should add harbour/boat interaction only after the shared water/presence rules
are specified. Aquaculture should get its own source type and state model rather than reusing wild
fishery spot stock. A later multi-output Production contract can remove the one-entry binding pinning
decision if exact weighted automation is required.

## Verdict

`V16_2_3D3A_WILD_FISHERY_PRODUCTION_RATE_COMPLETE`
