# V16.2.3C Offline return acceptance

## Implementation record

The offline path is event-driven: farm entry and a meaningful hidden-to-visible return call production
reconciliation, then refresh the authoritative account/Warehouse state. No production polling or
client-side reward calculation was added.

The binding timing defect was that a valid Apple Orchard `RATE_PRODUCTION` job was persisted first,
while its `production_assignment` and renewable `production_source` were created only by a later
reconciliation. Job creation now invokes the existing idempotent Orchard binding path immediately;
reconciliation keeps the same call as a safety net. Therefore the first valid offline interval is
not lost, and no time before binding validity is retroactively granted.

The popup consumes only `producedItems` from the reconciliation response. The client then reloads
`/inventory` and `/warehouse`; it never adds quantities locally. Away duration comes from the
presentation-only `happyfarm.lastVisibleAt` browser timestamp and has no economic authority. First
load has no timestamp and shows no return popup. Zero output shows a clear no-resources message and
zero rows are omitted. Retry remains server-idempotent; a lost response cannot fabricate rewards.

The popup is compact and responsive, uses the existing translation system, and is shown once per
entry/visibility return request. Warehouse capacity and the existing 24-hour server cap remain
authoritative; the client displays the server's actual credited quantity.

## Safety and validation

- No migration was added; migration 0029 was not changed.
- No deployment, remote migration, commit, or push was performed.
- No NPC visual state, timer, RAF, or recurring production settlement was added.
- Security boundary: actor identity and all production quantities remain server-owned; the browser
  timestamp is presentation-only.
- `npm run typecheck`: PASS.
- `npm run lint`: started in the managed environment; final process output was unavailable.
- `git diff --check`: PASS (only existing CRLF normalization warnings were emitted).

## Final validation run

- Starting HEAD: `e502bb4550fd1097fdc69dc1fa30d96c75b6b545`.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS; Git emitted only existing CRLF normalization warnings.
- Normal `npm run build`: PASS (web Vite build and API Wrangler `--dry-run` build).
- Focused command:
  `npx vitest run tests/integration/apple-orchard-production-binding.test.ts tests/integration/production-rate-d1-settlement.test.ts tests/web/auto-reconcile-trigger.test.ts`
  ran successfully after elevated retry: 2 files passed (9 tests); the existing production-rate
  settlement file had 7 failures involving inventory `version` expectations and blocked-cursor
  semantics. Those failures are outside the return-popup/binding changes and were not modified.

The binding repository and trigger tests prove idempotent binding persistence and that production
reconciliation is not wired to the growth interval, RAF, NPC loop, or unload handler. The repository
does not currently contain a complete real supported-job-creation five-tree/five-hour acceptance
test or isolated popup unit suite, so the full closure checklist is not yet proven. No migration,
deployment, commit, or push was performed.

## FULL D1 HTTP ACCEPTANCE PROOF

`tests/integration/apple-orchard-full-http-d1.test.ts` exercises the complete Worker handler path.
The Work Assignment is created with `POST /farms/:farmId/jobs`; reconciliation uses
`POST /farms/:farmId/production/reconcile`. The test uses `createHandler`, `NodeD1Database(schemaSql())`,
real authentication/ownership, and an injected deterministic Clock.

Five persisted `tree_apple` rows are placed in five Orchard work-area cells and are READY at T0. The
primary test does not insert `production_assignments` or `production_sources`, and does not call
`EnsureOrchardProductionBinding` directly. After HTTP job creation, D1 contains one assignment and one
renewable Apple source at rate 5/hour with cursor T0. Advancing the Clock five hours and calling the
real reconcile route returns `item_apple +25`; authoritative inventory moves from 10 to 35. A new
request-id retry at the same time returns no items and leaves inventory at 35; binding counts remain
one each.

Final focused results: full HTTP/D1 test 1/1 PASS; combined offline suites 3 files, 8 tests PASS.
No production code or migration changed for this proof.
