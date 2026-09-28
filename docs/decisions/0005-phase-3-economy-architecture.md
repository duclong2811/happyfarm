# ADR 0005: Phase 3 economy architecture lock

Status: Accepted

## Definitions and authority
- Currency and shop definitions are validated static game data. `currency_gold` has a documented maximum wallet balance of `Number.MAX_SAFE_INTEGER`.
- All monetary values, unit prices, quantities, deltas, and balances use safe integer arithmetic. Floating-point prices and fractional quantities are invalid.
- Buy/sell clients send only `requestId`, `shopEntryId`, and `quantity`. The server resolves the shop entry and authoritative unit price; clients never submit price, currency, balance, reward, or player identity.
- Economy code depends on generic item/inventory identifiers and mutations. It must not import crop, farm, or other farming internals.

## Mutation boundary
- `EconomyService` is the only application boundary that prepares a currency mutation. It validates actor ownership, non-zero safe-integer deltas, non-negative results, the wallet maximum, and before/after balances.
- `InventoryService` remains the only boundary that prepares inventory additions and removals. Buy/sell use those prepared mutations rather than issuing direct quantity updates.
- Wallet and ledger repositories expose reads. Implementations must not add independent public wallet-update or ledger-append methods.
- Phase 3C adds one internal `EconomyMutationRepository.applyAtomically` write boundary for wallet-only mutations. It is not an HTTP API and cannot update a wallet without its ledger row. Phase 3D shop settlement will compose this invariant with inventory and idempotency rather than bypass it.
- `EconomySettlementRepository.settleShopAtomically` is the only future write port. One transaction must apply the wallet mutation, append its ledger entry, apply the prepared inventory mutation, and finalize generic idempotency. Partial commits are forbidden.

## Wallet and ledger
- A wallet is unique by player and currency and can never be negative or exceed `9,007,199,254,740,991`.
- Every wallet mutation produces one immutable ledger entry containing transaction ID, player, currency, delta, reason, shop reference, request ID, before/after balances, expected wallet version, and timestamp.
- Normal gameplay never updates or deletes ledger history. Corrections use new compensating entries.
- Optimistic version/guard checks and database constraints remain required even if higher-level command ordering exists.

## Idempotency and concurrency
- Buy and sell use the existing generic `(actor, operation, requestId)` idempotency identity and a payload fingerprint covering the shop entry and quantity.
- Same identity with another payload returns `IDEMPOTENCY_CONFLICT`; successful replay returns the stored result without repeating wallet, inventory, or ledger effects.
- The database implementation must protect concurrent spending, concurrent credits near the maximum, and duplicate settlement. These mechanics are deferred to the Phase 3 persistence implementation.

## Phase 3A boundary
This ADR freezes types, ports, game-data schemas, command contracts, errors, and pure validation only. It intentionally introduces no wallet migration, D1 adapter, buy/sell use case, API route, or real mutation.

## Phase 3C persistence decision
- Wallets are lazily created with balance zero and version 1 inside the same batch as the first mutation. `INSERT OR IGNORE` plus the composite primary key makes concurrent first use race-safe.
- Inserting a ledger row is the mutation command. A database trigger verifies the player/currency balance and expected version, then updates the wallet in the same SQLite statement. A stale writer aborts instead of overwriting another result.
- `EconomyService` reloads and revalidates bounded stale-version conflicts. This preserves all concurrent credits and converts a competing debit into `INSUFFICIENT_FUNDS` once another debit wins.
- Currency IDs are parsed and resolved through the authoritative game-data registry before persistence. D1 intentionally has no fake currency-definition foreign key.
- Any statement or batch-finalization failure rolls back lazy creation, wallet changes, and ledger insertion together.

## Phase 3D shop settlement decision
- `BuyItem` and `SellItem` accept only authenticated intent (`requestId`, `shopEntryId`, `quantity`). Shop and currency registries determine eligibility, item, currency, unit price, and safe-integer total.
- Both use `EconomyService` and `InventoryService` to prepare authoritative mutations. `EconomySettlementRepository.settleShopAtomically` applies wallet, immutable ledger, inventory, and generic idempotency state in one batch.
- The final idempotency statement verifies the exact post-settlement wallet and inventory quantities and versions. A stale or guarded no-op aborts the transaction; the use case reloads state and either retries or returns a stable limit/insufficiency error.
- Replay identity is `(actor, operation, requestId)`, with a payload fingerprint covering shop entry and quantity. Buy and sell operations are isolated, mismatched payloads conflict, and successful replay does not change versions or append another ledger row.
- Any failure at wallet preparation, ledger/wallet mutation, inventory mutation, or idempotency finalization rolls the entire batch back.
