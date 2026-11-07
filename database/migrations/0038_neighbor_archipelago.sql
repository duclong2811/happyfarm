-- Additive three-island shell. The legacy neighbor_islands row is retained as island slot MOC.
CREATE TABLE IF NOT EXISTS neighbor_archipelago_islands (
  id TEXT PRIMARY KEY,
  home_farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('MOC','KIM','THUY')),
  seed INTEGER NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  world_center_x REAL NOT NULL,
  world_center_z REAL NOT NULL,
  dock_x REAL NOT NULL,
  dock_z REAL NOT NULL,
  npc_x REAL NOT NULL,
  npc_z REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(home_farm_id, slot)
);
CREATE TABLE IF NOT EXISTS neighbor_archipelago_npc_states (
  island_id TEXT PRIMARY KEY REFERENCES neighbor_archipelago_islands(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL UNIQUE,
  display_name_key TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('PREPARING','WORKING','WAITING','STOCKED')),
  cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  next_action_at TEXT NOT NULL,
  last_settled_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_neighbor_archipelago_reconcile ON neighbor_archipelago_npc_states(next_action_at, island_id);
ALTER TABLE neighbor_visits ADD COLUMN current_island_id TEXT;
