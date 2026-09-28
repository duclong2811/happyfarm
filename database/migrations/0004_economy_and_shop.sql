-- Authoritative wallets and append-only economy history.
PRAGMA foreign_keys = ON;

CREATE TABLE wallets (
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (player_id, currency_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE economy_ledger (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'econ_*'),
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_before INTEGER NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  expected_wallet_version INTEGER NOT NULL CHECK (expected_wallet_version >= 1),
  reason TEXT NOT NULL CHECK (reason IN ('SHOP_BUY', 'SHOP_SELL')),
  reference_type TEXT NOT NULL CHECK (reference_type = 'SHOP_ENTRY'),
  reference_id TEXT NOT NULL CHECK (reference_id GLOB 'shop_*'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  CHECK (balance_after = balance_before + delta),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

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
