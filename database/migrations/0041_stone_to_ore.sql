-- Stone is retired: ore is the one mining material (warehouse upgrades now take wood and ore).
-- Each player's stone moves 1:1 into ore, so no one loses what they had gathered.
--
-- Order matters because of the warehouse capacity guard on inventory_items: stone is first set to
-- zero (a shrink never trips the guard), then the same quantity is added to ore, so a player's total
-- never rises above where it was. A grandfathered player already over capacity is skipped - growing
-- any row would trip the guard and abort the whole migration - and simply keeps their stone, which
-- still sells.
CREATE TABLE migration_0041_stone (
  player_id TEXT PRIMARY KEY NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

INSERT INTO migration_0041_stone (player_id, quantity)
SELECT stone.player_id, stone.quantity
FROM inventory_items AS stone
WHERE stone.item_definition_id = 'item_stone'
  AND stone.quantity > 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE player_id = stone.player_id)
      <= COALESCE((SELECT capacity FROM home_island_warehouses WHERE owner_player_id = stone.player_id), 1000);

UPDATE inventory_items
SET quantity = 0,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE item_definition_id = 'item_stone'
  AND player_id IN (SELECT player_id FROM migration_0041_stone);

INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
SELECT player_id, 'item_ore', quantity, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1
FROM migration_0041_stone
WHERE true
ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
  quantity = inventory_items.quantity + excluded.quantity,
  version = inventory_items.version + 1,
  updated_at = excluded.updated_at;

DELETE FROM inventory_items
WHERE item_definition_id = 'item_stone'
  AND quantity = 0
  AND player_id IN (SELECT player_id FROM migration_0041_stone);

DROP TABLE migration_0041_stone;
