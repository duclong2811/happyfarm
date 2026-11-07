# V16.2.1 Warehouse full QA and edge-case audit

Date: 2026-10-04. Result: **V16_2_1_WAREHOUSE_FULL_QA_PASS**.

## Scope and evidence

Current HEAD: `e502bb4550fd1097fdc69dc1fa30d96c75b6b545`.
Audited the current mixed working tree, preserving historical Build Shop, free-land and V16.2 WIP.
No commit, push, deploy, remote database operation, or browser QA was performed.

Tests execute the real Worker handler, application services, D1 repositories and SQL migrations using
`NodeD1Database` (local in-memory SQLite, serial atomic batches). This proves deterministic application
interleavings and database rollback behavior, not remote Cloudflare latency or production load.

## Existing coverage and gaps

Existing V16.2 tests were reused:

- `tests/domain/warehouse.test.ts`: inclusive capacity arithmetic, invalid input and net deltas.
- `tests/integration/warehouse-migration.test.ts`: insert/update capacity guards, default capacity,
  legacy preservation/removal and capacity increases.
- `tests/integration/warehouse-behavior.test.ts`: full-warehouse upgrade, insufficient materials/gold,
  maximum tier, upgrade replay, same/different-request upgrade races, atomic purchase rollback.
- `tests/api/warehouse-capacity.test.ts`: full crop/tree refusal, purchase rollback, over-capacity sale,
  purchase race, scripted fishing refusal/retry/replay, mining refusal/retry.
- `tests/web/warehouse-ui.test.ts`: server-owned display/commands, localized errors, no warehouse poll.
- Existing fishing/mining/forestry loops and crop/tree/shop tests cover ownership, malformed requests,
  normal settlement, replay and competing settlements.

Missing coverage: exact 995/996 plus five boundaries, fixed 1000-capacity race totals and ledger effects,
complete rollback snapshots, full forestry retry, actual sales freeing storage, crop/tree/gather replay
after refusal, 1100 -> 1000 -> 900 selling, over-capacity planting and upgrades, and a competing grant
between the rolled-reward pre-check and transaction. The original fishing test only proved refusal
*before* drawing; it could not prove safety when storage filled *after* that read.

## Results

| Requested case | Result and evidence |
| --- | --- |
| Exact full | At 1000/1000 a positive purchase returns HTTP 409 `WAREHOUSE_FULL`; complete inventory, progression, wallet, ledger and receipt snapshots stay unchanged. |
| Near full | 995 + 5 succeeds at exactly 1000; 996 + 5 fails at 996, with no partial mutation. Successful purchase replay returns the same result and changes nothing. |
| Crop | Carrot +2 fits at 998, fails at 999/full. Failure preserves the crop, inventory and XP. Sell two units, retry the original request, receive exactly two carrots and four XP; replay changes nothing. |
| Production tree | Full refusal preserves the ripe apple tree's timestamp/version and inventory/XP. Sell three units, retry the original request, receive three apples and nine XP at 1000; replay preserves both account and tree state. |
| Fishing | Reuses the original scripted-RNG test: full pre-check consumes no roll. Added deterministic race fills the final slot during drawing: payout fails, ACTIVE action and chosen catfish roll survive; sell one, retry, receive catfish once. XP and inventory do not duplicate on replay. |
| Mining | Full refusal preserves the action and node, with no stone/XP/depletion. Sell two, retry original request, settle stone x2 once. Added post-pre-check race preserves both rolls; replay has no effects. |
| Forestry | Same full/refusal/sale/retry/replay and post-pre-check race assertions for wildwood CHOP. No lost wood or incorrect depletion. |
| Shop BUY | Exact/full/overflow tests compare full account/receipt snapshots. Rejected purchases do not debit gold or append successful ledger/receipt rows. |
| Shop SELL | Legacy 1100/1000 sells 100 to reach 1000, then sells another 100 to reach 900. Both succeed. |
| Concurrent grants | Two real Worker BUY commands each request +5 at 995/1000. Exactly one succeeds; the loser returns `WAREHOUSE_FULL`; final usage is 1000, seed delta is five, XP is unchanged, and exactly one purchase ledger and receipt exist. Wallet debit equals that one ledger delta. |
| Idempotency | Purchase response equality and account snapshots prove successful replay; crop/tree/fishing/gather retries pay once. Existing upgrade same/different-request concurrency tests remain green. |
| Legacy over-capacity | Read preserves all 1100 units; positive grant fails; selling works; planting consumes one seed at 1100 -> 1099 without touching wood; upgrade works. Nothing truncates/clamps excess inventory. |
| Upgrade while full | T0 at usage 1000 upgrades to T1/2500 for the unchanged 500 gold + 50 wood + 50 stone. Usage becomes 900 because the required materials are consumed; there is no other inventory loss. At legacy usage 1100 it becomes 1000. Subsequent grants work and upgrade replay charges nothing. |

“Existing 1000 inventory remains untouched” is interpreted as **no unintended loss**: literally retaining
all 1000 would waive the existing 100-unit material cost, contrary to the no-balance-change requirement.

## Bugs reproduced and fixed

1. **Rolled-reward race:** a successful pre-check did not reserve storage. A competing grant could fill
   the warehouse after drawing and before payout, causing rollback to discard the catch. Retrying
   consumed the next RNG value. The regression failed with zero catfish instead of one before the fix.
   Fishing now pins its roll on the action; gathering pins selection and quantity together. Conditional
   actor/version/status-scoped updates select one durable roll/pair under concurrency. Subsequent
   requests and fresh repository instances reuse it. Migration 0020 bounds the rolls and makes chosen
   values immutable. Inventory, XP, depletion, completion and success receipts retain their existing
   atomic payout transaction. No entropy is exposed through the API.
2. **Legacy domain mismatch:** `assertStorageDeltaFits(1000, 1100, [-50])` threw `WAREHOUSE_FULL` even
   though database guards allowed removal. Capacity rejection now applies only to positive net deltas;
   safe-integer and nonnegative-result checks remain. Zero/negative deltas above capacity are tested.

Both regressions were observed failing before their fixes and passing afterwards.

## Security and performance review

Applied `.agents/skills/security-review/SKILL.md`: identity remains the authenticated actor; commands
retain strict validation and authorization; new SQL binds action/actor/version and only initializes
ACTIVE actions. Foreign actors cannot pin another action's roll. Concurrent pinning returns a shared
winner; triggers prohibit changing pinned entropy. Settlement/replay protections and centralized
inventory/economy paths remain intact. No secrets, debug endpoint or production cheat were added.

Migration: new additive `0020_action_reward_rolls.sql`; no existing migration rewritten.
Contracts: no HTTP/WebSocket/DTO changes. Internal action repository ports add pinning methods.
Apply migration 0020 before running the updated Worker against an existing database; this audit did
not apply anything remotely. Existing actions migrate with nullable rolls and initialize on settlement.

Performance: no polling, per-frame/per-pointer storage query, animation loop, or world rebuild added.
Warehouse refresh remains in account load/mutation handling; upgrade redraws the warehouse strip.
Usage remains one player-scoped aggregate, not inventory-wide N+1 queries. Initial roll pinning adds
two indexed action reads and one conditional write; reuse adds one indexed read. These occur only
on settlement commands, with no timer or per-item loop.

No dev QA helper was added; deterministic automated fixtures suffice. Capacities 1000/2500/6000/15000,
upgrade costs, prices, yields, XP, drop tables, land behavior, and visuals were not changed by this task.

## Gates

- Focused warehouse/crop/tree/shop/fishing/mining/forestry/upgrade/concurrency run: 13 files, 131 tests
  passed before the final two pin-persistence tests; those two are included in the full run below.
- Final full suite: **153 files, 1493 tests passed**.
- Typecheck: passed.
- Lint: passed, zero warnings.
- Production Vite build: passed; reported dependency annotation and large-chunk warnings.
- Worker build: passed (`wrangler deploy --dry-run`); no deployment.
- Assets validation: all 27 generated models match specifications.
- `git diff --check`: passed (Git emitted line-ending notices only).

Sandbox execution initially refused esbuild process creation with `EPERM`; tests/build were rerun
through the approved escalated command path. The first full suite exposed two explicit migration-list
expectations; both were updated to include 0020, then the full suite passed.

## Files changed by this audit

- `packages/domain/src/warehouse.ts`
- `packages/application/src/ports.ts`
- `packages/application/src/fishing.ts`
- `packages/application/src/resources.ts`
- `packages/application/src/storage.ts`
- `workers/api/src/d1-repositories.ts`
- `database/migrations/0020_action_reward_rolls.sql` (new)
- `tests/domain/warehouse.test.ts`
- `tests/api/warehouse-capacity.test.ts` (extended existing untracked V16.2 file)
- `tests/api/fishing-loop.test.ts`
- `tests/api/mining-loop.test.ts`
- `tests/api/forestry-loop.test.ts`
- `tests/integration/farm-uniqueness-repair.test.ts`
- `docs/design/WAREHOUSE.md`
- `docs/CONTEXT_INDEX.md`
- `docs/qa/V16_2_1_WAREHOUSE_FULL_QA.md` (new)

Git status remains dirty with the user's historical WIP plus these audit changes. Nothing was staged,
committed, reset, restored, stashed, pushed or deployed. No blocking warehouse defect remains in the
tested paths; remote D1 execution and browser rendering were not exercised.

## Required yes/no answers

| Question | Answer |
| --- | --- |
| Can usage reach exactly capacity? | YES |
| Can usage exceed capacity through a positive grant? | NO |
| Does a failed crop harvest preserve the reward? | YES |
| Does a failed crop harvest grant XP? | NO |
| Can fishing reroll because Warehouse is full? | NO, after the fix |
| Can mining lose its reward because Warehouse is full? | NO |
| Can forestry duplicate reward after retry? | NO |
| Can Shop BUY charge Gold when Warehouse is full? | NO |
| Can Shop SELL work at 1000/1000? | YES |
| Can Shop SELL work while over capacity? | YES |
| Can two concurrent grants overflow Warehouse? | NO |
| Can old over-capacity inventory be deleted/truncated by Warehouse enforcement? | NO |
| Can Warehouse be upgraded while full? | YES, paying the existing material/gold cost |
| Was any game balance changed? | NO |
| Was Land Mode restored? | NO |
| Was any new polling introduced? | NO |
