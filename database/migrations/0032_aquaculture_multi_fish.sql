-- Aquaculture multi-fish cohorts.
--
-- 0031 remains readable for old receipts. The cohort table is the new source of truth for fish
-- quantity and timestamps; the existing pond row remains the CAS/version summary attached to the
-- reusable construction.
PRAGMA foreign_keys = ON;

CREATE TABLE aquaculture_pond_cohorts (
  construction_id TEXT NOT NULL CHECK (construction_id GLOB 'construct_*'),
  cohort_id TEXT NOT NULL CHECK (cohort_id GLOB 'cohort_*'),
  farm_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  stocked_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (construction_id, cohort_id),
  FOREIGN KEY (construction_id) REFERENCES farm_constructions(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_aquaculture_pond_cohorts_farm ON aquaculture_pond_cohorts(farm_id, construction_id);
CREATE INDEX idx_aquaculture_pond_cohorts_ready ON aquaculture_pond_cohorts(construction_id, ready_at);

-- A legacy row represents exactly one fish. Its original timestamps and pond version are preserved.
INSERT INTO aquaculture_pond_cohorts (
  construction_id, cohort_id, farm_id, item_definition_id, quantity, stocked_at, ready_at, created_at
)
SELECT construction_id, 'cohort_legacy_' || construction_id, farm_id, item_definition_id, 1,
       stocked_at, ready_at, updated_at
FROM aquaculture_pond_states
WHERE item_definition_id IS NOT NULL
  AND stocked_at IS NOT NULL
  AND ready_at IS NOT NULL;

CREATE TABLE aquaculture_pond_settlements (
  actor_player_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('HARVEST_AQUACULTURE_POND', 'WITHDRAW_AQUACULTURE_POND')),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  farm_id TEXT NOT NULL,
  construction_id TEXT NOT NULL CHECK (construction_id GLOB 'construct_*'),
  pond_version INTEGER NOT NULL CHECK (pond_version >= 1),
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  max_quantity INTEGER NOT NULL CHECK (max_quantity BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_player_id, operation, request_id),
  UNIQUE (construction_id, pond_version),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_aquaculture_pond_settlements_farm ON aquaculture_pond_settlements(farm_id);

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

-- The warehouse trigger is the final capacity authority. A rejected addition rolls back the
-- settlement and every cohort/header mutation in the same D1 batch.
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
