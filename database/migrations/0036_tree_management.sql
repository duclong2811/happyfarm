-- V18: player-planted tree management.
--
-- A stored tree remains the same tree instance, but must stop occupying its old cell. The original
-- table used an unconditional UNIQUE(farm_id, tile_x, tile_y), so this migration rebuilds that one
-- table into an active-only unique index. Existing rows are copied as ACTIVE with their lifecycle and
-- identity untouched; no tree is moved, harvested, or reset by the migration.
PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS tree_harvest_settlement_validate;
DROP TRIGGER IF EXISTS tree_harvest_settlement_apply;
DROP TRIGGER IF EXISTS idempotency_tree_plant_requires_tree;
DROP TRIGGER IF EXISTS idempotency_tree_harvest_requires_settlement;
DROP TRIGGER IF EXISTS idempotency_tree_management_requires_tree;
DROP TRIGGER IF EXISTS tree_instance_requires_free_of_crop;
DROP TRIGGER IF EXISTS tree_instance_update_requires_free_of_crop;
DROP TRIGGER IF EXISTS crop_instance_requires_free_of_tree;
DROP TRIGGER IF EXISTS farm_construction_requires_free_of_tree;
DROP TRIGGER IF EXISTS farm_construction_update_requires_free_of_tree;
DROP TRIGGER IF EXISTS tree_instance_requires_free_of_construction;
DROP INDEX IF EXISTS idx_tree_instances_farm_id;
DROP INDEX IF EXISTS idx_tree_instances_farm_yx;

ALTER TABLE tree_instances RENAME TO tree_instances_legacy;

CREATE TABLE tree_instances (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'treeinst_*'),
  farm_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN -1000000 AND 1000000),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN -1000000 AND 1000000),
  tree_definition_id TEXT NOT NULL CHECK (tree_definition_id GLOB 'tree_*'),
  planted_by_player_id TEXT NOT NULL,
  planted_at TEXT NOT NULL,
  last_harvested_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  storage_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (storage_state IN ('ACTIVE', 'STORED')),
  rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation BETWEEN 0 AND 3),
  stored_at TEXT,
  stored_remaining_seconds INTEGER CHECK (stored_remaining_seconds IS NULL OR stored_remaining_seconds >= 0),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (planted_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO tree_instances (
  id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at,
  last_harvested_at, version, created_at, updated_at, storage_state, rotation, stored_at,
  stored_remaining_seconds
)
SELECT
  id, farm_id, tile_x, tile_y, tree_definition_id, planted_by_player_id, planted_at,
  last_harvested_at, version, created_at, updated_at, 'ACTIVE', 0, NULL, NULL
FROM tree_instances_legacy;

DROP TABLE tree_instances_legacy;

CREATE UNIQUE INDEX idx_tree_instances_active_tile
  ON tree_instances(farm_id, tile_x, tile_y)
  WHERE storage_state = 'ACTIVE';
CREATE INDEX idx_tree_instances_farm_id ON tree_instances(farm_id);
CREATE INDEX idx_tree_instances_farm_yx
  ON tree_instances(
    farm_id, tile_y, tile_x, id, tree_definition_id, planted_by_player_id, planted_at,
    last_harvested_at, version, created_at, updated_at, storage_state, rotation, stored_at,
    stored_remaining_seconds
  );

-- Harvest remains server-authoritative and a stored tree cannot be harvested remotely.
CREATE TRIGGER tree_harvest_settlement_validate
BEFORE INSERT ON tree_harvest_settlements
WHEN
  NOT EXISTS (
    SELECT 1 FROM farm_members
    WHERE farm_id = NEW.farm_id AND player_id = NEW.actor_player_id AND role = 'OWNER'
  )
  OR NOT EXISTS (
    SELECT 1 FROM tree_instances
    WHERE id = NEW.tree_instance_id
      AND farm_id = NEW.farm_id
      AND version = NEW.tree_version
      AND tree_definition_id = NEW.tree_definition_id
      AND storage_state = 'ACTIVE'
  )
  OR COALESCE((
    SELECT quantity FROM inventory_items
    WHERE player_id = NEW.actor_player_id AND item_definition_id = NEW.item_definition_id
  ), 0) > NEW.max_quantity - NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'invalid tree harvest settlement');
END;

CREATE TRIGGER tree_harvest_settlement_apply
AFTER INSERT ON tree_harvest_settlements
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  VALUES (NEW.actor_player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1)
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;

  UPDATE tree_instances
  SET last_harvested_at = NEW.created_at, version = version + 1, updated_at = NEW.created_at,
      stored_remaining_seconds = NULL
  WHERE id = NEW.tree_instance_id AND farm_id = NEW.farm_id AND version = NEW.tree_version
    AND storage_state = 'ACTIVE';
END;

CREATE TRIGGER idempotency_tree_plant_requires_tree
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLANT_TREE'
  AND (
    NEW.status <> 'COMPLETED' OR NEW.resource_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM tree_instances WHERE id = NEW.resource_id AND planted_by_player_id = NEW.actor_player_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'completed tree plant idempotency requires actor-owned tree');
END;

CREATE TRIGGER idempotency_tree_harvest_requires_settlement
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'HARVEST_TREE'
  AND (
    NEW.status <> 'COMPLETED' OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tree_harvest_settlements
      WHERE actor_player_id = NEW.actor_player_id AND operation = NEW.operation
        AND request_id = NEW.request_id AND tree_instance_id = NEW.resource_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed tree harvest idempotency requires settlement');
END;

CREATE TRIGGER idempotency_tree_management_requires_tree
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation IN ('MOVE_TREE', 'ROTATE_TREE', 'STORE_TREE', 'RESTORE_TREE')
  AND (
    NEW.status <> 'COMPLETED' OR NEW.resource_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM tree_instances WHERE id = NEW.resource_id AND planted_by_player_id = NEW.actor_player_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'completed tree management idempotency requires actor-owned tree');
END;

-- Active trees cannot share a crop cell. Stored trees are deliberately excluded from occupancy.
CREATE TRIGGER tree_instance_requires_free_of_crop
BEFORE INSERT ON tree_instances
WHEN NEW.storage_state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM crop_instances WHERE farm_id = NEW.farm_id AND tile_x = NEW.tile_x AND tile_y = NEW.tile_y
)
BEGIN SELECT RAISE(ABORT, 'tile already holds a crop'); END;

CREATE TRIGGER tree_instance_update_requires_free_of_crop
BEFORE UPDATE OF farm_id, tile_x, tile_y, storage_state ON tree_instances
WHEN NEW.storage_state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM crop_instances WHERE farm_id = NEW.farm_id AND tile_x = NEW.tile_x AND tile_y = NEW.tile_y
)
BEGIN SELECT RAISE(ABORT, 'tile already holds a crop'); END;

CREATE TRIGGER crop_instance_requires_free_of_tree
BEFORE INSERT ON crop_instances
WHEN EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id AND storage_state = 'ACTIVE'
    AND tile_x = NEW.tile_x AND tile_y = NEW.tile_y
)
BEGIN SELECT RAISE(ABORT, 'tile already holds a tree'); END;

-- Construction collision checks are the same as 0012/0013, with stored trees ignored.
CREATE TRIGGER farm_construction_requires_free_of_tree
BEFORE INSERT ON farm_constructions
WHEN NEW.state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id AND storage_state = 'ACTIVE'
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN SELECT RAISE(ABORT, 'construction cells hold a tree'); END;

CREATE TRIGGER farm_construction_update_requires_free_of_tree
BEFORE UPDATE ON farm_constructions
WHEN NEW.state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id AND storage_state = 'ACTIVE'
    AND tile_x BETWEEN NEW.min_x AND NEW.max_x AND tile_y BETWEEN NEW.min_y AND NEW.max_y
)
BEGIN SELECT RAISE(ABORT, 'construction cells hold a tree'); END;

CREATE TRIGGER tree_instance_requires_free_of_construction
BEFORE INSERT ON tree_instances
WHEN NEW.storage_state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM farm_constructions
  WHERE farm_id = NEW.farm_id AND state = 'ACTIVE'
    AND NEW.tile_x BETWEEN min_x AND max_x AND NEW.tile_y BETWEEN min_y AND max_y
)
BEGIN SELECT RAISE(ABORT, 'tile holds a construction'); END;

CREATE TRIGGER tree_instance_update_requires_free_of_construction
BEFORE UPDATE OF farm_id, tile_x, tile_y, storage_state ON tree_instances
WHEN NEW.storage_state = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM farm_constructions
  WHERE farm_id = NEW.farm_id AND state = 'ACTIVE'
    AND NEW.tile_x BETWEEN min_x AND max_x AND NEW.tile_y BETWEEN min_y AND max_y
)
BEGIN SELECT RAISE(ABORT, 'tile holds a construction'); END;
