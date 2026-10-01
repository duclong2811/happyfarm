-- Persistent construction: what a player built, where, and what it cost.
--
-- V12.5 could preview a placement and nothing else. This migration is the other half: a row per thing
-- a player actually built, one authoritative ground footprint per row, and the rules that make two
-- placements on the same cells impossible even when they arrive at the same moment.
--
-- Three decisions are enforced by the database rather than only by the use case, because a use case
-- that checks and then inserts is a use case that can lose a race:
--
--   1. **One occupant per cell.** A `BEFORE INSERT` trigger refuses a construction whose rectangle
--      intersects any other construction on the same farm. The rectangles are stored (`min_x`,
--      `max_x`, `min_y`, `max_y`) rather than derived, so the check is one indexed comparison.
--   2. **Owned ground only.** The same trigger counts the farm's own tiles inside the rectangle and
--      refuses the row unless every cell of it is owned. Ownership is `farm_tiles`, exactly as it is
--      for planting, so a later land expansion needs no change here.
--   3. **A building and a crop cannot share a cell.** Two more triggers extend the existing
--      crop/tree cross-occupancy rules to constructions, in both directions.
--
-- The ledger is rebuilt rather than extended because SQLite CHECK constraints are part of the table:
-- construction money is a new reason with a new reference kind, so the table that admits reasons has
-- to be replaced. The rebuild is the same shape 0006 and 0009 used, and the triggers that actually
-- move a wallet are recreated verbatim.
PRAGMA foreign_keys = ON;

CREATE TABLE farm_constructions (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'construct_*'),
  farm_id TEXT NOT NULL,
  catalogue_entry_id TEXT NOT NULL CHECK (catalogue_entry_id GLOB 'place_*'),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  anchor_x INTEGER NOT NULL CHECK (anchor_x BETWEEN -1000000 AND 1000000),
  anchor_y INTEGER NOT NULL CHECK (anchor_y BETWEEN -1000000 AND 1000000),
  rotation INTEGER NOT NULL CHECK (rotation BETWEEN 0 AND 3),
  footprint_width INTEGER NOT NULL CHECK (footprint_width BETWEEN 1 AND 64),
  footprint_depth INTEGER NOT NULL CHECK (footprint_depth BETWEEN 1 AND 64),
  min_x INTEGER NOT NULL CHECK (min_x BETWEEN -1000000 AND 1000000),
  max_x INTEGER NOT NULL CHECK (max_x BETWEEN -1000000 AND 1000000),
  min_y INTEGER NOT NULL CHECK (min_y BETWEEN -1000000 AND 1000000),
  max_y INTEGER NOT NULL CHECK (max_y BETWEEN -1000000 AND 1000000),
  /* How many cells the rectangle covers: what the ownership check counts tiles against. */
  cell_count INTEGER NOT NULL CHECK (cell_count BETWEEN 1 AND 4096),
  state TEXT NOT NULL CHECK (state = 'BUILT'),
  built_by_player_id TEXT NOT NULL,
  /* The price the catalogue charged, recorded here as well as in the ledger, from both sides. */
  cost_amount INTEGER NOT NULL CHECK (cost_amount BETWEEN 0 AND 9007199254740991),
  cost_currency_id TEXT NOT NULL CHECK (cost_currency_id GLOB 'currency_*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (max_x = min_x + footprint_width - 1),
  CHECK (max_y = min_y + footprint_depth - 1),
  CHECK (cell_count = footprint_width * footprint_depth),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (built_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_farm_constructions_farm_id ON farm_constructions(farm_id);
CREATE INDEX idx_farm_constructions_bounds ON farm_constructions(farm_id, min_x, max_x, min_y, max_y);

-- The cells the player is asking for must all be ownable: every one of them is a farm tile.
CREATE TRIGGER farm_construction_requires_owned_cells
BEFORE INSERT ON farm_constructions
WHEN (
  SELECT COUNT(*) FROM farm_tiles
  WHERE farm_id = NEW.farm_id
    AND x BETWEEN NEW.min_x AND NEW.max_x
    AND y BETWEEN NEW.min_y AND NEW.max_y
) <> NEW.cell_count
BEGIN
  SELECT RAISE(ABORT, 'construction cells are not owned');
END;

-- Nothing already stands there. Two rectangles overlap when neither is wholly to one side.
CREATE TRIGGER farm_construction_requires_free_cells
BEFORE INSERT ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM farm_constructions AS other
  WHERE other.farm_id = NEW.farm_id
    AND NEW.min_x <= other.max_x
    AND NEW.max_x >= other.min_x
    AND NEW.min_y <= other.max_y
    AND NEW.max_y >= other.min_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;

-- A crop or a tree may not share a cell with a building, in either direction of insertion.
CREATE TRIGGER farm_construction_requires_free_of_crop
BEFORE INSERT ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM crop_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x
    AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a crop');
END;

CREATE TRIGGER farm_construction_requires_free_of_tree
BEFORE INSERT ON farm_constructions
WHEN EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x
    AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a tree');
END;

CREATE TRIGGER crop_instance_requires_free_of_construction
BEFORE INSERT ON crop_instances
WHEN EXISTS (
  SELECT 1 FROM farm_constructions
  WHERE farm_id = NEW.farm_id
    AND NEW.tile_x BETWEEN min_x AND max_x
    AND NEW.tile_y BETWEEN min_y AND max_y
)
BEGIN
  SELECT RAISE(ABORT, 'tile holds a construction');
END;

CREATE TRIGGER tree_instance_requires_free_of_construction
BEFORE INSERT ON tree_instances
WHEN EXISTS (
  SELECT 1 FROM farm_constructions
  WHERE farm_id = NEW.farm_id
    AND NEW.tile_x BETWEEN min_x AND max_x
    AND NEW.tile_y BETWEEN min_y AND max_y
)
BEGIN
  SELECT RAISE(ABORT, 'tile holds a construction');
END;

-- The ledger admits construction money: one new reason, one new reference kind, still exactly one
-- reference kind per reason.
CREATE TABLE economy_ledger_rebuilt (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'econ_*'),
  player_id TEXT NOT NULL,
  currency_id TEXT NOT NULL CHECK (currency_id GLOB 'currency_*'),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
  balance_before INTEGER NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  expected_wallet_version INTEGER NOT NULL CHECK (expected_wallet_version >= 1),
  reason TEXT NOT NULL CHECK (
    reason IN ('SHOP_BUY', 'SHOP_SELL', 'FARM_EXPANSION', 'STARTER_GRANT', 'CONSTRUCTION')
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
    OR (reason = 'CONSTRUCTION' AND reference_type = 'CONSTRUCTION')
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
-- `starter_grant_apply` reads and writes `economy_ledger` too, so it has to come down with the table
-- and be recreated once the replacement is in place - SQLite refuses to leave a trigger pointing at a
-- table that no longer exists.
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

-- Verbatim from 0009: the starter package credits its gold through the same ledger every other
-- movement uses, so the trigger is recreated exactly as it was.
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

-- A placement receipt may never commit without the construction it claims to have built, and the
-- construction must be the actor's own.
CREATE TRIGGER idempotency_construction_requires_construction
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLACE_CONSTRUCTION'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM farm_constructions
      WHERE id = NEW.resource_id
        AND built_by_player_id = NEW.actor_player_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed construction idempotency requires its construction');
END;
