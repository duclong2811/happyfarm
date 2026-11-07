-- V16.2.2D2: the runtime state online Auto execution needs, and the cargo destination for a harvest.
--
-- Two additive changes, both justified in `docs/qa/V16_2_2D2_RICE_AUTO_VERTICAL.md`:
--
-- 1. `actor_auto_state` holds one row per actor: where the actor *is* (the last anchor the server
--    completed), and - while a walk is under way - where it is going and when it arrives. It exists so
--    the server can refuse a distant action that claims to be somewhere it cannot be, without storing
--    a per-frame position, a path, a waypoint or an event log. Anchor kinds are `WAREHOUSE`, `MARKET`
--    and `CELL`; a cell carries its tile coordinates. `version` is the optimistic guard for the two
--    writers (an arrival and a departure) that can race on one actor.
--
-- 2. `harvest_settlements.destination` says where a harvest's reward lands. `WAREHOUSE` is the
--    existing behaviour and the default, so every historical row and the whole manual path are
--    unchanged. `CARGO` credits the actor's cargo instead, through the same settlement row, the same
--    XP award, the same crop-state validation and the same idempotency receipt - only the destination
--    differs. The capacity authority is the destination's own guard: the warehouse trigger for
--    `WAREHOUSE`, the cargo capacity trigger for `CARGO`.
--
-- Comments are line comments with no semicolon - Wrangler's statement splitter needs that.

PRAGMA foreign_keys = ON;

ALTER TABLE harvest_settlements ADD COLUMN destination TEXT NOT NULL DEFAULT 'WAREHOUSE'
  CHECK (destination IN ('WAREHOUSE', 'CARGO'));

-- Where one actor is, and where it is walking to. NULL anchor means "not known yet", which the
-- executor reads as the Home Warehouse: the one place every actor is guaranteed to be able to reach.
CREATE TABLE actor_auto_state (
  actor_id TEXT PRIMARY KEY,
  anchor_kind TEXT CHECK (anchor_kind IS NULL OR anchor_kind IN ('WAREHOUSE', 'MARKET', 'CELL')),
  anchor_x INTEGER,
  anchor_y INTEGER,
  travel_kind TEXT CHECK (travel_kind IS NULL OR travel_kind IN ('WAREHOUSE', 'MARKET', 'CELL')),
  travel_x INTEGER,
  travel_y INTEGER,
  travel_arrives_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  CHECK (anchor_kind <> 'CELL' OR (anchor_x IS NOT NULL AND anchor_y IS NOT NULL)),
  CHECK (travel_kind <> 'CELL' OR (travel_x IS NOT NULL AND travel_y IS NOT NULL)),
  CHECK (travel_kind IS NULL OR travel_arrives_at IS NOT NULL),
  CHECK (travel_kind IS NOT NULL OR (travel_arrives_at IS NULL AND travel_x IS NULL AND travel_y IS NULL)),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

-- Replaces the two settlement triggers with destination-aware versions. A harvest into cargo must
-- validate exactly what a warehouse harvest validates, plus that the actor exists to carry it.
DROP TRIGGER harvest_settlement_validate;

CREATE TRIGGER harvest_settlement_validate
BEFORE INSERT ON harvest_settlements
WHEN
  NOT EXISTS (
    SELECT 1 FROM farm_members
    WHERE farm_id = NEW.farm_id
      AND player_id = NEW.actor_player_id
      AND role = 'OWNER'
  )
  OR NOT EXISTS (
    SELECT 1 FROM crop_instances
    WHERE id = NEW.crop_instance_id
      AND farm_id = NEW.farm_id
      AND version = NEW.crop_version
      AND crop_definition_id = NEW.crop_definition_id
  )
  OR (
    NEW.destination = 'WAREHOUSE'
    AND COALESCE((
      SELECT quantity FROM inventory_items
      WHERE player_id = NEW.actor_player_id
        AND item_definition_id = NEW.item_definition_id
    ), 0) > NEW.max_quantity - NEW.quantity
  )
  OR (
    NEW.destination = 'CARGO'
    AND NOT EXISTS (
      SELECT 1 FROM actors
      WHERE owner_player_id = NEW.actor_player_id AND kind = 'MAIN_CHARACTER'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid harvest settlement');
END;

DROP TRIGGER harvest_settlement_apply;

CREATE TRIGGER harvest_settlement_apply
AFTER INSERT ON harvest_settlements
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  SELECT NEW.actor_player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1
  WHERE NEW.destination = 'WAREHOUSE'
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;

  INSERT INTO actor_cargo_items (actor_id, item_definition_id, quantity, version, updated_at)
  SELECT a.id, NEW.item_definition_id, NEW.quantity, 1, NEW.created_at
    FROM actors a
   WHERE NEW.destination = 'CARGO'
     AND a.owner_player_id = NEW.actor_player_id
     AND a.kind = 'MAIN_CHARACTER'
  ON CONFLICT(actor_id, item_definition_id) DO UPDATE SET
    quantity = actor_cargo_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = actor_cargo_items.version + 1;

  DELETE FROM crop_instances
  WHERE id = NEW.crop_instance_id
    AND farm_id = NEW.farm_id
    AND version = NEW.crop_version;
END;
