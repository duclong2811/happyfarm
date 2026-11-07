-- V16.2.3D3B: the first manual aquaculture cycle.
--
-- A pond is an existing player construction (`place_fish_cage`). This table stores only the
-- lifecycle state that construction rows do not own: one supported fish, its authoritative server
-- timestamps, and a revision. No timer or repeating production row is introduced.
PRAGMA foreign_keys = ON;

CREATE TABLE aquaculture_pond_states (
  construction_id TEXT PRIMARY KEY NOT NULL CHECK (construction_id GLOB 'construct_*'),
  farm_id TEXT NOT NULL,
  item_definition_id TEXT,
  stocked_at TEXT,
  ready_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  CHECK ((item_definition_id IS NULL AND stocked_at IS NULL AND ready_at IS NULL)
      OR (item_definition_id IS NOT NULL AND stocked_at IS NOT NULL AND ready_at IS NOT NULL)),
  FOREIGN KEY (construction_id) REFERENCES farm_constructions(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_aquaculture_pond_states_farm_id ON aquaculture_pond_states(farm_id);

CREATE TABLE aquaculture_harvest_settlements (
  actor_player_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation = 'HARVEST_AQUACULTURE_POND'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  farm_id TEXT NOT NULL,
  construction_id TEXT NOT NULL CHECK (construction_id GLOB 'construct_*'),
  pond_version INTEGER NOT NULL CHECK (pond_version >= 1),
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity = 1),
  max_quantity INTEGER NOT NULL CHECK (max_quantity BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_player_id, operation, request_id),
  UNIQUE (construction_id, pond_version),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_aquaculture_harvest_settlements_farm_id ON aquaculture_harvest_settlements(farm_id);

-- The database repeats the important authority checks so a direct or racing write cannot mint a fish
-- from a different construction, farm, or pond revision. Editors are allowed exactly as they are for
-- the existing construction edit path.
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

-- The warehouse trigger on inventory_items is the capacity authority. If it rejects this insert, the
-- settlement and state transition roll back together and the pond remains READY.
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

