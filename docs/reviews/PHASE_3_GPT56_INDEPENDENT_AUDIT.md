# Phase 3 / 3.5A / 3.5B independent audit (GPT-5.6)

Audit date: 2026-09-28
Auditor: independent review model (GPT-5.6), separate from the implementation agent
Baseline: uncommitted working tree on `a18708a` (`feat: add inventory and harvest settlement`)
Scope: Phase 3 (economy), Phase 3.5A (dev authentication bridge), Phase 3.5B (starter land, Node
dev host, development UI)
Method: unified-diff review with file-level context. No live `workerd` runtime and no real D1
database were available to the auditor.

This is the independent audit that Phase 3 was waiting for. It is review evidence, not a new
source of architecture truth. `PHASE_3_DEEPSEEK_AUDIT.md` in this directory is the author's own
self-audit and was explicitly not treated as evidence by this auditor.

## Verdict

**PASS WITH FIXES** — no P0 and no P1 findings.

The auditor judged the economy ledger design, server authority, idempotent stored replay,
ownership scoping, arithmetic checks, lazy-wallet race handling, and production dev-auth isolation
sound on the strength of the code plus documented D1 guarantees, and made no absolute security
claim.

## Findings as received (4 files, 3 findings)

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P2 | The Vite `/api` proxy buffered request bodies with no limit, so a large or indefinitely streamed upload could exhaust the development server before the Worker's 16 KiB check ever ran. | Fixed |
| 2 | P2 | The local migration runner executed a migration's SQL and recorded it as two autocommit operations, so a mid-migration failure could leave schema applied but untracked and strand the local database. | Fixed |
| 3 | P3 | A malformed percent-encoded path segment (`GET /farms/%/tiles`) threw `URIError` out of `decodeURIComponent`, which the outer catch reported as `INTERNAL_ERROR` (500) instead of `INVALID_INPUT`. | Fixed |

Remediation is recorded in "Remediation" below; each fix carries a regression test.

## Mandatory questions, as answered by the auditor

**Q1 — does idempotent replay return the original stored `newBalance`?** Yes, for both `BUY` and
`SELL`. The result including `newBalance` is serialized into `responseJson` before settlement
(`packages/application/src/shop.ts:110`) and replay parses and returns that stored JSON
(`packages/application/src/shop.ts:191`). It neither reloads the wallet nor recomputes a balance.
Distinct `(actor, operation, requestId)` identities prevent cross-operation collisions, and the
fingerprint includes the shop entry and quantity (`packages/application/src/shop.ts:92`).

**Q2 — does production D1 enforce foreign keys?** Yes. Cloudflare documents that D1 enforces
foreign keys by default, equivalently to SQLite with `PRAGMA foreign_keys = ON`, for both queries
and migrations, so the migration's pragma is redundant protection rather than the mechanism
production depends on. The wallet/ledger checks, balance equation, bounds, guarded version trigger,
wallet-update trigger, and ledger immutability triggers would still hold if it were disabled; what
would be lost is referential integrity (silent dangling references, unenforced
`ON DELETE/UPDATE RESTRICT`).

**Q3 — are the ledger triggers safe under real concurrency?** The design prevents double-spend and
lost credits under documented D1 semantics: `batch()` is a transaction whose statements execute
sequentially and whose entire sequence rolls back on failure; `economy_ledger_validate_wallet`
verifies balance and version immediately before insertion; the `AFTER INSERT` trigger updates the
same wallet in the same statement; a competing stale mutation cannot insert its ledger row; and a
retried credit reloads and adds rather than overwrites. Actual parallel `workerd` execution remains
unverified in this environment. Two acknowledged softer points: the 16-attempt retry loop
conflates wallet conflicts with guarded inventory/idempotency no-ops as `ECONOMY_CONFLICT` and can
add load under contention, and real D1 error-string compatibility with the substring
classification in `workers/api/src/d1-repositories.ts:571` was not verified.

**Q4 — is the `node:sqlite` D1 adapter faithful?** Faithful for the repository semantics currently
used, with test-evidence limitations. `BEGIN IMMEDIATE` plus serialized batches is stronger local
serialization than separate callers would observe against real D1, but the relevant batch
guarantees (ordered statements, atomic commit, complete rollback) match documented D1 behavior.
`first()`, `all()`, and `run()` can throw before returning a promise, and no repository caller
depends on obtaining a promise first, since they are invoked inside async methods. The local
"concurrency" tests are not evidence of real parallel D1 scheduling because `batchTail` deliberately
serializes them.

**Q5 — can the dev host reach production?** No production path found. Production Wrangler config
names `workers/api/src/index.ts`, which wires `UnconfiguredAuthenticator`, ignores all
`DEV_AUTH_*` variables, and imports no development modules; `workers/api/dev/` is referenced only
by the Vite configuration, whose import is type-only or loaded through `ssrLoadModule()` inside a
plugin marked `apply: "serve"`; the browser source does not import the host or Worker
implementation. Bundle-content confirmation was unavailable because a production dry run could not
be generated in the auditor's environment.

**Q6 — is the token comparison timing-safe and powerless in production?** It avoids
content-dependent early exit after hashing but is not literally constant-time for arbitrary input
length: both values are SHA-256 hashed into equal-length digests and every digest byte is folded
(`workers/api/src/dev-auth.ts:103`), so no prefix-match signal remains, but hashing work still
depends on the original string lengths, so coarse inference about the configured token length is
conceivable. Production authority is zero: `UnconfiguredAuthenticator` always returns `null`
(`workers/api/src/runtime.ts:143`), the production `Env` and entrypoint never read `DEV_AUTH_*`,
and `/__dev/bootstrap` is absent.

## What the auditor could not verify

- Native Vitest could not start (`spawn EPERM` on esbuild), so `vite build`, the production Worker
  dry run, and the development Worker dry run did not run either. TypeScript, ESLint, and
  `git diff --check` did pass.
- No real D1 database or working `workerd` runtime was available, so actual parallel request
  behavior, D1 trigger execution, error message text, and final production bundle contents were
  not observed.
- The reported 176-test custom harness was regarded as weaker evidence than it appears, because
  the Node adapter serializes batches; adapter-fidelity and Vite-middleware tests cannot prove
  `workerd`/Vite behavior. The middleware suite also lacked an oversized streaming-body case.
- No committed secret was found; `.dev.vars` remains ignored with only the placeholder example
  present.

## Minimum conditions the auditor set before committing

1. Bound request-body buffering in the Vite `/api` middleware and test an oversized streamed
   request. **Done.**
2. Make each local migration and its tracking insert atomic, with rollback failure tests. **Done.**
3. Preferably map malformed percent-encoded route segments to `INVALID_INPUT`. **Done.**
4. Run native Vitest and both dry-run builds on a machine that permits esbuild/`workerd` child
   processes. **Outstanding — not possible on this host.**
5. Run at least one real D1/`workerd` contention test covering parallel first-wallet sales,
   overspending, concurrent credits, duplicate request IDs, and the exact D1 errors used for retry
   classification. **Outstanding — not possible on this host.**

## Remediation (implementation agent, this working tree)

Findings 1-3 are fixed. Details, including the regression tests, are in the commit that follows
this audit; the flow is:

- `apps/web/vite.config.ts`: `MAX_FORWARDED_BODY_BYTES` (16 KiB) enforced from the declared
  `content-length` before any byte is read, and again while streaming; an oversized body is
  abandoned and the request torn down after the rejection is flushed, answering `INVALID_INPUT`.
  Covered by three cases in `tests/integration/dev-api-middleware.test.ts`.
- `workers/api/dev/migrations.ts` + `workers/api/dev/api-host.ts`: foreign keys are enabled before
  the runner starts, and each migration body plus its tracking row commit in one
  `BEGIN IMMEDIATE` / `COMMIT` transaction with rollback on failure. Covered by
  `tests/integration/dev-host.test.ts`.
- `workers/api/src/handler.ts`: `decodePathSegment` converts a `URIError` into `INVALID_INPUT` for
  every dynamic path segment. Covered by `tests/api/handler.test.ts`.

Conditions 4 and 5 remain open and are the reason this audit is "PASS WITH FIXES" rather than an
unqualified pass. They are environment limitations of this host, not known defects.

### What native Vitest then found

The first native `npm run test` run on a host that permits child processes reported 1 failed file /
6 failed tests / 181 passed. Every failure was a 30 s timeout in
`tests/integration/dev-api-middleware.test.ts`, and the cause was in the **test double**, not in the
production middleware:

- `FakeRequest` emitted its body on a fixed `setImmediate` regardless of whether anything was
  reading it. A real `IncomingMessage` is a stream that stays paused until a `data` listener
  exists, so the socket buffers the body and no byte can be lost; the fake had no such buffer.
- The middleware only attaches its listeners after `await loadHost()`, which on a cold (uncached)
  host load takes real time. The fake had already emitted by then, so the body was dropped,
  `readRequestBody` never settled, and `response.finished` never resolved.
- The custom harness hid this because its host load resolves in microtasks, so listeners were
  attached before the `setImmediate` fired. This is exactly the "harness is weaker evidence than it
  looks" risk the auditor recorded.

Measured with a stand-in host whose load is delayed (cold call first, warm call second):

| Host load delay | Cold request, before fix | Cold request, after fix |
| --- | --- | --- |
| 50 ms | hung (still pending at 20 s) | 364 ms |
| 2000 ms | hung | 2321 ms |

Fix: `FakeRequest` now schedules delivery only once a `data` listener is attached, so the test no
longer depends on how long the host takes to load. No production code changed for this. Re-run
`npm run test` to confirm the six timeouts are gone.

### Follow-up: the refusal could still be truncated

Re-checking the oversized-body path after the fixes above found one more defect in the same
handler. The rejection was written and `request.destroy()` was called straight afterwards, but
`respond()` does not wait for the response to be flushed, and closing a socket that still holds
unread inbound bytes resets the connection, so the client could observe a transport error instead
of `INVALID_INPUT`. The middleware now registers a flush wait *before* writing the refusal and tears
the request down only once that wait resolves, and the refusal envelope carries a `requestId` like
every other API failure. The middleware test's response double models `finish`/`close` plus the
`writableFinished`/`destroyed` flags, so the ordering is exercised rather than assumed.

Verification available on this host: `tsc --noEmit`, `eslint --max-warnings=0`, and the
type-stripping test harness (24 files, 181 tests, all passing) are green. Native `npm run check`
and both dry-run builds still need a host that can spawn the esbuild helper.