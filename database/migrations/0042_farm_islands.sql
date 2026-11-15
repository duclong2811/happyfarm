-- A farm's chosen Home Island: the template the player picked and the ground the server built from it.
--
-- Additive. Farms created before island choice have no row and keep the hand-composed island; a farm
-- created with a chosen island gets exactly one row, written in the same batch as the farm itself.
-- The ground is stored rather than re-generated so a later generator change can never move water
-- under a player's crops. There is no UPDATE path for the template: an island is chosen once.
CREATE TABLE IF NOT EXISTS farm_islands (
  farm_id TEXT PRIMARY KEY NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  element TEXT NOT NULL CHECK (element IN ('THO', 'KIM', 'MOC', 'THUY', 'HOA')),
  outline TEXT NOT NULL CHECK (outline IN ('ROUND', 'LONG', 'CRESCENT', 'TWIN', 'ATOLL', 'ARCHIPELAGO')),
  seed INTEGER NOT NULL CHECK (seed BETWEEN 1 AND 2147483647),
  generator_version INTEGER NOT NULL CHECK (generator_version >= 1),
  grid_size INTEGER NOT NULL CHECK (grid_size BETWEEN 16 AND 256),
  origin_x INTEGER NOT NULL,
  origin_y INTEGER NOT NULL,
  cells TEXT NOT NULL CHECK (length(cells) = grid_size * grid_size),
  sites_json TEXT NOT NULL CHECK (json_valid(sites_json) AND json_type(sites_json) = 'array'),
  -- Bumped when the ground itself changes (future sea reclamation); clients cache by it.
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL
);
