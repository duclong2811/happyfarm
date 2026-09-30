-- The starter package: one server-authoritative grant per player, seeds *and* currency.
--
-- The alpha staging build handed a new player nothing, so a new player could not plant and could not
-- buy a seed. The fix is still the one receipt the seed economy already used -- a player-scoped key
-- whose insert *is* the command -- widened to carry the whole package: the seed item and quantity,
-- the currency, and the gold amount. Nothing about "exactly once" changes, because it was never
-- enforced by the caller: it is the receipt's primary key.
--
-- Two things change in the schema, and only two.
--
-- 1. `starter_seed_grants` becomes `starter_grants`, keyed by `(player_id, grant_key)` instead of by
--    the player alone. The old rows are carried over verbatim under the key `starter_seed_v1`, so the
--    record of who received the pre-package grant survives, and the package is a *different* key that
--    is granted once to those players too. One table, one mechanism, no second starter-reward system.
--
-- 2. `economy_ledger` gains the STARTER_GRANT reason and the PLAYER reference kind, so the gold the
--    package credits is an ordinary, auditable currency mutation like every other one. A committed
--    migration is immutable and SQLite cannot drop a CHECK constraint, so the table is rebuilt the
--    same way `0006_farm_expansion.sql` rebuilt it: create the replacement, copy every row, drop the
--    old table (which drops its triggers), rename the replacement into place, then recreate the
--    indexes and the four triggers verbatim. `idempotency_expand_requires_ledger` lives on
--    `idempotency_keys` and is untouched by that drop.
--
-- The receipt insert is still the whole command. `starter_grant_apply` credits the seed stack, makes
-- the wallet exist, and appends the ledger row in the same statement as the receipt, so there is no
-- window in which a player has the package without the record of it, or the record without the
-- package. The ledger row's own triggers (`economy_ledger_validate_wallet`, `economy_ledger_apply_wallet`)
-- are what actually move the balance, so the package cannot move currency by any path a shop purchase
-- would not take.
PRAGMA foreign_keys = ON;

CREATE TABLE economy_ledger_rebuilt (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'econ_*'),
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_before INTEGER NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  expected_wallet_version INTEGER NOT NULL CHECK (expected_wallet_version >= 1),
  reason TEXT NOT NULL CHECK (reason IN ('SHOP_BUY', 'SHOP_SELL', 'FARM_EXPANSION', 'STARTER_GRANT')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('SHOP_ENTRY', 'PLOT', 'PLAYER')),
  reference_id TEXT NOT NULL CHECK (
    reference_id GLOB 'shop_*' OR reference_id GLOB 'plot_*' OR reference_id GLOB 'player_*'
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  CHECK (balance_after = balance_before + delta),
  CHECK (
    (reference_type = 'SHOP_ENTRY' AND reference_id GLOB 'shop_*')
    OR (reference_type = 'PLOT' AND reference_id GLOB 'plot_*')
    OR (reference_type = 'PLAYER' AND reference_id GLOB 'player_*')
  ),
  CHECK (
    (reason IN ('SHOP_BUY', 'SHOP_SELL') AND reference_type = 'SHOP_ENTRY')
    OR (reason = 'FARM_EXPANSION' AND reference_type = 'PLOT')
    OR (reason = 'STARTER_GRANT' AND reference_type = 'PLAYER')
  ),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO economy_ledger_rebuilt (
  id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version,
  reason, reference_type, reference_id, request_id, created_at
)
SELECT
  id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version,
  reason, reference_type, reference_id, request_id, created_at
FROM economy_ledger;

-- `idempotency_expand_requires_ledger` (0006) lives on `idempotency_keys` but reads `economy_ledger`,
-- so it has to come down before the table does - SQLite refuses to leave a schema object pointing at
-- a table that no longer exists - and it is recreated verbatim once the replacement is in place.
DROP TRIGGER IF EXISTS idempotency_expand_requires_ledger;

DROP TABLE economy_ledger;
ALTER TABLE economy_ledger_rebuilt RENAME TO economy_ledger;

CREATE INDEX idx_economy_ledger_player_created ON economy_ledger(player_id, created_at);
CREATE INDEX idx_economy_ledger_player_request ON economy_ledger(player_id, request_id);
CREATE INDEX idx_economy_ledger_reference ON economy_ledger(reference_type, reference_id);

CREATE TRIGGER economy_ledger_validate_wallet
BEFORE INSERT ON economy_ledger
WHEN NOT EXISTS (
  SELECT 1 FROM wallets
  WHERE player_id = NEW.player_id
    AND currency_id = NEW.currency_id
    AND balance = NEW.balance_before
    AND version = NEW.expected_wallet_version
    AND NEW.balance_after BETWEEN 0 AND 9007199254740991
)
BEGIN
  SELECT RAISE(ABORT, 'economy conflict');
END;

CREATE TRIGGER economy_ledger_apply_wallet
AFTER INSERT ON economy_ledger
BEGIN
  UPDATE wallets
  SET balance = NEW.balance_after,
      version = version + 1,
      updated_at = NEW.created_at
  WHERE player_id = NEW.player_id
    AND currency_id = NEW.currency_id
    AND balance = NEW.balance_before
    AND version = NEW.expected_wallet_version;
END;

CREATE TRIGGER economy_ledger_immutable_update
BEFORE UPDATE ON economy_ledger
BEGIN
  SELECT RAISE(ABORT, 'economy ledger is immutable');
END;

CREATE TRIGGER economy_ledger_immutable_delete
BEFORE DELETE ON economy_ledger
BEGIN
  SELECT RAISE(ABORT, 'economy ledger is immutable');
END;

CREATE TRIGGER idempotency_expand_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'EXPAND_FARM'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'FARM_EXPANSION'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed expansion idempotency requires its ledger row');
END;

-- The generalized one-time receipt. One row per (player, grant key), forever.
--
-- `transaction_id` and `request_id` are nullable because the pre-package rows copied out of
-- `starter_seed_grants` never moved currency and therefore never had a ledger row; a receipt that
-- does move currency must name both, which the table CHECK enforces.
CREATE TABLE starter_grants (
  player_id TEXT NOT NULL,
  grant_key TEXT NOT NULL CHECK (grant_key GLOB 'starter_*'),
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  item_quantity INTEGER NOT NULL CHECK (item_quantity BETWEEN 0 AND 2147483647),
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  gold_amount INTEGER NOT NULL CHECK (gold_amount BETWEEN 0 AND 9007199254740991),
  transaction_id TEXT CHECK (transaction_id IS NULL OR transaction_id GLOB 'econ_*'),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  PRIMARY KEY (player_id, grant_key),
  CHECK (gold_amount = 0 OR (transaction_id IS NOT NULL AND request_id IS NOT NULL)),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO starter_grants (
  player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount,
  transaction_id, request_id, created_at
)
SELECT
  player_id, 'starter_seed_v1', item_definition_id, quantity, 'currency_gold', 0,
  NULL, NULL, created_at
FROM starter_seed_grants;

DROP TABLE starter_seed_grants;

-- The receipt and everything it grants, in one statement.
--
-- The wallet is created before the ledger row that moves it, and the ledger row is what actually
-- applies the credit through `economy_ledger_apply_wallet`. The row is read inside this trigger
-- rather than taken from a caller-prepared snapshot, so the recorded before/after balance and
-- version are the ones the wallet really had at the moment the package settled. Nothing here can
-- run twice for one player and one grant key, because the insert that fires it cannot.
CREATE TRIGGER starter_grant_apply
AFTER INSERT ON starter_grants
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  SELECT NEW.player_id, NEW.item_definition_id, NEW.item_quantity, NEW.created_at, 1
  WHERE NEW.item_quantity > 0
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;

  INSERT OR IGNORE INTO wallets (player_id, currency_id, balance, version, created_at, updated_at)
  SELECT NEW.player_id, NEW.currency_id, 0, 1, NEW.created_at, NEW.created_at
  WHERE NEW.gold_amount > 0;

  INSERT INTO economy_ledger (
    id, player_id, currency_id, delta, balance_before, balance_after, expected_wallet_version,
    reason, reference_type, reference_id, request_id, created_at
  )
  SELECT
    NEW.transaction_id, NEW.player_id, NEW.currency_id, NEW.gold_amount,
    wallet.balance, wallet.balance + NEW.gold_amount, wallet.version,
    'STARTER_GRANT', 'PLAYER', NEW.player_id, NEW.request_id, NEW.created_at
  FROM wallets AS wallet
  WHERE NEW.gold_amount > 0
    AND wallet.player_id = NEW.player_id
    AND wallet.currency_id = NEW.currency_id;

  -- Fail closed: a receipt that was supposed to move currency but did not must not commit at all,
  -- otherwise the player would be marked as granted without the gold.
  SELECT RAISE(ABORT, 'starter grant did not settle its currency')
  WHERE NEW.gold_amount > 0
    AND NOT EXISTS (SELECT 1 FROM economy_ledger WHERE id = NEW.transaction_id);
END;
