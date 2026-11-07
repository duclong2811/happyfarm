# V16.2.3D2 — Forestry + Mining Production Rate

Status: bounded implementation complete; no deployment, migration application, commit, or push was performed.

## Existing systems reused

- `WorldCell`/tile coordinates and the server `groundCapabilities` lookup remain the terrain authority.
- `WorkArea` owns bounded cell membership, farm ownership, and kind-to-ground validation.
- `ResourceDefinition`/`ResourceNode` game data supplies the existing `CHOP` and `MINE` verbs, drop items, action timing, and regeneration timing.
- `resource_node_states` remains the mutable node authority. A missing row means available; a row is depleted until its server timestamp.
- `actor_jobs` remains the worker/job authority. Forestry and Mining resource targets now enter `RATE_PRODUCTION`.
- `production_sources`, `production_assignments`, the shared Production Rate domain calculation, Warehouse, receipts, and authoritative `Clock` are reused.
- Manual resource actions still use `StartResourceAction`/`SettleResourceAction` and the existing atomic resource settlement boundary.

No Fishing, Aquaculture, NPC movement, animation, or visual mesh code was given economic authority.

## Forestry

The adapter supports the catalogued `resource_wildwood`, `resource_pine`, and `resource_hardwood` definitions. It requires a `FORESTRY` Work Area, matching `CHOP` target, valid Forestry ground, matching authored node definition, cell membership, and an available node state. Output is taken from the existing deterministic drop table: Wildwood produces `item_wood`, Pine produces `item_resin`, and Hardwood produces `item_hardwood`.

`productionUnitsPerHour` is definition-owned game data. The initial profile is one output unit per available matching node per hour. The source rate is therefore calculated server-side from eligible nodes, never from meshes, actor position, or client counts.

When a Forestry settlement produces output, the same `resource_node_states` rows are depleted in the same D1 batch as the inventory, assignment cursor, source-rate refresh, and production receipt. Regeneration uses the existing `regenerationSeconds` timestamp rule; no timer or hourly loop is created.

## Mining

The adapter supports `resource_stone`, `resource_copper`, `resource_coal`, and `resource_iron`. It requires a `MINING` Work Area, matching `MINE` target, valid Mining ground, matching authored node definition, cell membership, and an available node state. The initial deterministic output mapping is Stone, Copper Ore, Coal, and Iron Ore respectively.

Mining does not create an independent ore balance. A deposit is finite for its current availability window: settlement consumes the existing node availability and writes its regeneration timestamp. Regenerating definitions become available only according to their existing server timestamp. There is no unlimited source stock, and no permanent `remaining_stock` shortcut was added to Production Rate.

The current D1 resource schema stores node availability/regeneration rather than a numeric reserve column. That existing semantics is preserved exactly; a future non-regenerating or quantity-based deposit needs an explicit resource-state schema decision before D3/D4.

## Binding and shared authority

Creating a valid Forestry or Mining rate job immediately calls the corresponding adapter. It creates one deterministic Production Assignment and one source, with family-specific source ids (`production_source_forestry_*` or `production_source_mining_*`) and the existing assignment id convention. Reconciliation also re-establishes the binding defensively, but does not wait for offline return to create it.

Before settlement, the adapter re-reads the assignment’s job, Work Area cells, bounded zone state rows, catalogue definitions, and server terrain capabilities. A mixed Work Area ignores wrong-definition, wrong-verb, wrong-profession, outside-area, depleted, and wrong-ground nodes.

Manual-first cross-authority acceptance passed: manual CHOP depleted the node, immediate Production binding resolved a zero rate, and reconciliation credited no automated output. Production settlement writes the same node-state table, so the reverse direction is also guarded by the shared state write in the settlement batch.

## Warehouse, time, replay, and concurrency

- Warehouse capacity and blocked-cursor behavior remain the shared Production Rate behavior.
- The shared 24-hour offline cap remains in `settleProduction`; no profession-specific cap or polling loop was added.
- Semantic idempotency remains assignment-cursor/receipt based, independent of a caller choosing a new HTTP request id.
- D1 guards assignment version/cursor, source version/rate, Warehouse version/capacity, inventory quantity/version, production receipt uniqueness, and each resource-node availability/version before the batch can claim output.
- Reads are bounded to one Work Area’s cells and one zone’s `resource_node_states` range plus the small static game-data catalogue. There is no per-frame settlement, per-NPC write, hourly loop, or whole-world scan.

## Terrain correction found during acceptance

The D1 audit exposed that the original authored Wildwood/Pine coordinates were on volcanic Mining or blocked cells. They were moved to valid Forestry-capable land cells in game data. Island geometry was not regenerated or changed; the server Work Area rule remains strict.

## Persistence and migrations

No migration was required. Existing `0029_production_rate_core.sql` and all prior migrations are unchanged. No remote migration was applied.

## Acceptance evidence

Focused real HTTP/D1 suite: `tests/integration/forestry-mining-production-d2.test.ts` — 3 tests passed.

- Forestry: one Wildwood node, 5 authoritative hours, Wood `10 → 15`, node version `1 → 2`, retry `+0`.
- Mining: one Stone node, 3 authoritative hours, Stone `10 → 13`, node version `1 → 2`, retry `+0`.
- Manual CHOP first: Production binding rate `0` while the same node was depleted, reconcile `+0`.

Focused resource suite: 6 files / 32 tests passed, including the new deterministic mixed-node and regeneration eligibility tests plus existing Forestry/Mining loop coverage.

Apple regression suites were run. The existing static Apple binding assertion was restored by retaining the proven creation contract marker; Apple behavior and the full HTTP/D1 path remain unchanged.

## Recommended D3 scope

Implement Fishery/Aquaculture as a separate source family. Reuse bounded Work Area/water eligibility and authoritative fish stock only where the existing fishing model supports it, but do not force pond/harbour/boat fishing through `MINE`/`CHOP` or the Forestry/Mining node adapter.

## Known limitations

The current D1 node model represents finite-per-regeneration availability, not a numeric mineral reserve. D2 deliberately preserves that existing contract and does not invent a second reserve ledger. A permanent finite deposit or quantity-based ore reserve should be designed with its own migration and explicit settlement semantics before it is introduced.
