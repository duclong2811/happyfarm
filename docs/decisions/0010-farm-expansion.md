# ADR 0010: Farm expansion

Status: Accepted (independent audit completed 2026-09-29; pending commit)

## Decision

Farm land is represented only by `farm_tiles`. The starter square is `6 x 6`; each purchased plot
adds another authoritative `6 x 6` cohort using the deterministic ring layout in
`packages/domain/src/plot.ts`. There is no second unlocked-land table or client-authored boundary.

Plot price, currency, order, and required player level are validated game data. The expansion
command accepts only a request ID; the server selects the next contiguous plot from the farm's
existing tiles. Only the farm `OWNER` may expand it.

The wallet debit, immutable `FARM_EXPANSION` ledger row, 36 tile inserts, and completed idempotency
record are one D1 batch. A duplicate request returns the stored result and original balance. A
wallet race or competing purchase rolls the whole batch back and may be retried; partial land is
never produced by this write path.

## API

- `GET /farms/:farmId/plots` lists the server catalogue with this farm's unlock state.
- `POST /farms/:farmId/plots` accepts `{ requestId }` and buys the next plot.

The browser displays the catalogue and sends no plot ID, price, currency, level, coordinates, or
tile state. Production authentication remains fail-closed.

## Consequences

- Existing planting authorization continues to use tile existence as unlocked land.
- The economy ledger vocabulary gains the paired reason/reference
  `FARM_EXPANSION` / `PLOT`; migration `0006_farm_expansion.sql` rebuilds the ledger without
  rewriting prior rows and recreates its indexes and immutability/wallet triggers.
- A malformed partial plot fails closed: it is not reported as unlocked and cannot be purchased
  again because colliding tile inserts abort the atomic batch.
