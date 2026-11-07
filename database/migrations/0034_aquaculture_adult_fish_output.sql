-- Aquaculture output split: stocked fingerlings remain item_fish_tilapia; a ready harvest is
-- item_fish_tilapia_adult. This is a trigger-only compatibility migration; it does not rewrite any
-- inventory, pond cohort, or historical settlement row.
PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS aquaculture_harvest_validate;
DROP TRIGGER IF EXISTS aquaculture_pond_settlement_validate;

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
      AND pond.item_definition_id = 'item_fish_tilapia'
      AND pond.ready_at <= NEW.created_at
      AND construction.farm_id = NEW.farm_id
      AND construction.catalogue_entry_id = 'place_fish_cage'
      AND construction.state = 'ACTIVE'
  )
  OR NEW.item_definition_id <> 'item_fish_tilapia_adult'
  OR COALESCE((
    SELECT quantity FROM inventory_items
    WHERE player_id = NEW.actor_player_id
      AND item_definition_id = NEW.item_definition_id
  ), 0) > NEW.max_quantity - NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'invalid aquaculture harvest settlement');
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
    AND (
      NEW.item_definition_id <> 'item_fish_tilapia_adult'
      OR COALESCE((SELECT SUM(quantity) FROM aquaculture_pond_cohorts
                   WHERE construction_id = NEW.construction_id AND farm_id = NEW.farm_id
                     AND item_definition_id = 'item_fish_tilapia'
                     AND ready_at <= NEW.created_at), 0) < NEW.quantity
    )
  )
  OR (
    NEW.operation = 'WITHDRAW_AQUACULTURE_POND'
    AND (
      NEW.item_definition_id <> 'item_fish_tilapia'
      OR COALESCE((SELECT SUM(quantity) FROM aquaculture_pond_cohorts
                   WHERE construction_id = NEW.construction_id AND farm_id = NEW.farm_id
                     AND item_definition_id = 'item_fish_tilapia'
                     AND ready_at > NEW.created_at), 0) < NEW.quantity
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid aquaculture pond settlement');
END;
