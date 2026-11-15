-- How a player appears: the character they chose. Cosmetic, one row per player, written only by the
-- player themselves through the appearance route. A player with no row appears as the default
-- character - the id is validated against game data by the application, not by a CHECK, so the roster
-- can grow without a migration.
CREATE TABLE IF NOT EXISTS player_appearance (
  player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL
);
