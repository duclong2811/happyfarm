# D1 atomic batch composition

Planting is still owned by `PlantCrop` and `D1CropRepository`. The repository prepares the existing
seed, tile, crop, and idempotency statements, then submits them through the trusted
`executeD1AtomicBatch` boundary in `workers/api/src/d1-atomic-batch.ts`.

The boundary flattens trusted components into one `db.batch()` call and slices positional results back
to each component verifier. It accepts no HTTP data and no arbitrary SQL from callers. The trusted
Worker repository now exposes `D1CropRepository.preparePlantFromCargoSettlement(...)`, which returns
one such component without executing it. `plantFromCargoAtomically(...)` is the compatibility wrapper
that prepares the same component and executes a one-component batch.

An optimistic `UPDATE ... WHERE version = ?` that affects zero rows is not enough by itself: verifying
that result after `db.batch()` is too late to undo an already committed batch. Future Auto components
must encode their conflict as a SQL constraint/marker failure inside the same batch. This is the
required B0.1 integration point:

```ts
const preparedPlant = cropRepository.preparePlantFromCargoSettlement(/* trusted prepared inputs */);
// B0.1 will provide this second trusted component.
await executeD1AtomicBatch(db, [preparedPlant, preparedAuto]);
```

No Auto state, simulation time, transition receipt, or gameplay behavior is implemented here.
