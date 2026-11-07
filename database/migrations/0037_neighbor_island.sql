-- First neighbour island: additive state, independent from player farm economy.
CREATE TABLE IF NOT EXISTS neighbor_islands (
  id TEXT PRIMARY KEY,
  home_farm_id TEXT NOT NULL UNIQUE REFERENCES farms(id) ON DELETE CASCADE,
  world_center_x REAL NOT NULL,
  world_center_z REAL NOT NULL,
  dock_x REAL NOT NULL,
  dock_z REAL NOT NULL,
  npc_x REAL NOT NULL,
  npc_z REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS neighbor_npc_states (
  island_id TEXT PRIMARY KEY REFERENCES neighbor_islands(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL UNIQUE,
  display_name_key TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('GROWING', 'STOCKED', 'BUILT')),
  planted_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  construction_level INTEGER NOT NULL DEFAULT 0 CHECK (construction_level >= 0),
  next_milestone_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_reconciled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS neighbor_visits (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  farm_id TEXT NOT NULL UNIQUE REFERENCES farms(id) ON DELETE CASCADE,
  current_place TEXT NOT NULL CHECK (current_place IN ('HOME_ISLAND', 'NEIGHBOR_ISLAND')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS neighbor_travel_receipts (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (player_id, request_id)
);
