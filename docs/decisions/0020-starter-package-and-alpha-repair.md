# ADR 0020: The starter package, and repairing the alpha's stranded players

Status: Accepted (2026-09-30)

Supersedes the "starter grant happens once per player" decision in ADR 0013 in two ways: the grant is
now a *package* (seeds **and** gold), and it is applied by the deployed onboarding step, not only by
the development host.

## Context

The deployed staging build handed a new player a `players` row and nothing else:

- `OnboardingAuthenticator` created the row and stopped there. The one-time starter grant existed,
  but only the development host called it (`workers/api/src/dev-index.ts`), so a real Access visitor
  never received it.
- No code path granted gold at all. There was no starting balance anywhere in the game.

The result was a new player with 0 gold and 0 seeds, standing in front of a shop whose cheapest seed
costs gold. The farming loop could not be entered, and the alpha's players could not be measured
because none of them could play.

## Decision

### The package is game data

`packages/game-data/src/starter/index.ts` defines the whole package: receipt key
`starter_package_v1`, the seed `item_carrot_seed` x10, and 100 `currency_gold`. The registries are
validated at load, so the package cannot name an item that is not a seed or a currency that does not
exist. Wheat, corn, and saplings are deliberately absent: only the level-1 crop is granted, and the
level-2 and level-3 crops stay behind the unlock rules that already existed.

### The receipt is still the whole command, and now it carries both halves

`0009_starter_package.sql` generalizes `starter_seed_grants` into `starter_grants`, keyed by
`(player_id, grant_key)`. The insert *is* the grant: one `AFTER INSERT` trigger credits the seed
stack, creates the wallet when it is missing, and appends the currency to `economy_ledger`, all in
the same statement as the receipt.

That is what makes the package one-time for every way a player could try to obtain it twice:

| Attempt | Why nothing more is credited |
| --- | --- |
| Refresh / reload | the page re-runs onboarding; the receipt already exists |
| Reconnect / sign in again | same player id, same receipt |
| Retry a failed request | the receipt is written once, or not at all |
| Replay `POST /farms` or bootstrap | onboarding is not a command and is not routed |
| Two requests at once | the primary key resolves the race inside one statement |
| A second farm | the receipt is player-scoped, not farm-scoped |

`economy_ledger` gained the `STARTER_GRANT` reason and the `PLAYER` reference kind so the gold is an
ordinary, auditable currency mutation with a transaction id, before/after balances, and an expected
wallet version. The row is read from the wallet inside the trigger, so the recorded balances are the
ones the wallet really had when the package settled.

### Both halves are prepared through the centralized boundaries

`GrantStarterPackage` prepares the seed credit through `InventoryService` and the gold credit through
`EconomyService.prepareMutation` (reason `STARTER_GRANT`, reference = the player). An impossible
stack or an unrepresentable balance is refused before any statement runs, and the fail-closed guard
in the trigger refuses to commit a receipt that was supposed to move currency and did not.

### Who gets it is an explicit deployment decision

`OnboardingAuthenticator` takes a policy:

- `NEW_PLAYERS` (the default, and what production should use): the package goes to a visitor whose
  Player row this request creates. An existing player's balance is never touched.
- `ALL_UNRECEIPTED`: also offers it to a player who exists and has no receipt - the alpha testers
  who were created before the package existed. It is still one grant per player, because the receipt
  is still the primary key; what changes is only who is *offered* it.

Staging sets `STARTER_GRANT_POLICY = "ALL_UNRECEIPTED"`. Production leaves it unset, so production
isolation is a decision somebody made rather than a default.

### Repair is a separate, staging-only, opt-in action

`scripts/repair/starter-package-backfill.mjs` hands the package to staging players who have no
receipt, for anyone who never signs in again. It is a dry run unless `--apply` is passed, it reads
the package out of game data rather than restating it, and it refuses any database or config other
than `happy-farm-staging` with `workers/api/wrangler.staging.toml`. There is no production database
name it accepts.

The migration itself writes no package: it only moves the schema and carries the old seed-only
receipts forward under the key `starter_seed_v1`, so nobody is silently marked as having received a
package they never got.

## Consequences

- A new player can farm: 10 seeds and 100 gold is more plantings than the starter square needs, and
  the first harvest funds the next seed.
- `STARTING_LAND` grew at the same time (ADR 0021), so 10 seeds is a first planting rather than a
  whole field. That is a deliberate balance point: the shop stays the way to scale up.
- The package is a currency mutation, so it appears in the wallet history. A player who reads their
  ledger sees one `STARTER_GRANT` row of +100 and nothing else.
- A player who already held gold or seeds keeps every unit: the credit is additive, and no path in
  this feature reads a balance except to write it up.
- The grant adds one statement to the first authenticated request of a new visitor, and (under
  `ALL_UNRECEIPTED`) one idempotent insert per request for everyone else. That is the price of
  self-healing an alpha, and it is the reason the default is `NEW_PLAYERS`.
