# V16.2.2D2.3 — B3.1 Auto emergency supply funding

Date: 2026-10-05. Result: **B3_1_EMERGENCY_SUPPLY_FUNDING_COMPLETE**.

## Product semantics

Auto may buy the seed an assignment needs. When the player's Gold cannot pay for the whole
capacity-driven batch, Auto may sell **only** from a whitelist the player wrote, in the order they
wrote it, and only as much as the shortfall needs. It is funding, not Auto Sell: nothing is liquidated
because storage is full, prices never speculate, and an unselected item is never touched.

```text
need supply -> gold covers the batch            -> PURCHASE_INPUT (B1, unchanged)
need supply -> gold short, funding OFF/empty    -> B1: buy what the purse affords, else WAITING_FOR_FUNDS
need supply -> gold short, whitelist covers it  -> FUND_AND_PURCHASE_INPUT (sale + purchase, one batch)
need supply -> gold short, whitelist short      -> WAITING_FOR_FUNDS, zero sale, zero purchase
```

## Policy schema (migration `0028_auto_funding.sql`, additive, local only)

```text
actor_jobs.auto_funding_enabled  INTEGER NOT NULL DEFAULT 0   -- every existing assignment stays OFF
auto_funding_items(job_id, item_definition_id, priority 1..8, created_at, updated_at)
  PRIMARY KEY (job_id, item_definition_id); UNIQUE (job_id, priority)
  FOREIGN KEY (job_id) REFERENCES actor_jobs(id) ON DELETE CASCADE
```

`MAX_AUTO_FUNDING_ITEMS = 8` (domain). Priority is the list order; the policy is
assignment-scoped, server-side, and never stored in the browser.

## Sell whitelist authority

Every candidate's price comes from the authoritative shop catalogue's `sellPrice`; an item this
deployment does not buy is dropped rather than priced by guesswork. Seeds are not offered (they carry
`buyPrice`, not `sellPrice`), which is the catalogue's own statement that they are not sellable.

## Minimum-sale algorithm (`packages/domain/src/funding.ts`)

```text
shortfall = max(0, batchQuantity * buyPrice - gold)
for each selected item by priority:
  needed = ceil(remainingShortfall / sellPrice)
  quantity = min(available, needed)
  remainingShortfall -= quantity * sellPrice
if remainingShortfall > 0 -> null (sell nothing at all)
```

Integer prices may overshoot by less than one unit's worth of Gold; that is accepted, and the whole
stack is never sold.

## Atomic settlement

`FundAndPurchaseSupply` (application) re-reads the catalogue prices, the Warehouse rows, the wallet and
the cargo container, recomputes the plan, and hands one transaction to
`D1AutoFundingSettlementService`:

```text
prepareAutoFundingPurchase         prepareAutoFundingGuardAndAdvance
  per sale: inventory decrement      actor_auto_state version + simulation_at
            SHOP_SELL ledger row     AUTO_FUND_AND_PURCHASE_INPUT receipt whose CASE observes:
  SHOP_BUY ledger row                  auto post-state, container marker, wallet post-state,
  cargo marker + grant                 the buy ledger row, every sale ledger row,
                                       every sold stack's after-quantity, and the cargo grant
= one db.batch()
```

Any failure leaves the receipt NULL and rolls the entire liquidation back - the player can never lose
a selected resource without receiving the supply it paid for.

## Ledger behaviour

Each sale writes its own `SHOP_SELL` row (reference: the shop entry), and the purchase writes the
`SHOP_BUY` row; the wallet moves through the ledger's own triggers, so gold is never created or
destroyed off the books. The proof asserts both rows exist, the wallet delta equals
`proceeds - cost`, and the sold stack decreased by exactly the sold quantity.

## Semantic identity, replay, concurrency

The transition id is the existing server-derived `autoTransitionId(actor, assignment, kind, eventTime)`;
the HTTP request id is only a transport detail. The receipt is keyed by that id, and every statement is
scoped to the transition's own marker or to the state its predecessor wrote, so a replay, a retry with
a new HTTP id, or two tabs racing the same transition can only ever apply once.

## Blocked behaviour

Whitelist insufficient, funding off, or empty: **zero** sale, **zero** purchase, Warehouse/wallet/
cargo untouched, and the timeline is not consumed. B1's partial-affordability purchase is preserved:
when the purse buys *some* of the batch and funding cannot cover the rest, the actor still buys what it
can afford rather than waiting.

## Offline compatibility

The action runs through the same `AdvanceAuto` step the B3 reconciler drives, so a returning player's
absence can discover the shortage, fund it and buy the seed with no separate offline implementation.
Proven by `runs through offline reconciliation, the same executor the online loop uses`.

## UI (small functional slice)

Beneath the existing "Buy missing supplies" checkbox, each assignment card renders an **Emergency
funding** block (`fundingBlock` in `apps/web/src/main.ts`):

* a checkbox that enables the policy for that assignment;
* one sentence stating the rule ("Only the resources you select may be sold automatically, and only
  when Gold is not enough to buy work supplies. The first one is sold first.");
* the selected resources in priority order, each with a checkbox and **up/down** controls (44 px
  targets), then every other sellable resource with an unchecked box;
* the list is built from the authoritative shop catalogue (`sellPrice !== null`, `SEED` excluded), so
  the client never invents a sellable item; names go through the existing item display pipeline.

Every control posts the whole policy (both flags + the ordered list) and reloads the panel, so what
the player sees is what the server stored - it survives a reload because it is server-side state.

## Tests

Pure (4): ceil rounding, minimum-only sale, priority order, insufficiency → `null`, whitelist bound.

Settlement-level, real repositories (4): two-resource sale with an exact `SHOP_SELL`/`SHOP_BUY` ledger
and wallet arithmetic; exact replay plus stale-Auto refusal; complete rollback on a stale wallet, a
stale cargo container and a stale Warehouse row; two same-transition attempts → one winner.

Route-level, real handler (9): minimum sale + Cargo grant + one receipt + `simulation_at` advance;
insufficient → nothing sold/bought (ZERO); unselected item untouched; fresh assignment defaults OFF;
offline reconciliation executes the action; priority order survives a reload and a 9-item list is
refused; a retry with a new HTTP request id pays once; two concurrent reconciliations land the same
economy as a single pass; the funded purchase's cost is measured.

## CountingD1 cost

Measured around the funded purchase (travel to the market, the purchase plus its sale, and the reads
that plan it):

```text
batches=2  statements=139  reads=119  rows read=84  writes=20  rows written=18
```

MEASURED locally against the real repositories; not a Cloudflare billing figure.

## Migration / deployment status

Migration `0028_auto_funding.sql` exists locally and is **not applied remotely**; nothing was deployed.

## Gates

```text
focused    funding 13 + funding-settlement 4 + B0.1/B1/B2/B2.5/B3 suites
full       186 files / 1791 tests passed
typecheck  pass      lint pass (0 warnings)      git diff --check clean
web build  pass (assets/index-B8nwME--.js)      Worker staging dry-run pass
```

---

## Staging release (2026-10-05)

Result: **B3_1_STAGING_DEPLOYED_READY_FOR_HUMAN_QA**. Staging only; production untouched.

```text
HEAD                     e502bb4 (203 dirty entries, nothing committed or pushed)
fresh gates              187 files / 1794 tests · typecheck · lint · diff --check
web build                assets/index-B8nwME--.js + index-B2g_eDoN.css
worker dry-run           1,600.23 KiB / 259.87 KiB gzip
migration audit          only 0028_auto_funding.sql pending
migration applied        YES (staging D1, 5 commands; local-only file, not in production)
schema verified          actor_jobs.auto_funding_enabled · auto_funding_items + its two unique
                         indexes and job index · 8 existing assignments, 0 with funding on ·
                         47 players / 33 farms / 726 inventory units unchanged
previous version         5a6c6d21-9a54-4b78-b237-ca3d3466252b
first B3.1 deploy        f9349a64-ae0a-4067-b723-96bac860d80e (superseded by the fix below)
current staging version  a77e3ba0-70d5-4164-ba94-7fa2ebfdecf3
rollback target          5a6c6d21-9a54-4b78-b237-ca3d3466252b
D1 before deploy         27 tables · 5.1 MB · rows_read_24h 695,059 (rolling window)
D1 after deploy          28 tables · 5.23 MB · rows_read_24h 616,956 (rolling window, not an A/B)
```

### Remote smoke

```text
GET  /                                    200, serves assets/index-B8nwME--.js + index-B2g_eDoN.css
GET  /api/health                          200
GET  /api/session                         200, hf_guest cookie
POST /farms (fresh guest)                 new farm
POST /farms/:id/work-areas + /jobs        new assignment: autoFundingEnabled=false, fundingItems=[]
POST .../policy { funding: { true, [corn, carrot] } }   200 -> enabled, order preserved
GET  /farms/:id/workers                    enabled=true, items [corn, carrot]  (server-side)
POST .../policy { funding: { false, [corn, carrot] } }  200 -> enabled=false, items retained
GET  /farms/:id/workers                    enabled=false, items [corn, carrot]
bundle checks                              funding toggle + priority controls + policy route present;
                                           CSS carries .auto-funding-row
```

### Bug found by the smoke and fixed before the final deploy

The first B3.1 deploy **hid the selection whenever funding was switched off** (the panel only read the
whitelist for enabled assignments), so a player who toggled funding off and on again would appear to
have lost their ticks while the rows stayed in the database. The panel now always reports the stored
whitelist - the *planner* still reads it only when funding is enabled - and `tests/web/funding-ui.test.ts`
plus the route-level persistence test pin the behavior. Redeployed as `a77e3ba0-…` and re-smoked.

### Human QA (user)

1. Open `https://happyfarm-staging.longfx.trade/` and pick a FARM assignment.
2. Turn on **Buy missing supplies**, then **Emergency funding**, and tick the resources you are willing
   to sell - e.g. Carrot then Corn - using the up/down arrows for priority.
3. Reach a state where the next seed purchase cannot be paid from Gold while the Warehouse holds one of
   the selected resources. (No need to manufacture it artificially; play until it happens.)
4. START Auto and record BEFORE: Gold, the selected resource quantities, carried seeds, priority.
5. After Auto funds a purchase, record AFTER: which resource was sold, how many units, Gold, carried
   seeds, and that Auto kept farming.
6. **Passing criterion**: Auto sold *only an explicitly selected resource* and *only the minimum
   quantity* needed to fund the supply purchase.
7. Negative checks: funding OFF + short Gold → nothing sold; funding ON but the whitelist cannot cover
   the shortfall → nothing sold, no purchase, `WAITING_FOR_FUNDS`; an unselected valuable resource is
   untouched.
8. Optional offline follow-up: with Auto running, short Gold and a selected resource available, close
   the tab, wait, reopen - reconciliation may perform the same funding action.
