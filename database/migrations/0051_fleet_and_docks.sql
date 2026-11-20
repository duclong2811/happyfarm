-- The fleet (docs/design/FLEET.md, F1).
--
-- A player keeps several ships, each in a berth at their dock; the dock's tier sets how many berths
-- there are. `player_ships` is rebuilt to key a ship by its own id rather than by its player: every
-- stored ship (there was at most one a player) moves across unchanged into berth 1, its id the same.
-- (player_id, berth) is unique, so two builds racing for the same berth cannot both land.
--
-- `player_docks` holds a player's dock once it has been raised past the starting tier; no row means
-- the starting dock. Raising it is gold through the ledger as `DOCK_UPGRADE`, pointing at the dock,
-- with wood and ore through the inventory, in one batch with its receipt.
--
-- A voyage names the ship that sails it (`ship_id`); a voyage stored before this names none, and was
-- sailed by the ship in berth 1.
--
-- The ledger is rebuilt rather than patched because SQLite cannot alter a CHECK constraint, exactly as
-- 0018, 0044, 0047 and 0050 did. The table, its indexes and its 4 triggers, and the 7 triggers on other
-- tables that read it, are recreated exactly as they stood (taken from the schema as 0050 left it),
-- with `DOCK_UPGRADE` / `DOCK` added and a receipt guard for dock upgrades.
PRAGMA foreign_keys = ON;

CREATE TABLE player_ships_rebuilt (
  ship_id TEXT PRIMARY KEY NOT NULL CHECK (ship_id GLOB 'ship_*'),
  player_id TEXT NOT NULL,
  berth INTEGER NOT NULL CHECK (berth BETWEEN 1 AND 8),
  class_id TEXT NOT NULL CHECK (class_id GLOB 'ship_class_*'),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 16),
  hull INTEGER NOT NULL CHECK (hull >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_change_id TEXT CHECK (last_change_id IS NULL OR length(last_change_id) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (player_id, berth),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO player_ships_rebuilt (ship_id, player_id, berth, class_id, tier, hull, version, last_change_id, created_at, updated_at)
SELECT ship_id, player_id, 1, class_id, tier, hull, version, last_change_id, created_at, updated_at
FROM player_ships;

DROP TABLE player_ships;
ALTER TABLE player_ships_rebuilt RENAME TO player_ships;

CREATE TABLE player_docks (
  player_id TEXT PRIMARY KEY NOT NULL,
  dock_id TEXT NOT NULL UNIQUE CHECK (dock_id GLOB 'dock_*'),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 16),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_change_id TEXT CHECK (last_change_id IS NULL OR length(last_change_id) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

ALTER TABLE ship_voyages ADD COLUMN ship_id TEXT CHECK (ship_id IS NULL OR ship_id GLOB 'ship_*');

DROP TRIGGER IF EXISTS idempotency_construction_remove_requires_effect;
DROP TRIGGER IF EXISTS idempotency_expand_requires_ledger;
DROP TRIGGER IF EXISTS idempotency_mine_upgrade_requires_ledger;
DROP TRIGGER IF EXISTS idempotency_ship_build_requires_ledger;
DROP TRIGGER IF EXISTS idempotency_warehouse_upgrade_requires_ledger;
DROP TRIGGER IF EXISTS starter_grant_apply;
DROP TRIGGER IF EXISTS idempotency_pirate_bounty_requires_ledger;

CREATE TABLE economy_ledger_rebuilt (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'econ_*'),
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_before INTEGER NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  expected_wallet_version INTEGER NOT NULL CHECK (expected_wallet_version >= 1),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'SHOP_BUY', 'SHOP_SELL', 'FARM_EXPANSION', 'STARTER_GRANT', 'CONSTRUCTION', 'CONSTRUCTION_REFUND',
      'WAREHOUSE_UPGRADE', 'MINE_UPGRADE', 'SHIP_BUILD', 'SHIP_REPAIR', 'PIRATE_BOUNTY', 'DOCK_UPGRADE'
    )
  ),
  reference_type TEXT NOT NULL CHECK (
    reference_type IN ('SHOP_ENTRY', 'PLOT', 'PLAYER', 'CONSTRUCTION', 'WAREHOUSE', 'MINE', 'SHIP', 'DOCK')
  ),
  reference_id TEXT NOT NULL CHECK (
    reference_id GLOB 'shop_*'
    OR reference_id GLOB 'plot_*'
    OR reference_id GLOB 'player_*'
    OR reference_id GLOB 'construct_*'
    OR reference_id GLOB 'warehouse_*'
    OR reference_id GLOB 'mine_*'
    OR reference_id GLOB 'ship_*'
    OR reference_id GLOB 'dock_*'
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  CHECK (balance_after = balance_before + delta),
  CHECK (
    (reference_type = 'SHOP_ENTRY' AND reference_id GLOB 'shop_*')
    OR (reference_type = 'PLOT' AND reference_id GLOB 'plot_*')
    OR (reference_type = 'PLAYER' AND reference_id GLOB 'player_*')
    OR (reference_type = 'CONSTRUCTION' AND reference_id GLOB 'construct_*')
    OR (reference_type = 'WAREHOUSE' AND reference_id GLOB 'warehouse_*')
    OR (reference_type = 'MINE' AND reference_id GLOB 'mine_*')
    OR (reference_type = 'SHIP' AND reference_id GLOB 'ship_*')
    OR (reference_type = 'DOCK' AND reference_id GLOB 'dock_*')
  ),
  CHECK (
    (reason IN ('SHOP_BUY', 'SHOP_SELL') AND reference_type = 'SHOP_ENTRY')
    OR (reason = 'FARM_EXPANSION' AND reference_type = 'PLOT')
    OR (reason = 'STARTER_GRANT' AND reference_type = 'PLAYER')
    OR (reason IN ('CONSTRUCTION', 'CONSTRUCTION_REFUND') AND reference_type = 'CONSTRUCTION')
    OR (reason = 'WAREHOUSE_UPGRADE' AND reference_type = 'WAREHOUSE')
    OR (reason = 'MINE_UPGRADE' AND reference_type = 'MINE')
    OR (reason IN ('SHIP_BUILD', 'SHIP_REPAIR', 'PIRATE_BOUNTY') AND reference_type = 'SHIP')
    OR (reason = 'DOCK_UPGRADE' AND reference_type = 'DOCK')
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

CREATE TRIGGER economy_ledger_immutable_delete
BEFORE DELETE ON economy_ledger
BEGIN
  SELECT RAISE(ABORT, 'economy ledger is immutable');
END;

CREATE TRIGGER economy_ledger_immutable_update
BEFORE UPDATE ON economy_ledger
BEGIN
  SELECT RAISE(ABORT, 'economy ledger is immutable');
END;

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

CREATE TRIGGER idempotency_construction_remove_requires_effect
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'REMOVE_CONSTRUCTION'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR EXISTS (SELECT 1 FROM farm_constructions WHERE id = NEW.resource_id)
    OR (
      NEW.resource_id GLOB 'econ_*'
      AND NOT EXISTS (
        SELECT 1 FROM economy_ledger
        WHERE id = NEW.resource_id
          AND player_id = NEW.actor_player_id
          AND reason = 'CONSTRUCTION_REFUND'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed construction removal idempotency requires its effect');
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

CREATE TRIGGER idempotency_mine_upgrade_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'MINE_UPGRADE'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'MINE_UPGRADE'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed mine upgrade idempotency requires its ledger row');
END;

CREATE TRIGGER idempotency_ship_build_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'SHIP_BUILD'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'SHIP_BUILD'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed ship build idempotency requires its ledger row');
END;

CREATE TRIGGER idempotency_warehouse_upgrade_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'WAREHOUSE_UPGRADE'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'WAREHOUSE_UPGRADE'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed warehouse upgrade idempotency requires its ledger row');
END;

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

  SELECT RAISE(ABORT, 'starter grant did not settle its currency')
  WHERE NEW.gold_amount > 0
    AND NOT EXISTS (SELECT 1 FROM economy_ledger WHERE id = NEW.transaction_id);
END;

CREATE TRIGGER idempotency_pirate_bounty_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PIRATE_BOUNTY'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'PIRATE_BOUNTY'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed pirate bounty idempotency requires its ledger row');
END;

CREATE TRIGGER idempotency_dock_upgrade_requires_ledger
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'DOCK_UPGRADE'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM economy_ledger
      WHERE id = NEW.resource_id
        AND player_id = NEW.actor_player_id
        AND reason = 'DOCK_UPGRADE'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed dock upgrade idempotency requires its ledger row');
END;
