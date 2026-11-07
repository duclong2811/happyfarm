-- V16.2.2D4: finite lease for Main Character Auto control.
-- Existing rows are backfilled below so a pre-lease Main Character cannot retain a 24-hour window.
ALTER TABLE actor_auto_state ADD COLUMN lease_until TEXT;

UPDATE actor_auto_state
SET lease_until = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(simulation_at, updated_at), '+180 seconds')
WHERE lease_until IS NULL;

CREATE TRIGGER idempotency_plant_requires_player_control
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation = 'PLANT_CROP'
  AND EXISTS (
    SELECT 1 FROM actors
    WHERE owner_player_id = NEW.actor_player_id
      AND kind = 'MAIN_CHARACTER'
      AND control_mode = 'AUTO_CONTROLLED'
  )
BEGIN
  SELECT RAISE(ABORT, 'main character is Auto-controlled');
END;

CREATE TRIGGER auto_receipt_requires_live_lease
BEFORE INSERT ON idempotency_keys
WHEN NEW.operation LIKE 'AUTO_%'
  AND NOT EXISTS (
    SELECT 1
    FROM actors a
    JOIN actor_auto_state s ON s.actor_id = a.id
    WHERE a.owner_player_id = NEW.actor_player_id
      AND a.kind = 'MAIN_CHARACTER'
      AND a.control_mode = 'AUTO_CONTROLLED'
      AND (s.lease_until IS NULL OR s.lease_until >= s.simulation_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'Auto lease expired');
END;

CREATE TRIGGER resource_action_requires_player_control
BEFORE INSERT ON resource_actions
WHEN EXISTS (
  SELECT 1 FROM actors
  WHERE owner_player_id = NEW.actor_player_id
    AND kind = 'MAIN_CHARACTER'
    AND control_mode = 'AUTO_CONTROLLED'
)
BEGIN
  SELECT RAISE(ABORT, 'main character is Auto-controlled');
END;

CREATE TRIGGER fishing_action_requires_player_control
BEFORE INSERT ON fishing_actions
WHEN EXISTS (
  SELECT 1 FROM actors
  WHERE owner_player_id = NEW.actor_player_id
    AND kind = 'MAIN_CHARACTER'
    AND control_mode = 'AUTO_CONTROLLED'
)
BEGIN
  SELECT RAISE(ABORT, 'main character is Auto-controlled');
END;

-- Manual Warehouse harvests are production actions too. Auto harvests land in CARGO, so this guard
-- leaves the executor's own settlement path intact while closing the manual-vs-Auto race at INSERT.
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
    AND EXISTS (
      SELECT 1 FROM actors
      WHERE owner_player_id = NEW.actor_player_id
        AND kind = 'MAIN_CHARACTER'
        AND control_mode = 'AUTO_CONTROLLED'
    )
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
