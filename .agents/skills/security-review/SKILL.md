# Security Review Skill

Use for any change involving authentication, authorization, database access, persistent state, economy, inventory, multiplayer, admin, rewards, progression, trading, purchases, or external input.

## Checklist
1. Sensitive data: confirm secrets/tokens/credentials/private data are not committed, logged, returned, or bundled into frontend code.
2. Trust boundaries: identify all HTTP/WebSocket/query/browser/local-storage inputs; treat them as attacker-controlled.
3. Authentication: confirm actor identity comes from verified server context.
4. Authorization: confirm ownership/role/permission for every protected resource action, including cross-account tests.
5. Runtime validation: validate type, required fields, enum, IDs, lengths, ranges, quantities, coordinates, JSON size; reject NaN/Infinity/negative/extreme values where invalid.
6. Database access: parameterized queries, ownership filters, correct constraints, safe transaction boundaries, no accidental full-table writes, migration compatibility.
7. Race conditions: test concurrent harvest/sell/purchase/reward/craft/unlock/inventory/currency mutations.
8. Idempotency/replay: duplicate high-value requests must create one mutation.
9. Economy: server calculates value; ledger records reason/reference/request/before/delta/after.
10. Inventory: centralized service; no invented items/quantities; no underflow/duplication.
11. Multiplayer: authenticate socket/session, validate every message, check farm membership/permission, never rebroadcast unvalidated client state as truth.
12. Secrets: inspect diff for `.env`, token, secret, password, apiKey, authorization, privateKey.
13. Logging: no tokens/passwords/cookies/auth headers/private keys/sensitive data.
14. Errors: stable external codes, no stack/SQL leakage.
15. Tests: valid, invalid, unauthenticated, unauthorized, cross-player, malformed, negative/extreme quantity, duplicate, parallel request as applicable.
16. Final diff: remove debug code, unrelated refactors, disabled validation/tests, hardcoded credentials, duplicated business logic, frontend-authoritative logic, unsafe fallbacks.

## Required completion note
Report: boundaries checked, tests run, migration/contract changes, and known limitations. Do not claim absolute security.
