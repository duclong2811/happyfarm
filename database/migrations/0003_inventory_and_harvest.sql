-- Inventory is player-owned authoritative state. Harvest settlements are immutable mutation receipts.
PRAGMA foreign_keys = ON;

CREATE TABLE inventory_items (
  player_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 0 AND 2147483647),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (player_id, item_definition_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE harvest_settlements (
  actor_player_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation = 'HARVEST_CROP'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  farm_id TEXT NOT NULL,
  crop_instance_id TEXT NOT NULL CHECK (crop_instance_id GLOB 'cropinst_*'),
  crop_version INTEGER NOT NULL CHECK (crop_version >= 1),
  crop_definition_id TEXT NOT NULL CHECK (crop_definition_id GLOB 'crop_*'),
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 2147483647),
  max_quantity INTEGER NOT NULL CHECK (max_quantity BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_player_id, operation, request_id),
  UNIQUE (operation, crop_instance_id),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_harvest_settlements_farm_id ON harvest_settlements(farm_id);

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
  OR COALESCE((
    SELECT quantity FROM inventory_items
    WHERE player_id = NEW.actor_player_id
      AND item_definition_id = NEW.item_definition_id
  ), 0) > NEW.max_quantity - NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'invalid harvest settlement');
END;

CREATE TRIGGER harvest_settlement_apply
AFTER INSERT ON harvest_settlements
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  VALUES (NEW.actor_player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1)
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;

  DELETE FROM crop_instances
  WHERE id = NEW.crop_instance_id
    AND farm_id = NEW.farm_id
    AND version = NEW.crop_version;
END;

CREATE TRIGGER idempotency_harvest_requires_settlement
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'HARVEST_CROP'
  AND (
    NEW.status <> 'COMPLETED'
    OR NEW.resource_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM harvest_settlements
      WHERE actor_player_id = NEW.actor_player_id
        AND operation = NEW.operation
        AND request_id = NEW.request_id
        AND crop_instance_id = NEW.resource_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'completed harvest idempotency requires settlement');
END;
