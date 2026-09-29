-- Farm expansion: buying land with currency, and the wider ledger vocabulary that needs.
--
-- Land is added by inserting tiles, never by widening a bound: an existing `farm_tiles` row *is*
-- unlocked land (`UnlockedLandPolicy`), so a plot is simply a cohort of tiles that did not exist
-- before. No column and no table is added for land, which is what keeps planting, harvesting, and
-- the crop foreign key working unchanged.
--
-- What does change is `economy_ledger`, whose 0004 CHECK constraints admit only shop references.
-- Committed migrations are immutable, and SQLite cannot drop a CHECK constraint, so the table is
-- rebuilt in the standard way: create the replacement, copy every row, drop the old table (which
-- drops its triggers), rename the replacement into place, then recreate the indexes and all four
-- triggers verbatim. Nothing references `economy_ledger`, so no foreign key has to be disabled and
-- no other table has to be rewritten. The copy is total and in one transaction with the rest of the
-- migration, so history is preserved rather than migrated.
--
-- Two things are widened, and only two:
--   * `reason` gains FARM_EXPANSION: the one reason currency may move for land.
--   * `reference_type`/`reference_id` gain the PLOT kind, whose ids are `plot_<index>`.
-- The pairing between them is made explicit and total rather than implied, so a row still cannot
-- claim to be a shop purchase while citing a plot, or the reverse. The domain's
-- `referenceTypeForReason` derives the same pairing on every write, and
-- `assertReferenceMatchesType` refuses a mismatch before it reaches the database.
PRAGMA foreign_keys = ON;

CREATE TABLE economy_ledger_rebuilt (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'econ_*'),
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_before INTEGER NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  expected_wallet_version INTEGER NOT NULL CHECK (expected_wallet_version >= 1),
  reason TEXT NOT NULL CHECK (reason IN ('SHOP_BUY', 'SHOP_SELL', 'FARM_EXPANSION')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('SHOP_ENTRY', 'PLOT')),
  reference_id TEXT NOT NULL CHECK (reference_id GLOB 'shop_*' OR reference_id GLOB 'plot_*'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  CHECK (balance_after = balance_before + delta),
  CHECK (
    (reference_type = 'SHOP_ENTRY' AND reference_id GLOB 'shop_*')
    OR (reference_type = 'PLOT' AND reference_id GLOB 'plot_*')
  ),
  CHECK (
    (reason IN ('SHOP_BUY', 'SHOP_SELL') AND reference_type = 'SHOP_ENTRY')
    OR (reason = 'FARM_EXPANSION' AND reference_type = 'PLOT')
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

-- A completed expansion record cannot commit unless the ledger row it paid through exists and
-- belongs to the same actor, exactly as a completed harvest requires its settlement row. The
-- resource of an expansion is its economy transaction: land has no row of its own to point at,
-- because the tiles are the land.
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
