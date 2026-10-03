-- Island Warehouse: finite Home Island storage, and the ledger reason its upgrade pays through.
--
-- The warehouse is **capacity over the existing inventory**, not a second inventory. Stored goods
-- stay in `inventory_items`; this migration adds the one budget that bounds them and a trigger pair
-- that enforces it at the moment any row grows. That is what makes "can this fit?" atomic on every
-- grant path - harvest, tree, fishing, gathering, shop buy, the starter package - without a second
-- check that a future code path could forget.
--
-- Ownership: one warehouse per player's HOME_ISLAND today. `zone_kind`/`zone_id` are stored so a
-- future expansion island is another row rather than a redesign; current inventory is player-scoped,
-- so the compatibility bridge is `owner_player_id`.
--
-- Capacity is stored on the row (written by the server, never the client) and is derived from the
-- tier in `packages/game-data/src/warehouse`. A player with no row is treated as the starter tier by
-- the guard, so every player is constrained from birth. The starter capacity here MUST equal
-- `STARTER_WAREHOUSE_CAPACITY`; `tests/integration/warehouse-migration.test.ts` keeps them equal.
PRAGMA foreign_keys = ON;

CREATE TABLE home_island_warehouses (
  owner_player_id TEXT PRIMARY KEY NOT NULL,
  zone_kind TEXT NOT NULL DEFAULT 'HOME_ISLAND' CHECK (zone_kind = 'HOME_ISLAND'),
  zone_id TEXT,
  tier INTEGER NOT NULL DEFAULT 0 CHECK (tier >= 0),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 1000000000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Every existing player gets the starter tier. Deterministic and idempotent, so a re-run adds nothing.
INSERT OR IGNORE INTO home_island_warehouses (
  owner_player_id, zone_kind, zone_id, tier, capacity, version, created_at, updated_at
)
SELECT
  player.id,
  'HOME_ISLAND',
  (SELECT farm.id FROM farms AS farm WHERE farm.owner_player_id = player.id LIMIT 1),
  0,
  1000,
  1,
  player.created_at,
  player.updated_at
FROM players AS player;

-- Every player created from now on gets the starter warehouse in the same transaction as the player
-- row, so a grant can never reach an unconstrained account. `zone_id` is filled in when the player's
-- farm appears; the guard keys off the player until then.
CREATE TRIGGER warehouse_create_for_player
AFTER INSERT ON players
BEGIN
  INSERT OR IGNORE INTO home_island_warehouses (
    owner_player_id, zone_kind, zone_id, tier, capacity, version, created_at, updated_at
  )
  VALUES (NEW.id, 'HOME_ISLAND', NULL, 0, 1000, 1, NEW.created_at, NEW.updated_at);
END;

-- The capacity guard. It runs inside whatever transaction writes the row, so a grant either fits or
-- the whole settlement rolls back. A grandfathered over-capacity player is not blocked from reading or
-- removing goods: only a row that *grows* can trip it, so selling and consuming always work.
CREATE TRIGGER warehouse_capacity_guard_insert
BEFORE INSERT ON inventory_items
WHEN NEW.quantity > 0
  AND COALESCE(
        (SELECT capacity FROM home_island_warehouses WHERE owner_player_id = NEW.player_id),
        1000
      ) < (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = NEW.player_id) + NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'warehouse_full');
END;

CREATE TRIGGER warehouse_capacity_guard_update
BEFORE UPDATE ON inventory_items
WHEN NEW.quantity > OLD.quantity
  AND COALESCE(
        (SELECT capacity FROM home_island_warehouses WHERE owner_player_id = NEW.player_id),
        1000
      ) < (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = NEW.player_id) - OLD.quantity + NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'warehouse_full');
END;

-- The ledger admits the warehouse-upgrade reason. Rebuilt rather than patched because SQLite cannot
-- alter a CHECK constraint; the table, its four triggers, and the three idempotency/starter triggers
-- that read it are recreated exactly as they stood, with `WAREHOUSE` added.
DROP TRIGGER IF EXISTS idempotency_expand_requires_ledger;
DROP TRIGGER IF EXISTS idempotency_construction_remove_requires_effect;
DROP TRIGGER IF EXISTS starter_grant_apply;

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
      'WAREHOUSE_UPGRADE'
    )
  ),
  reference_type TEXT NOT NULL CHECK (
    reference_type IN ('SHOP_ENTRY', 'PLOT', 'PLAYER', 'CONSTRUCTION', 'WAREHOUSE')
  ),
  reference_id TEXT NOT NULL CHECK (
    reference_id GLOB 'shop_*'
    OR reference_id GLOB 'plot_*'
    OR reference_id GLOB 'player_*'
    OR reference_id GLOB 'construct_*'
    OR reference_id GLOB 'warehouse_*'
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
  ),
  CHECK (
    (reason IN ('SHOP_BUY', 'SHOP_SELL') AND reference_type = 'SHOP_ENTRY')
    OR (reason = 'FARM_EXPANSION' AND reference_type = 'PLOT')
    OR (reason = 'STARTER_GRANT' AND reference_type = 'PLAYER')
    OR (reason IN ('CONSTRUCTION', 'CONSTRUCTION_REFUND') AND reference_type = 'CONSTRUCTION')
    OR (reason = 'WAREHOUSE_UPGRADE' AND reference_type = 'WAREHOUSE')
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

-- The warehouse upgrade is a ledgered currency sink, so its receipt only exists when the ledger row does.
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
