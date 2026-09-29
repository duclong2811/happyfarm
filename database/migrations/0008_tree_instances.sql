-- Trees: the first repeating producer.
--
-- A tree is a second occupant of the same land, not a variant of a crop. It is planted on one tile,
-- it keeps bearing fruit on a regrow cycle for as long as it stands, and harvesting it does not
-- remove it. That is why it gets a table of its own rather than a nullable column on
-- `crop_instances`: that table carries `UNIQUE(farm_id, tile_x, tile_y)` for one-shot crops and
-- `harvest_settlements` deletes its crop when it settles, so extending either would mean rewriting
-- the crop path that already runs in production instead of adding beside it.
--
-- Two invariants are enforced here rather than only in the application:
--
--   1. One tile holds at most one occupant, crop or tree. Each table already prevents two of its own
--      rows on a tile; the two triggers below extend that across tables in both directions, so
--      neither `crop_instances` nor `tree_instances` has to be rewritten to make it true.
--   2. One harvest cycle pays at most once. A cycle is identified by the tree version it started
--      from, so `UNIQUE(tree_instance_id, tree_version)` *is* the receipt for that cycle, and the
--      apply trigger advances the version only for the row it matched. A tree is never deleted, so
--      "one settlement per crop" becomes "one settlement per cycle".
--
-- Only `planted_at`, `last_harvested_at`, and `version` carry lifecycle state. Ready state, phase,
-- remaining time, and growth stage are derived from those plus the definition's durations, so a
-- definition change re-derives consistently instead of stranding a cached answer.
PRAGMA foreign_keys = ON;

CREATE TABLE tree_instances (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'treeinst_*'),
  farm_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN -1000000 AND 1000000),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN -1000000 AND 1000000),
  tree_definition_id TEXT NOT NULL CHECK (tree_definition_id GLOB 'tree_*'),
  planted_by_player_id TEXT NOT NULL,
  planted_at TEXT NOT NULL,
  -- Null until the first harvest: the only persisted difference between first growth and regrowth.
  last_harvested_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (farm_id, tile_x, tile_y),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id, tile_x, tile_y) REFERENCES farm_tiles(farm_id, x, y) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (planted_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_tree_instances_farm_id ON tree_instances(farm_id);

CREATE TABLE tree_harvest_settlements (
  actor_player_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation = 'HARVEST_TREE'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  farm_id TEXT NOT NULL,
  tree_instance_id TEXT NOT NULL CHECK (tree_instance_id GLOB 'treeinst_*'),
  -- The version the tree had *before* this harvest. Together with the id it names the cycle.
  tree_version INTEGER NOT NULL CHECK (tree_version >= 1),
  tree_definition_id TEXT NOT NULL CHECK (tree_definition_id GLOB 'tree_*'),
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 2147483647),
  max_quantity INTEGER NOT NULL CHECK (max_quantity BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_player_id, operation, request_id),
  UNIQUE (tree_instance_id, tree_version),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_tree_harvest_settlements_farm_id ON tree_harvest_settlements(farm_id);

-- The same three refusals the crop settlement makes: the actor owns the farm, the tree is exactly at
-- the revision the caller read, and the reward still fits the player's stack.
CREATE TRIGGER tree_harvest_settlement_validate
BEFORE INSERT ON tree_harvest_settlements
WHEN
  NOT EXISTS (
    SELECT 1 FROM farm_members
    WHERE farm_id = NEW.farm_id
      AND player_id = NEW.actor_player_id
      AND role = 'OWNER'
  )
  OR NOT EXISTS (
    SELECT 1 FROM tree_instances
    WHERE id = NEW.tree_instance_id
      AND farm_id = NEW.farm_id
      AND version = NEW.tree_version
      AND tree_definition_id = NEW.tree_definition_id
  )
  OR COALESCE((
    SELECT quantity FROM inventory_items
    WHERE player_id = NEW.actor_player_id
      AND item_definition_id = NEW.item_definition_id
  ), 0) > NEW.max_quantity - NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'invalid tree harvest settlement');
END;

-- Pays the fruit and advances the cycle as one statement pair. The tree survives; only its harvest
-- anchor and revision move, and they move only for the revision this settlement was written against.
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
  SET last_harvested_at = NEW.created_at,
      version = version + 1,
      updated_at = NEW.created_at
  WHERE id = NEW.tree_instance_id
    AND farm_id = NEW.farm_id
    AND version = NEW.tree_version;
END;

-- Receipts cannot commit without the mutation they describe, exactly as crops require. Planting keeps
-- its tree; harvesting keeps its cycle's settlement.
CREATE TRIGGER idempotency_tree_plant_requires_tree
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLANT_TREE'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tree_instances
      WHERE id = NEW.resource_id
        AND planted_by_player_id = NEW.actor_player_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed tree plant idempotency requires actor-owned tree');
END;

CREATE TRIGGER idempotency_tree_harvest_requires_settlement
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'HARVEST_TREE'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tree_harvest_settlements
      WHERE actor_player_id = NEW.actor_player_id
        AND operation = NEW.operation
        AND request_id = NEW.request_id
        AND tree_instance_id = NEW.resource_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed tree harvest idempotency requires settlement');
END;

-- Cross-occupancy, in both directions. Neither table can see the other, so each insert checks the
-- other table. A crop and a tree can therefore never share a tile, however the two requests are
-- interleaved: whichever batch lands second sees the first row and aborts as a whole.
CREATE TRIGGER tree_instance_requires_free_of_crop
BEFORE INSERT ON tree_instances
WHEN EXISTS (
  SELECT 1 FROM crop_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x = NEW.tile_x
    AND tile_y = NEW.tile_y
)
BEGIN
  SELECT RAISE(ABORT, 'tile already holds a crop');
END;

CREATE TRIGGER crop_instance_requires_free_of_tree
BEFORE INSERT ON crop_instances
WHEN EXISTS (
  SELECT 1 FROM tree_instances
  WHERE farm_id = NEW.farm_id
    AND tile_x = NEW.tile_x
    AND tile_y = NEW.tile_y
)
BEGIN
  SELECT RAISE(ABORT, 'tile already holds a tree');
END;
