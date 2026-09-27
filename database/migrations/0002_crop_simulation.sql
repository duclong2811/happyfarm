-- Crop occupancy is canonical in crop_instances; farm_tiles does not duplicate crop identity.
PRAGMA foreign_keys = ON;

CREATE TABLE crop_instances (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'cropinst_*'),
  farm_id TEXT NOT NULL,
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN -1000000 AND 1000000),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN -1000000 AND 1000000),
  crop_definition_id TEXT NOT NULL CHECK (crop_definition_id GLOB 'crop_*'),
  planted_by_player_id TEXT NOT NULL,
  planted_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (farm_id, tile_x, tile_y),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id, tile_x, tile_y) REFERENCES farm_tiles(farm_id, x, y) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (planted_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_crop_instances_farm_id ON crop_instances(farm_id);

CREATE TABLE idempotency_keys (
  actor_player_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 64),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  resource_id TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_player_id, operation, request_id),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys(created_at);

-- A successful plant idempotency result cannot commit unless its crop was inserted in the same transaction.
CREATE TRIGGER idempotency_plant_requires_crop
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLANT_CROP'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM crop_instances
      WHERE id = NEW.resource_id
        AND planted_by_player_id = NEW.actor_player_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed plant idempotency requires actor-owned crop');
END;
