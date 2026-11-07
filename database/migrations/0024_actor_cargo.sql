-- Actor cargo: the goods an actor is physically carrying (V16.2.2C).
--
-- A **separate container** from the Home Warehouse, not a re-reading of it. `inventory_items` is what
-- is stored; this table is what is carried. Nothing here moves existing stock: every inventory row
-- that exists today stays warehouse stock, and the transfer between the two containers is an explicit
-- authoritative command.
--
-- Capacity lives on the actor row, exactly as a warehouse's capacity lives on its own row, so a
-- backpack, an equipment upgrade, a cart or a ship is a different number for the same code. The
-- starter value comes from game data (`STARTER_CARGO_CAPACITY`) and balancing it is provisional.
--
-- `cargo_version` is the cargo container's *own* version, separate from the actor's configuration
-- version: an unload must not invalidate a concurrent job reorder, and a reorder must not make a
-- cargo read stale. It is bumped by every cargo mutation, which is what makes a stale unload refusable.
--
-- The guard triggers mirror the warehouse's exactly, and for the same reason: capacity is enforced
-- inside whatever transaction writes the row, so no grant path can forget it and no pre-check can be
-- overtaken by a race.
--
-- Comments are line comments with no semicolon - Wrangler's statement splitter needs that.
-- Additive and compatible with every existing save: two columns with defaults, one new table.
PRAGMA foreign_keys = ON;

ALTER TABLE actors ADD COLUMN cargo_capacity INTEGER NOT NULL DEFAULT 30
  CHECK (cargo_capacity BETWEEN 1 AND 1000000000);

ALTER TABLE actors ADD COLUMN cargo_version INTEGER NOT NULL DEFAULT 1
  CHECK (cargo_version >= 1);

-- The marker that makes one transfer provable. A bare version bump is not enough: two transfers from
-- the same version would both compute the same "next" version, so a loser could satisfy a check
-- written by the winner and pay out twice. The guard writes *this request's* id, and every other
-- statement of the batch is scoped to it, so a loser's clause can never match.
ALTER TABLE actors ADD COLUMN cargo_transfer_id TEXT
  CHECK (cargo_transfer_id IS NULL OR length(cargo_transfer_id) BETWEEN 8 AND 100);

CREATE TABLE actor_cargo_items (
  actor_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  -- A carried stack is never empty: a zero row is a row that should have been deleted, and a negative
  -- one is a duplication bug waiting to happen.
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, item_definition_id),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

-- The cargo read: one actor's own rows, in a stable order, already the primary key's own order.
CREATE INDEX idx_actor_cargo_items_actor ON actor_cargo_items(actor_id, item_definition_id);

-- The capacity guard. It runs inside whatever transaction writes the row, so a grant either fits or
-- the whole settlement rolls back. Only a row that *grows* can trip it, so a grandfathered
-- over-capacity actor is never blocked from reading or from unloading what they already carry.
CREATE TRIGGER cargo_capacity_guard_insert
BEFORE INSERT ON actor_cargo_items
WHEN NEW.quantity > 0
  AND COALESCE(
        (SELECT cargo_capacity FROM actors WHERE id = NEW.actor_id),
        0
      ) < (SELECT COALESCE(SUM(quantity), 0) FROM actor_cargo_items WHERE actor_id = NEW.actor_id) + NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'cargo_full');
END;

CREATE TRIGGER cargo_capacity_guard_update
BEFORE UPDATE ON actor_cargo_items
WHEN NEW.quantity > OLD.quantity
  AND COALESCE(
        (SELECT cargo_capacity FROM actors WHERE id = NEW.actor_id),
        0
      ) < (SELECT COALESCE(SUM(quantity), 0) FROM actor_cargo_items WHERE actor_id = NEW.actor_id) - OLD.quantity + NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'cargo_full');
END;
