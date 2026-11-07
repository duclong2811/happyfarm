# V16.2.2D2.3B0.0 — composable D1 batch

Implemented the infrastructure-only boundary for the existing PlantCrop settlement.

- Existing crop repository remains the batch owner for preparation and authoritative crop rules.
- `executeD1AtomicBatch` composes trusted prepared components and slices result ranges deterministically.
- `D1CropRepository.preparePlantFromCargoSettlement(...)` exposes the existing cargo-funded Plant
  mutation as a non-executing trusted component; the ordinary repository method uses that component.
- Manual and current online cargo planting use the same settlement semantics as before.
- No Auto repository dependency was introduced into the crop/domain layer.
- No migration, public endpoint, offline loop, simulation watermark, or UI change was added.

Important D1 behavior: a zero-row optimistic update does not itself roll back a successful batch.
Therefore a future Auto guard must fail inside SQL (using an existing constraint/marker pattern), not
only in a post-batch verifier.

Preparation itself only builds prepared statements and performs ownership-shape validation; it does
not call `db.batch()` or mutate durable state. Full tests, builds, and deployment remain to be run
before any staging decision.
