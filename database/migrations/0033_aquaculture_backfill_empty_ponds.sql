-- V16.2.3D3B: make the empty pond revision explicit for legacy fish cages.
--
-- 0031 used version >= 1 because the first persisted row was created by Stock.  An empty cage has
-- a real, persisted header now, but its protocol revision is still 0 so existing clients can stock
-- it with expectedPondVersion=0.  Rebuild the small header table rather than rewriting 0031.
--
-- The copy/drop/rename sequence is deliberately repeatable.  That makes a migration replay in a
-- test or a stopped local apply harmless, while the INSERT below remains strictly non-destructive.
PRAGMA foreign_keys = ON;

-- These triggers reference the header table by name.  Drop and recreate them around the table rebuild
-- so SQLite never leaves a trigger pointing at a table that no longer exists.
DROP TRIGGER IF EXISTS aquaculture_harvest_validate;
DROP TRIGGER IF EXISTS aquaculture_harvest_apply;
DROP TRIGGER IF EXISTS aquaculture_pond_settlement_validate;
DROP TRIGGER IF EXISTS aquaculture_pond_settlement_apply_inventory;

CREATE TABLE IF NOT EXISTS aquaculture_pond_states_v2 (
  construction_id TEXT PRIMARY KEY NOT NULL CHECK (construction_id GLOB 'construct_*'),
  farm_id TEXT NOT NULL,
  item_definition_id TEXT,
  stocked_at TEXT,
  ready_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  CHECK ((item_definition_id IS NULL AND stocked_at IS NULL AND ready_at IS NULL)
      OR (item_definition_id IS NOT NULL AND stocked_at IS NOT NULL AND ready_at IS NOT NULL)),
  FOREIGN KEY (construction_id) REFERENCES farm_constructions(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

INSERT OR IGNORE INTO aquaculture_pond_states_v2 (
  construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at
)
SELECT construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at
FROM aquaculture_pond_states;

DROP TABLE aquaculture_pond_states;
ALTER TABLE aquaculture_pond_states_v2 RENAME TO aquaculture_pond_states;
CREATE INDEX IF NOT EXISTS idx_aquaculture_pond_states_farm_id ON aquaculture_pond_states(farm_id);

CREATE TRIGGER aquaculture_harvest_validate
BEFORE INSERT ON aquaculture_harvest_settlements
WHEN
  NOT EXISTS (
    SELECT 1 FROM farm_members
    WHERE farm_id = NEW.farm_id
      AND player_id = NEW.actor_player_id
      AND role IN ('OWNER', 'EDITOR')
  )
  OR NOT EXISTS (
    SELECT 1
    FROM aquaculture_pond_states AS pond
    JOIN farm_constructions AS construction ON construction.id = pond.construction_id
    WHERE pond.construction_id = NEW.construction_id
      AND pond.farm_id = NEW.farm_id
      AND pond.version = NEW.pond_version
      AND pond.item_definition_id = NEW.item_definition_id
      AND pond.ready_at <= NEW.created_at
      AND construction.farm_id = NEW.farm_id
      AND construction.catalogue_entry_id = 'place_fish_cage'
      AND construction.state = 'ACTIVE'
  )
  OR COALESCE((
    SELECT quantity FROM inventory_items
    WHERE player_id = NEW.actor_player_id
      AND item_definition_id = NEW.item_definition_id
  ), 0) > NEW.max_quantity - NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'invalid aquaculture harvest settlement');
END;

CREATE TRIGGER aquaculture_harvest_apply
AFTER INSERT ON aquaculture_harvest_settlements
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  VALUES (NEW.actor_player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1)
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;

  UPDATE aquaculture_pond_states
  SET item_definition_id = NULL,
      stocked_at = NULL,
      ready_at = NULL,
      version = version + 1,
      updated_at = NEW.created_at
  WHERE construction_id = NEW.construction_id
    AND farm_id = NEW.farm_id
    AND version = NEW.pond_version;
END;

CREATE TRIGGER aquaculture_pond_settlement_validate
BEFORE INSERT ON aquaculture_pond_settlements
WHEN
  NOT EXISTS (
    SELECT 1 FROM farm_members
    WHERE farm_id = NEW.farm_id
      AND player_id = NEW.actor_player_id
      AND role IN ('OWNER', 'EDITOR')
  )
  OR NOT EXISTS (
    SELECT 1
    FROM aquaculture_pond_states AS pond
    JOIN farm_constructions AS construction ON construction.id = pond.construction_id
    WHERE pond.construction_id = NEW.construction_id
      AND pond.farm_id = NEW.farm_id
      AND pond.version = NEW.pond_version
      AND construction.farm_id = NEW.farm_id
      AND construction.catalogue_entry_id = 'place_fish_cage'
      AND construction.state = 'ACTIVE'
  )
  OR (
    NEW.operation = 'HARVEST_AQUACULTURE_POND'
    AND COALESCE((SELECT SUM(quantity) FROM aquaculture_pond_cohorts
                  WHERE construction_id = NEW.construction_id AND item_definition_id = NEW.item_definition_id
                    AND ready_at <= NEW.created_at), 0) < NEW.quantity
  )
  OR (
    NEW.operation = 'WITHDRAW_AQUACULTURE_POND'
    AND COALESCE((SELECT SUM(quantity) FROM aquaculture_pond_cohorts
                  WHERE construction_id = NEW.construction_id AND item_definition_id = NEW.item_definition_id
                    AND ready_at > NEW.created_at), 0) < NEW.quantity
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid aquaculture pond settlement');
END;

CREATE TRIGGER aquaculture_pond_settlement_apply_inventory
AFTER INSERT ON aquaculture_pond_settlements
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  VALUES (NEW.actor_player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1)
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;
END;

-- Only cages with no state, no cohorts, and no settlement/Stock receipt may be classified as EMPTY.
-- A historical Stock/withdraw/harvest signal is intentionally excluded: assigning EMPTY there would
-- destroy the only evidence needed to reconstruct the real state and must be handled explicitly.
INSERT OR IGNORE INTO aquaculture_pond_states (
  construction_id, farm_id, item_definition_id, stocked_at, ready_at, version, updated_at
)
SELECT construction.id, construction.farm_id, NULL, NULL, NULL, 0, construction.updated_at
FROM farm_constructions AS construction
WHERE construction.catalogue_entry_id = 'place_fish_cage'
  AND construction.state IN ('ACTIVE', 'STORED')
  AND NOT EXISTS (
    SELECT 1 FROM aquaculture_pond_states AS pond
    WHERE pond.construction_id = construction.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM aquaculture_pond_cohorts AS cohort
    WHERE cohort.construction_id = construction.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM aquaculture_pond_settlements AS settlement
    WHERE settlement.construction_id = construction.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM aquaculture_harvest_settlements AS settlement
    WHERE settlement.construction_id = construction.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM idempotency_keys AS receipt
    WHERE receipt.resource_id = construction.id
      AND receipt.operation IN (
        'STOCK_AQUACULTURE_POND',
        'WITHDRAW_AQUACULTURE_POND',
        'HARVEST_AQUACULTURE_POND'
      )
  );
