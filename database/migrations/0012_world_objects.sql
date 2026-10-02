-- V13.3: the starter island becomes editable objects.
--
-- `farm_constructions` stops being only "things a player bought" and becomes the one table of active
-- world objects, with provenance, a cost basis, an optional starter identity and a second state
-- (`ACTIVE` / `STORED`). The table is rebuilt rather than extended because SQLite CHECK constraints
-- are part of the table and `state` has to admit a second value - the same reason 0006, 0009, 0010 and
-- 0011 rebuilt `economy_ledger`.
--
-- Four rules carry over and one is new:
--   * every existing row becomes an ordinary player-placed object, with its catalogue charge as its
--     cost basis, so V13.2 data keeps working and keeps its refund behaviour;
--   * a **stored** object occupies no ground: the ownership, overlap and crop/tree triggers only
--     apply to `ACTIVE` rows;
--   * a starter object has a `placement_key`, unique per farm, which is what makes seeding idempotent;
--   * `paid_amount` is the cost basis. A starter object paid for by nobody can refund nothing, which
--     is the exploit this column exists to make impossible.
PRAGMA foreign_keys = ON;

-- Which version of the starter arrangement a farm has been given. Additive: a later version seeds
-- only what it adds, and never touches an object the player has already moved.
ALTER TABLE farms ADD COLUMN starter_world_version INTEGER NOT NULL DEFAULT 0
  CHECK (starter_world_version >= 0);

CREATE TABLE farm_constructions_rebuilt (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'construct_*'),
  farm_id TEXT NOT NULL,
  catalogue_entry_id TEXT NOT NULL CHECK (length(catalogue_entry_id) BETWEEN 3 AND 80),
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
  cell_count INTEGER NOT NULL CHECK (cell_count BETWEEN 1 AND 4096),
  /* ACTIVE objects stand on the island; STORED ones are held in the player's storage. */
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'STORED')),
  owner_player_id TEXT NOT NULL,
  /* Provenance: where the object came from. It never decides what may be done to it. */
  source TEXT NOT NULL CHECK (source IN ('STARTER', 'PLAYER_PLACED')),
  /* A starter placement's stable identity, unique per farm; null for anything a player built. */
  placement_key TEXT CHECK (placement_key IS NULL OR length(placement_key) BETWEEN 3 AND 80),
  /* The cost basis: what this object actually cost its owner. Refunds are a share of this. */
  paid_amount INTEGER NOT NULL CHECK (paid_amount BETWEEN 0 AND 9007199254740991),
  cost_amount INTEGER NOT NULL CHECK (cost_amount BETWEEN 0 AND 9007199254740991),
  cost_currency_id TEXT NOT NULL CHECK (cost_currency_id GLOB 'currency_*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stored_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (max_x = min_x + footprint_width - 1),
  CHECK (max_y = min_y + footprint_depth - 1),
  CHECK (cell_count = footprint_width * footprint_depth),
  /* Only a starter object carries a placement key, and only a stored object carries a stored_at. */
  CHECK (placement_key IS NULL OR source = 'STARTER'),
  CHECK ((state = 'STORED') = (stored_at IS NOT NULL)),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (owner_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO farm_constructions_rebuilt (
  id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation,
  footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count,
  state, owner_player_id, source, placement_key, paid_amount, cost_amount, cost_currency_id,
  created_at, updated_at, stored_at, version
)
SELECT
  id, farm_id, catalogue_entry_id, category, anchor_x, anchor_y, rotation,
  footprint_width, footprint_depth, min_x, max_x, min_y, max_y, cell_count,
  -- Read from the table as it stands (its column is still `built_by_player_id`), written as the
  -- universal object's owner: an object belongs to whoever owns it, whatever built it.
  'ACTIVE', built_by_player_id, 'PLAYER_PLACED', NULL, cost_amount, cost_amount, cost_currency_id,
  created_at, updated_at, NULL, version
FROM farm_constructions;

DROP TRIGGER IF EXISTS farm_construction_requires_owned_cells;
DROP TRIGGER IF EXISTS farm_construction_requires_free_cells;
DROP TRIGGER IF EXISTS farm_construction_requires_free_of_crop;
DROP TRIGGER IF EXISTS farm_construction_requires_free_of_tree;
DROP TRIGGER IF EXISTS farm_construction_update_requires_owned_cells;
DROP TRIGGER IF EXISTS farm_construction_update_requires_free_cells;
DROP TRIGGER IF EXISTS farm_construction_update_requires_free_of_crop;
DROP TRIGGER IF EXISTS farm_construction_update_requires_free_of_tree;
DROP TRIGGER IF EXISTS crop_instance_requires_free_of_construction;
DROP TRIGGER IF EXISTS tree_instance_requires_free_of_construction;
DROP TRIGGER IF EXISTS idempotency_construction_requires_construction;
DROP TRIGGER IF EXISTS idempotency_construction_edit_requires_construction;
DROP TRIGGER IF EXISTS idempotency_construction_remove_requires_effect;

DROP TABLE farm_constructions;
ALTER TABLE farm_constructions_rebuilt RENAME TO farm_constructions;

CREATE INDEX idx_farm_constructions_farm_id ON farm_constructions(farm_id);
CREATE INDEX idx_farm_constructions_bounds ON farm_constructions(farm_id, min_x, max_x, min_y, max_y);
-- One starter object per placement per farm: the idempotency key of the whole seeding pass.
CREATE UNIQUE INDEX idx_farm_constructions_placement_key
  ON farm_constructions(farm_id, placement_key)
  WHERE placement_key IS NOT NULL;

-- The cells a placement asks for must all be owned - for an object that is *standing* on the island.
CREATE TRIGGER farm_construction_requires_owned_cells
BEFORE INSERT ON farm_constructions
WHEN NEW.state = 'ACTIVE' AND NEW.source = 'PLAYER_PLACED'
  AND (
    SELECT COUNT(*) FROM farm_tiles
    WHERE farm_id = NEW.farm_id
      AND x BETWEEN NEW.min_x AND NEW.max_x
      AND y BETWEEN NEW.min_y AND NEW.max_y
  ) <> NEW.cell_count
BEGIN
  SELECT RAISE(ABORT, 'construction cells are not owned');
END;

-- Nothing already stands there.
CREATE TRIGGER farm_construction_requires_free_cells
BEFORE INSERT ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM farm_constructions AS other
    WHERE other.farm_id = NEW.farm_id
      AND other.state = 'ACTIVE'
      AND NEW.min_x <= other.max_x
      AND NEW.max_x >= other.min_x
      AND NEW.min_y <= other.max_y
      AND NEW.max_y >= other.min_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;

CREATE TRIGGER farm_construction_requires_free_of_crop
BEFORE INSERT ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
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
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM tree_instances
    WHERE farm_id = NEW.farm_id
      AND tile_x BETWEEN NEW.min_x AND NEW.max_x
      AND tile_y BETWEEN NEW.min_y AND NEW.max_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a tree');
END;

-- The same rules on the way in again: a move, a turn or a restore is an UPDATE, and a stored object
-- is not standing on anything, so it may be moved anywhere its owner likes.
CREATE TRIGGER farm_construction_update_requires_owned_cells
BEFORE UPDATE ON farm_constructions
WHEN NEW.state = 'ACTIVE' AND NEW.source = 'PLAYER_PLACED'
  AND (
    SELECT COUNT(*) FROM farm_tiles
    WHERE farm_id = NEW.farm_id
      AND x BETWEEN NEW.min_x AND NEW.max_x
      AND y BETWEEN NEW.min_y AND NEW.max_y
  ) <> NEW.cell_count
BEGIN
  SELECT RAISE(ABORT, 'construction cells are not owned');
END;

CREATE TRIGGER farm_construction_update_requires_free_cells
BEFORE UPDATE ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM farm_constructions AS other
    WHERE other.farm_id = NEW.farm_id
      AND other.state = 'ACTIVE'
      AND other.id <> NEW.id
      AND NEW.min_x <= other.max_x
      AND NEW.max_x >= other.min_x
      AND NEW.min_y <= other.max_y
      AND NEW.max_y >= other.min_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;

CREATE TRIGGER farm_construction_update_requires_free_of_crop
BEFORE UPDATE ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
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
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM tree_instances
    WHERE farm_id = NEW.farm_id
      AND tile_x BETWEEN NEW.min_x AND NEW.max_x
      AND tile_y BETWEEN NEW.min_y AND NEW.max_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells hold a tree');
END;

-- A crop or a tree may not be planted under an object that is standing on the island.
CREATE TRIGGER crop_instance_requires_free_of_construction
BEFORE INSERT ON crop_instances
WHEN EXISTS (
  SELECT 1 FROM farm_constructions
  WHERE farm_id = NEW.farm_id
    AND state = 'ACTIVE'
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
    AND state = 'ACTIVE'
    AND NEW.tile_x BETWEEN min_x AND max_x
    AND NEW.tile_y BETWEEN min_y AND max_y
)
BEGIN
  SELECT RAISE(ABORT, 'tile holds a construction');
END;

-- A placement receipt may never commit without the construction it claims to have built.
CREATE TRIGGER idempotency_construction_requires_construction
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLACE_CONSTRUCTION'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM farm_constructions
      WHERE id = NEW.resource_id
        AND owner_player_id = NEW.actor_player_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed construction idempotency requires its construction');
END;

-- A move or a turn: the row must exist, have been written by this batch, and be the actor's to edit.
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

-- Storing and restoring are edits too, and the same argument holds: the row must carry this batch's
-- timestamp, so a receipt cannot claim a change the UPDATE never made.
CREATE TRIGGER idempotency_construction_state_requires_construction
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation IN ('STORE_CONSTRUCTION', 'RESTORE_CONSTRUCTION')
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
  SELECT RAISE(ABORT, 'completed construction state idempotency requires its change');
END;

-- A removal: the object must be gone, and when the receipt points at a refund that refund must exist
-- in the actor's own name.
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
