# V16.2.2D2.3 — B1 Atomic Auto Supply

## Semantics and quantity

For `REPLANT_CROP`, supply priority remains matching seed in Cargo, Warehouse LOAD, policy-authorized Shop PURCHASE, then a named wait. The planner derives actionable demand from the assignment's bounded Work Area snapshot: only valid empty cells are counted; planted, growing, mature, blocked, invalid and out-of-area cells are excluded by the existing target resolver.

`LOAD = min(actionable empty cells, total Cargo free capacity, Warehouse availability)`.

`PURCHASE = min(actionable empty cells, total Cargo free capacity, affordable quantity)`.

There is no independent ten-seed (or other acquisition) batch cap. For a 121-cell area and Cargo capacity 30, an empty actor acquires 30 at a time: approximately 5 acquisition transitions for 121 seeds (30 + 30 + 30 + 30 + 1), versus approximately 13 under ten-seed batching. This is only the supply-transition comparison, not a claim about total Cloudflare or D1 savings. If the actor already carries 7 matching seeds, at most 23 additional units fit; unrelated Cargo also consumes capacity and is never discarded.

## Atomic boundaries

`D1AutoSupplySettlementService` is the production composition seam used by `AdvanceAuto`.

- LOAD composes 5 economic statements (Cargo CAS/marker, Warehouse subtraction, Cargo update/insert, zero-row cleanup) with 2 Auto statements (version/watermark guard and semantic receipt): one 7-statement `db.batch()`.
- PURCHASE composes 5 economic statements (wallet seed, authoritative ledger mutation, Cargo CAS/marker, Cargo update/insert) with the same 2-statement Auto component: one 7-statement `db.batch()`.

The final receipt is also the SQL-level batch-failing guard. It verifies the exact Auto post-state and marker plus the exact Warehouse/Cargo post-state for LOAD, or Wallet/Ledger/Cargo post-state for PURCHASE. A stale zero-row CAS therefore causes a NOT NULL violation before commit; post-batch `meta.changes` is not used as an optimistic atomicity guard.

Manual Cargo LOAD and ordinary Shop BUY keep their existing paths and receipts.

## Identity, replay and convergence

The HTTP request ID is not the economic identity. Auto derives a stable transition ID from actor, assignment, action kind and trusted event time. LOAD/PURCHASE receipts and PURCHASE ledger request IDs use that semantic identity. Exact replay, retry with a different HTTP request ID and concurrent attempts can produce at most one Warehouse/Cargo movement or Gold/Cargo/Ledger effect.

`AdvanceAuto` now calls `LoadCargo.executeAuto` and `PurchaseSupplyIntoCargo.executeAuto`; both preserve their existing authorization, catalogue/category, capacity, quantity, price, wallet and inventory validation before entering the composed D1 boundary. Auto version and `simulation_at` advance in the same batch as supply. A later bounded transition performs Plant; acquisition and Plant are intentionally not merged.

## Proofs

`tests/integration/auto-supply-settlement.test.ts` uses the production service, production D1 repositories and the real migration fixture. It inspects final durable Warehouse, Cargo, actor marker/version, wallet, ledger, Auto state and receipt rows after success, replay/concurrency and failure. It proves conservation, partial capacity/availability/affordability, stale Auto rollback, stale source/container rollback, and Cargo-full rollback with no Gold loss or grant.

Existing domain/API suites prove Work Area demand calculation, priority, Auto Purchase OFF, insufficient-Gold waiting, manual Cargo compatibility, ordinary Shop compatibility and `AdvanceAuto` behavior.

## Scope

- Migration: none.
- Contract change: none.
- Deployment: none.
- B2 blocker: none identified in B1; Harvest/Unload atomic convergence remains intentionally deferred to B2.
