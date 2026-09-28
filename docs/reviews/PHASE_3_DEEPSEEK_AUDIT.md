# Phase 3 DeepSeek Audit (temporary, non-final)

Audit date: 2026-09-28
Auditor: DeepSeek execution agent (restricted auditor, not architecture owner)
Baseline commit: `a18708a64e97df3cbe240ec00d22fe7c7e84bb84` — `feat: add inventory and harvest settlement`

This artifact records a temporary audit performed because GPT-5.6 was unavailable.
It is review evidence, not a new source of architecture truth, and not approval.
Phase 3 remains uncommitted.

## Uncommitted Phase 3 scope (working tree)

Commits cannot prove authorship of individual hunks, so the sub-phase mapping below is
reconstructed from file purpose and content ("appears associated with").

| Sub-phase | Files (form) |
| --- | --- |
| 3A economy architecture | `packages/domain/src/{ids,errors,index,economy}.ts`, `packages/application/src/{ports,errors,index,economy}.ts`, `packages/contracts/src/index.ts`, `docs/decisions/0005-phase-3-economy-architecture.md`, `docs/DEEPSEEK_EXECUTION_PROTOCOL.md` |
| 3B currency/shop game-data | `packages/game-data/src/economy/index.ts`, `packages/game-data/src/shops/index.ts`, `packages/game-data/src/index.ts`, `tests/game-data/schema.test.ts` |
| 3C wallet + ledger | `database/migrations/0004_economy_and_shop.sql`, `packages/application/src/economy.ts`, `workers/api/src/d1-repositories.ts`, `tests/application/economy.test.ts`, `tests/integration/economy-infrastructure.test.ts`, `tests/integration/economy-migration.test.ts`, `tests/support/node-d1.ts`, `docs/DATA_MODEL.md` |
| 3D Buy/Sell settlement | `packages/application/src/shop.ts`, `packages/domain/src/inventory.ts`, `packages/application/src/inventory.ts`, `workers/api/src/{handler,index,runtime}.ts`, `packages/contracts/src/index.ts`, `tests/application/shop-settlement.test.ts`, `tests/application/inventory.test.ts`, `docs/protocols.md`, `docs/CONTEXT_INDEX.md` |
| 3E read-only Shop/Wallet API | `packages/application/src/ports.ts`, `packages/contracts/src/index.ts`, `workers/api/src/{runtime,d1-repositories,handler}.ts`, `tests/api/handler.test.ts`, `tests/contracts/validation.test.ts`, `tests/integration/economy-infrastructure.test.ts`, `docs/protocols.md` |
| Unknown / suspicious | none identified |

## Phase 3E verification: OBSOLETE HISTORICAL RECORD

> This section recorded the Phase 3F state before Phase 3E existed. It is kept only for
> traceability. **The Phase 3E completion section further below supersedes it.**

Phase 3E was expected to add `GET /shop` and `GET /wallet`. The working tree contains
neither endpoint, no read DTOs, and no 3E tests:

- `workers/api/src/handler.ts` routes: `/health`, `POST /farms`, `GET /inventory`,
  `POST /shop/buy`, `POST /shop/sell`, farm/crop routes. No `GET /shop`, no `GET /wallet`.
- `packages/contracts/src/index.ts` has `BuyItem`/`SellItem` command + result schemas only.
  No `ShopDTO` / `ShopEntryDTO` / `WalletDTO`.
- No `tests/api` or `tests/contracts` coverage for those endpoints.

Consequence: **no `PHASE_3E_SCOPE_VIOLATION`** — 3E modified nothing, so it could not have
violated the frozen-file list. The gap is missing implementation, not a scope breach.

Reason the prior 3E attempt stopped (recorded for traceability): the two read endpoints cannot
be built through existing ports, because
`ShopEntryRepository` exposes only `findById` (no catalog enumeration) and
`WalletRepository` exposes only `find(playerId, currencyId)` with no
`CurrencyDefinitionRepository` enumeration. Adding those reads requires
`packages/application/src/ports.ts` and `workers/api/src/d1-repositories.ts`, both outside
3E's allowed/forbidden scope.

## Phase 3E completion (added by Phase 3F-R, supersedes the obsolete record above)

The architecture owner explicitly authorized the minimum read extensions, Phase 3E was completed,
and Phase 3F-R re-audited it. The earlier claim that Phase 3E is missing no longer applies.

- Port extensions (application-owned, read-only):
  `ShopEntryRepository.list(): readonly ShopEntry[]` and
  `WalletRepository.listByPlayer(playerId): Promise<readonly Wallet[]>` in
  `packages/application/src/ports.ts`. No generic query surface, no list-all-wallets, no
  arbitrary-player lookup, no `CurrencyDefinitionRepository.list()`, no worker-owned interface.
- Shop adapter: `GameDataShopEntries.list()` projects the authoritative game-data `shopRegistry`
  through the same `toShopEntry` mapper used by `findById`, so both paths project identically. No
  second catalog, no prices copied into worker code, no D1 shop persistence. Registry order is
  deterministic and the API tests depend on it.
- Wallet adapter: `D1WalletRepository.listByPlayer` runs a fully parameterized
  `SELECT ... FROM wallets WHERE player_id = ? ORDER BY currency_id` and reuses the shared
  `mapWallet` mapping. Read-only, no list-all path, no HTTP-controlled player selector.
- `GET /shop` is authenticated (`/health` remains the only public route), read-only, uses the
  existing success envelope, and returns presentation-safe
  `{ shopEntryId, itemDefinitionId, currencyId, buyPrice, sellPrice, maxQuantityPerRequest }`
  from authoritative game-data. Displayed prices never become mutation input: Buy/Sell still
  resolve entry, item, currency, unit price, and total server-side, and injected price fields are
  rejected with `INVALID_INPUT`.
- `GET /wallet` is authenticated and scoped to the trusted `actor.playerId`. `playerId`, `userId`,
  `walletOwner`, and `x-player-id` cannot select another player's wallet. A player with no
  persisted wallet receives `{ ok: true, data: { wallets: [] } }`.
- Read-only proof: both GET routes are asserted side-effect free. Wallet, inventory, ledger, and
  idempotency row counts are compared before/after, and the wallet-less case leaves D1 untouched.
  Phase 3C lazy wallet creation remains mutation-only.
- Contracts: `ShopEntryDTOSchema`, `GetShopResponseSchema`, `WalletDTOSchema`, and
  `GetWalletResponseSchema` are strict and expose no raw persistence fields, registry internals,
  functions, or hidden server metadata.
- Tests added by 3E (6): shop catalog auth/content/key-set/no-side-effects; wallet actor scoping
  with query and header injection attempts; wallet-less empty list with no-write proof; wallet
  balances after shop browse plus Buy and Sell; contract DTO strictness; D1 `listByPlayer`
  ordering, isolation, and read-only proof.
- Final suite after 3E and 3F-R: **142 tests / 19 files passing** (was 136 / 19 after Phase 3F).
- No new migration was required for either GET endpoint; migrations `0001`-`0004` are unchanged by
  Phase 3E and Phase 3F-R.
- Remaining deferred GPT-5.6 review items are unchanged: true parallel workerd concurrency
  behavior, idempotent replay returning the original stored `newBalance`, the
  `PRAGMA foreign_keys` observation, and the Windows workerd local-runtime limitation.

### Phase 3F-R commands

| Command | Result |
| --- | --- |
| `git status`, `git diff --stat`, `git diff --check` | clean; `--check` exit 0 |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS (`--max-warnings=0`) |
| `npx.cmd vitest run` | PASS - 19 files, 142 tests |
| `npm.cmd run build` | PASS - web build + `wrangler deploy --dry-run` |
| `npm.cmd run check` | PASS (typecheck + lint + test + build) |

No native local D1 run was attempted in Phase 3F-R; the previously recorded Windows workerd
limitation stands unchanged.

## Commands run

| Command | Result |
| --- | --- |
| `git status`, `git diff --stat`, `git diff --check` | clean; `--check` exit 0, no whitespace errors |
| `npx.cmd vitest run` | PASS — 19 files, 136 tests (128 before this audit's 8 new tests) |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS (`--max-warnings=0`) |
| `npm.cmd run build` | PASS — web production build + `wrangler deploy --dry-run` |
| `npm.cmd run check` | PASS (typecheck + lint + test + build) |
| `npm.cmd run db:migrate:local` | FAIL — native workerd crash, see environment limitation |

Escalation: all Node/esbuild/wrangler commands required running outside the sandbox
(`spawn EPERM` inside the sandbox). Reported as required.

## Confirmed invariants

- Shop price / item / currency / eligibility: game-data `shopRegistry` only.
- Currency metadata: game-data `currencyRegistry` only; D1 stores no currency definitions.
- Wallet balance: `wallets` table, mutated only by the `economy_ledger` trigger pair via
  `EconomyService` + `EconomySettlementRepository` / `EconomyMutationRepository`.
- Economy history: append-only `economy_ledger` with `balance_after = balance_before + delta`,
  guarded wallet version, update/delete triggers.
- Inventory quantity: `inventory_items`, mutated only through `InventoryService` prepared
  mutations inside the settlement batch.
- Idempotency identity: `(actor, operation, requestId)` with payload fingerprint;
  operations in use are `PLANT_CROP`, `HARVEST_CROP`, `BUY_ITEM`, `SELL_ITEM`.
- Actor identity: trusted server `ActorContext`; no client-supplied player/wallet owner, no
  debug identity header, production authenticator is fail-closed (`UnconfiguredAuthenticator`).
- Buy/Sell accept only `requestId`, `shopEntryId`, `quantity`; strict schemas reject
  `price`, `unitPrice`, `total`, `currencyId`, `currencyDelta`, `reward`, `balance`, `playerId`.
- No generic mutation surface: `/wallet*`, `/inventory/*`, `/ledger*` are all 404.

## Bugs found

1. **Incorrect local error mapping (confirmed, client-visible).** `ApplicationError("INVALID_QUANTITY")`
   is thrown by `packages/application/src/shop.ts` when a quantity exceeds the shop entry's
   `maxQuantityPerRequest`, but `errorStatus` in `workers/api/src/handler.ts` had no case for it.
   A client request (`POST /shop/buy` quantity 1001 on a 1000-bound entry, still within the
   contract-wide 1,000,000 cap) returned **HTTP 500** with code `INVALID_QUANTITY`.
   Reproduction: `tests/api/handler.test.ts` → "treats a per-entry quantity bound violation as a
   client error, not an internal error" (failed 500 vs 400 before the fix).

## Bugs fixed locally

Only the confirmed defect above, which is a local error-mapping fix inside approved architecture:

- `workers/api/src/handler.ts`: added `case "INVALID_QUANTITY":` to the 400 group (one line).

No other production behavior was changed. Error-code coverage was re-checked against every
`ApplicationError` code thrown by `packages/application`: all reachable codes now map explicitly.
`CROP_NOT_READY` and `INTERNAL_ERROR` remain unmapped by design (first is unreachable; second is
the default 500).

## Tests added by this audit (8)

- `tests/api/handler.test.ts`: per-entry quantity bound → 400 `INVALID_QUANTITY` with no
  mutation; cross-player wallet/inventory/stored-result isolation over HTTP; request ID
  isolation between `PLANT_CROP` and `BUY_ITEM`; no generic wallet/inventory/ledger mutation
  surface plus method misuse on `/shop/buy`.
- `tests/application/shop-settlement.test.ts`: replay-during-concurrent-write preserves the
  original result without overwriting the newer balance; cross-actor wallet/inventory/replay
  isolation.
- `tests/integration/economy-migration.test.ts`: ledger row claiming a stale wallet version is
  rejected and leaves the wallet untouched; stable ledger reason/reference/request-ID/delta
  constraints.

## Architecture-sensitive findings NOT fixed (deferred to GPT-5.6)

1. ~~Phase 3E read endpoints are missing~~ **RESOLVED in Phase 3E / verified by Phase 3F-R.**
   The authorized read surfaces now exist (`ShopEntryRepository.list`,
   `WalletRepository.listByPlayer`, D1 wallet read query), and the open policy questions were
   frozen and implemented: `GET /shop` is authenticated, and a player with no persisted wallet
   receives `{ wallets: [] }` without any write. Retained here only as history.
2. **Concurrency evidence strength.** `NodeD1Database.batch` serializes batches through an
   internal promise tail, so `Promise.all` "concurrency" tests in this repo are effectively
   sequential. Real protection is the `BEGIN IMMEDIATE` batch plus the
   `economy_ledger_validate_wallet` trigger and guarded final idempotency statement; the new
   migration test exercises the guard directly. True parallel workerd execution is unverified
   (see environment limitation).
3. **Replay returns the stored original `newBalance`**, not the latest balance. This matches the
   frozen Phase 3D semantics/tests; flagged only so the owner confirms it is intended.
4. **Migration `PRAGMA foreign_keys = ON;`** is a no-op inside D1/Wrangler's transactional
   migration apply. Harmless (D1 enforces FKs), not changed, and no undocumented schema change
   is required by Phase 3.

## Known environment limitation

- **Native local D1 NOT VERIFIED.** `npm run db:migrate:local` (workerd) aborts on this Windows
  host: `Received structured exception #0xc0000005: access violation` / `thread 'main' has
  overflowed its stack`. The known workerd Windows crash persists. Deterministic
  `node:sqlite` migration tests and the `wrangler deploy --dry-run` build remain valid evidence
  but are **not** equivalent to native workerd execution.

## Files GPT-5.6 should review

- `workers/api/src/handler.ts` (this audit's one-line error-mapping change + route table).
- `workers/api/src/d1-repositories.ts` (`D1EconomySettlementRepository.settleShopAtomically`,
  `D1WalletRepository`, `D1EconomyMutationRepository`, `D1EconomyLedgerRepository`).
- `packages/application/src/shop.ts`, `packages/application/src/economy.ts`,
  `packages/application/src/inventory.ts`, `packages/application/src/ports.ts`.
- `packages/domain/src/economy.ts`, `packages/domain/src/inventory.ts`.
- `database/migrations/0004_economy_and_shop.sql` (triggers, checks, indexes, FKs).
- `tests/application/shop-settlement.test.ts`, `tests/api/handler.test.ts`,
  `tests/integration/economy-*.test.ts`, `tests/support/node-d1.ts` (harness serialization).
- Phase 3E read-API delta: `packages/application/src/ports.ts`,
  `workers/api/src/runtime.ts`, `workers/api/src/d1-repositories.ts`,
  `workers/api/src/handler.ts`, `packages/contracts/src/index.ts`, and the 3E tests.

## Commit status

NOT COMMITTED — awaiting GPT-5.6 independent re-audit.
