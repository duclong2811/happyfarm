-- Seed economy: the one-time starter grant receipt.
--
-- Planting now costs a seed, and every new player is given 36 carrot seeds exactly once. The
-- "exactly once" is not enforced by the caller: it is the primary key of this table. The grant is
-- scoped to the player, not to a farm or a session, so creating a second farm, calling bootstrap
-- again, or replaying a stored request all find the receipt already present and credit nothing.
--
-- The receipt is also the command. `starter_seed_grant_apply` credits the inventory in the same
-- statement that writes the receipt, so there is no window in which a player has the seeds without
-- the record of having received them, or the record without the seeds. Inventory rows keep their own
-- 0..2147483647 bounds, so an impossible grant aborts the insert rather than overflowing a stack.
--
-- No other schema changes: seed and produce are both `inventory_items` rows, and the shop's prices
-- live in game data, not in a table.
PRAGMA foreign_keys = ON;

CREATE TABLE starter_seed_grants (
  player_id TEXT PRIMARY KEY NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 2147483647),
  created_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER starter_seed_grant_apply
AFTER INSERT ON starter_seed_grants
BEGIN
  INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version)
  VALUES (NEW.player_id, NEW.item_definition_id, NEW.quantity, NEW.created_at, 1)
  ON CONFLICT(player_id, item_definition_id) DO UPDATE SET
    quantity = inventory_items.quantity + excluded.quantity,
    updated_at = excluded.updated_at,
    version = inventory_items.version + 1;
END;
