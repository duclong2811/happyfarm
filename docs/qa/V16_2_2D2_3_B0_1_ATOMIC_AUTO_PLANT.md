# V16.2.2D2.3 B0.1 — atomic Auto Plant

Starting commit: `e502bb4550fd1097fdc69dc1fa30d96c75b6b545`.

This slice adds the first offline-Auto-compatible economic boundary without adding reconciliation,
timers, polling, or a public trigger. `autoTransitionId` deterministically names an actor,
assignment, transition kind, cell, and trusted event time. It is used as the durable
`idempotency_keys.request_id`; browser request IDs are not economic identity.

The trusted event-time boundary rejects invalid timestamps, future timestamps, and timestamps before
the current simulation watermark. The caller is application/server code; no public HTTP field is
accepted by this boundary.

The one transaction is composed by `executeD1AtomicAutoPlant`:

1. the prepared Plant component (economic crop/tile/cargo mutation), then
2. `prepareAutoPlantGuardAndAdvance` (versioned `actor_auto_state` update, simulation watermark,
   and semantic transition receipt).

The Auto component performs no batch during preparation. Its final receipt insert uses the proven
SQL-level failure pattern: a stale state update causes a NULL value for the NOT NULL actor identity,
which aborts the same D1 transaction. Duplicate semantic identities fail on the receipt primary key.

No migration was required. Existing `actor_auto_state`, `simulation_at`, and `idempotency_keys`
schema are sufficient. No staging or production deployment was performed.

Focused tests prove successful composition, stale Auto rollback, trusted event-time validation, and
the B0.0.2 result/rollback foundation. Full online `AdvanceAuto` routing remains deferred because
it requires a broader executor adapter and is deliberately not refactored in B0.1.

Deferred before B1: production-grade replay response mapping, concurrent end-to-end settlement using
the real cargo/crop fixtures, and the full offline reconciliation loop.

## B0.1.2 controlled boundary pass

The application boundary now keeps Plant validation and preparation in `PlantCrop`, while accepting
an internal Auto context only for the Auto cargo path. Manual Plant continues to use the existing
request-id settlement. `AdvanceAuto`'s PLANT branch supplies actor, assignment, cell, server event
time, expected Auto version, and expected simulation watermark; the browser request ID is not used
as the semantic economic identity.

The Worker adapter composes the real `D1CropRepository` prepared cargo mutation with the prepared
Auto state/receipt component through one `executeD1AtomicAutoPlant` call. Other AdvanceAuto actions
remain unchanged. The online fixture now applies migration `0027_auto_simulation_watermark.sql`.

Validated so far:

- real online AdvanceAuto fixture: 11/11 tests pass;
- atomic composition fixture: 7/7 tests pass;
- full Vitest: 175 files / 1,717 tests pass;
- typecheck and lint pass.

This is not yet the final B0.1.2 completion proof: the required real-repository exact replay,
same-state concurrency, full Cargo-shortage/occupied-target/stale-Auto matrix, and explicit
zero-durable-mutation preparation test still need to be added before declaring the boundary complete.

## B0.1.3 Real-Repository Proof Closure

The proof pass added a regression test for semantic identity stability and corrected a real bug found
during adversarial review: Auto idempotency lookup now uses the server-derived semantic transition ID
before preparation, rather than the browser HTTP request ID. A retry with a different HTTP request ID
therefore cannot manufacture a second receipt for the same authoritative context.

Current validation is 176 test files / 1,719 tests, including 20 focused B0.1.3 tests, plus passing
typecheck, lint, and diff-check. The online Auto fixture uses the real migration path through
`0027_auto_simulation_watermark.sql` and the real handler/repository wiring.

Still outstanding before the final B0.1 completion verdict: explicit real-repository preparation
zero-mutation snapshots, exact replay and two-attempt same-transition proof, competing-transition
proof, and the complete real Cargo-shortage/occupied-target/stale-Auto rollback matrix. No migration
or deployment was performed.

## B0.1.5 Production settlement service and final real-repository proof

`D1AutoPlantSettlementService` is the production seam used by the handler and by integration tests.
`prepare()` validates trusted event time and creates the real prepared Crop and Auto components without
executing D1. `settle()` submits those components through exactly one `executeD1AtomicAutoPlant`
batch. `AdvanceAuto` reaches it through `PlantCrop.executeFromCargoAuto`; no Auto caller invokes the
legacy cargo Plant settlement directly.

The fixture in `tests/integration/auto-plant-settlement.test.ts` uses `schemaSql()`—all repository
migrations in production order—plus `NodeD1Database`, `D1CropRepository`,
`D1AutoTravelRepository`, and the production settlement service. It includes real player, farm,
membership, work area/cells, job, actor, Auto state/watermark, Cargo, farm tiles, crops, wallets,
progression, and idempotency tables.

All seven closure proofs pass:

- preparation leaves byte/logically identical durable snapshots;
- exact semantic replay consumes one seed and leaves one crop, one Auto advance, and one receipt;
- two concurrent attempts for the same transition produce one winner/economic effect;
- two distinct transitions from one expected Auto state produce at most one winner;
- stale/short Cargo rolls back every mutation;
- an occupied target rolls back every mutation;
- stale Auto version rolls back Plant, Cargo, watermark, and receipt.

Adversarial concurrency exposed winner-state confusion in the former zero-row guard: a losing
transition could observe a winner's expected post-state. The fix reuses the existing
`actors.cargo_transfer_id` request marker. Cargo claim, mutation, version bump, Auto receipt, and
semantic transition are now tied to one marker; no migration was needed.

Focused result: 9 files / 88 tests passed. Full-suite and static-check results are recorded in the
final task report. No staging or production deployment occurred. B1 supply behavior and all
Cloudflare batching remain deferred.
