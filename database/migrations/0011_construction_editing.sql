-- Editing what a player built: move it, turn it, take it down.
--
-- 0010 enforced the ground rules on INSERT, because placing was the only thing a player could do. A
-- move is an UPDATE, and an UPDATE that skips the ownership and overlap rules would let a player
-- walk a barn onto somebody else's land or on top of a crop - so the same four rules are attached to
-- UPDATE, with the row being moved excluded from its own overlap check by id.
--
-- Removing something returns part of what it cost, and the ledger has to admit that reason. SQLite
-- CHECK constraints are part of the table, so the ledger is rebuilt exactly as 0006, 0009 and 0010
-- rebuilt it, with `CONSTRUCTION_REFUND` added and every trigger that moves a wallet recreated
-- verbatim.
PRAGMA foreign_keys = ON;

-- The destination cells must all be owned.
CREATE TRIGGER farm_construction_update_requires_owned_cells
BEFORE UPDATE ON farm_constructions
WHEN (
  SELECT COUNT(*) FROM farm_tiles
  WHERE farm_id = NEW.farm_id
    AND x BETWEEN NEW.min_x AND NEW.max_x
    AND y BETWEEN NEW.min_y AND NEW.max_y
) <> NEW.cell_count
BEGIN
  SELECT RAISE(ABORT, 'construction cells are not owned');
END;

-- Nothing *else* already stands there. The object's own row is not an obstacle to itself.
CREATE TRIGGER farm_construction_update_requires_free_cells
BEFORE UPDATE ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM farm_constructions AS other
  WHERE other.farm_id = NEW.farm_id
    AND other.id <> NEW.id
    AND NEW.min_x <= other.max_x
    AND NEW.max_x >= other.min_x
    AND NEW.min_y <= other.max_y
    AND NEW.max_y >= other.min_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;

-- A building may not be moved onto a crop or a tree, in either direction of the move.
CREATE TRIGGER farm_construction_update_requires_free_of_crop
BEFORE UPDATE ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM crop_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x
    AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a crop');
END;

CREATE TRIGGER farm_construction_update_requires_free_of_tree
BEFORE UPDATE ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x
    AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a tree');
END;

-- The ledger admits a refund. Same table, one more reason, still exactly one reference kind each.
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
      'SHOP_BUY', 'SHOP_SELL', 'FARM_EXPANSION', 'STARTER_GRANT', 'CONSTRUCTION', 'CONSTRUCTION_REFUND'
    )
  ),
  reference_type TEXT NOT NULL CHECK (
    reference_type IN ('SHOP_ENTRY', 'PLOT', 'PLAYER', 'CONSTRUCTION')
  ),
  reference_id TEXT NOT NULL CHECK (
    reference_id GLOB 'shop_*'
    OR reference_id GLOB 'plot_*'
    OR reference_id GLOB 'player_*'
    OR reference_id GLOB 'construct_*'
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  CHECK (balance_after = balance_before + delta),
  CHECK (
    (reference_type = 'SHOP_ENTRY' AND reference_id GLOB 'shop_*')
    OR (reference_type = 'PLOT' AND reference_id GLOB 'plot_*')
    OR (reference_type = 'PLAYER' AND reference_id GLOB 'player_*')
    OR (reference_type = 'CONSTRUCTION' AND reference_id GLOB 'construct_*')
  ),
  CHECK (
    (reason IN ('SHOP_BUY', 'SHOP_SELL') AND reference_type = 'SHOP_ENTRY')
    OR (reason = 'FARM_EXPANSION' AND reference_type = 'PLOT')
    OR (reason = 'STARTER_GRANT' AND reference_type = 'PLAYER')
    OR (reason IN ('CONSTRUCTION', 'CONSTRUCTION_REFUND') AND reference_type = 'CONSTRUCTION')
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

DROP TRIGGER IF EXISTS idempotency_expand_requires_ledger;
-- `starter_grant_apply` reads and writes `economy_ledger` too, so it comes down with the table and is
-- recreated once the replacement is in place.
DROP TRIGGER IF EXISTS starter_grant_apply;

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

-- Verbatim from 0010: the starter package credits its gold through the same ledger.
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

-- A move or a turn: the row must exist, it must have been written *by this batch*, and the actor must
-- be a member of the farm with a role that may build there. `updated_at` is the batch's own clock, so
-- a receipt cannot claim a move the UPDATE never made.
CREATE TRIGGER idempotency_construction_edit_requires_construction
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation IN ('MOVE_CONSTRUCTION', 'ROTATE_CONSTRUCTION')
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM farm_constructions AS construction
      JOIN farm_members AS member
        ON member.farm_id = construction.farm_id
       AND member.player_id = NEW.actor_player_id
       AND member.role IN ('OWNER', 'EDITOR')
      WHERE construction.id = NEW.resource_id
        AND construction.updated_at = NEW.created_at
        AND construction.version > 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed construction edit idempotency requires its move');
END;

-- A removal: the object must be gone, and when the receipt points at a refund (a ledger id rather
-- than an object id) that refund must exist, in the actor's own name, for this object.
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
