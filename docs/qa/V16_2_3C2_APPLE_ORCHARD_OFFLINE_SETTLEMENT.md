# V16.2.3C2.1 — Apple Orchard Offline Settlement

## Flow

Farm reconciliation is a protected, explicit `POST /farms/:farmId/production/reconcile` command. The
server lists current farm Work Assignments, ensures each valid Apple Orchard `RATE_PRODUCTION` binding,
reloads persisted Production Assignments, and settles each through `SettleProductionAssignment`. The
work is bounded by active Work Assignments plus active Production Assignments, never offline hours,
produced quantity, NPC actions, or a timer.

The client invokes this once during Farm load and once after a meaningful hidden-to-visible transition
(60 seconds). A shared in-flight Promise prevents overlapping load/return calls. The existing 5-second
growth refresh does not invoke production reconciliation. After a successful reconciliation, the normal
authoritative account refresh updates Warehouse/inventory state.

## Authority and presentation

The request contains only `requestId`; the server derives assignments, sources, trees, rates, elapsed
time, Warehouse capacity, and output. The response aggregates actual credited item quantities. The client
shows a compact localized “while away” status only when actual quantity is positive; zero, blocked, or
failed reconciliation produces no reward display. No client clock, hidden duration, tree count, or rate
calculates an economic result.

Legacy jobs are excluded because the server filters linked assignments by `RATE_PRODUCTION`, and the
bind-before-settle discovery filters only `ORCHARD/tree_apple` jobs in that mode. Cargo, NPC position,
wallet, market, and ledger behavior are not involved.

## Persistence

Orchard binding remains deterministic/idempotent through the existing C1 use case and D1 batch adapter.
Existing assignment cursor, remainder, blocked state, and version are preserved. Migration 0029 is
unchanged; no new migration or remote operation is required.

## Local validation

```text
npx vitest run tests/integration/apple-orchard-production-binding.test.ts tests/integration/production-rate-d1-settlement.test.ts
npm run typecheck
npm run lint
git diff --check
```

In the managed environment, Vitest/Vite builds may be blocked by the known `spawn EPERM` esbuild startup
failure. The developer should verify the local flow by loading a farm with a READY Apple Orchard,
checking Warehouse Apples, hiding the page for at least 60 seconds, returning, and confirming the actual
Warehouse increase and then no duplicate increase on immediate reload.
