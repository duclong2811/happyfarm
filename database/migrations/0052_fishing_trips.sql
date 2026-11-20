-- Fishing trips (docs/design/FLEET.md, F2).
--
-- A fishing boat at its dock sails to a ground and comes back by the server's clock. The row is the
-- trip: when it left, when it is back, and the catch the server rolled when it left (a JSON object of
-- item id to count, never sent by a client). It exists while the boat is out or back with its catch
-- uncollected; collecting the catch (into the warehouse, in one batch with its receipt) or calling the
-- boat home early deletes it. One trip a ship.
--
-- The ship is the player's own by its id (the player's uuid, with the berth); there is no foreign key
-- to `player_ships` because the dock's lent rowboat, which has no row, can fish too.
PRAGMA foreign_keys = ON;

CREATE TABLE ship_trips (
  ship_id TEXT PRIMARY KEY NOT NULL CHECK (ship_id GLOB 'ship_*'),
  player_id TEXT NOT NULL,
  ground_id TEXT NOT NULL CHECK (ground_id GLOB 'ground_*'),
  departed_at TEXT NOT NULL,
  returns_at TEXT NOT NULL CHECK (returns_at >= departed_at),
  catch_json TEXT NOT NULL CHECK (length(catch_json) BETWEEN 2 AND 2000),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX ship_trips_player ON ship_trips (player_id);
