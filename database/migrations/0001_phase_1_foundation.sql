-- Phase 1 baseline. Foreign keys are explicit; normal gameplay never hard-deletes players.
PRAGMA foreign_keys = ON;

CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  auth_issuer TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (auth_issuer, auth_subject)
);

CREATE TABLE farms (
  id TEXT PRIMARY KEY NOT NULL,
  owner_player_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_farms_owner_player_id ON farms(owner_player_id);

CREATE TABLE farm_members (
  farm_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'HELPER', 'VISITOR')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, player_id),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_farm_members_player_id ON farm_members(player_id);
CREATE UNIQUE INDEX idx_farm_members_one_owner ON farm_members(farm_id) WHERE role = 'OWNER';

-- SQLite cannot express the farms.owner_player_id -> OWNER-role cross-table invariant as a simple FK.
-- The D1 repository inserts the farm and matching OWNER membership in one atomic batch.
CREATE TRIGGER farm_members_owner_matches_farm
BEFORE INSERT ON farm_members
WHEN NEW.role = 'OWNER'
  AND NEW.player_id <> (SELECT owner_player_id FROM farms WHERE id = NEW.farm_id)
BEGIN
  SELECT RAISE(ABORT, 'owner membership must match farm owner');
END;

CREATE TRIGGER farm_owner_membership_cannot_change
BEFORE UPDATE OF farm_id, player_id, role ON farm_members
WHEN OLD.role = 'OWNER'
BEGIN
  SELECT RAISE(ABORT, 'owner membership cannot change without ownership transfer');
END;

CREATE TRIGGER farm_owner_membership_cannot_be_removed
BEFORE DELETE ON farm_members
WHEN OLD.role = 'OWNER'
  AND EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id)
BEGIN
  SELECT RAISE(ABORT, 'owner membership cannot be removed independently');
END;

CREATE TRIGGER farm_owner_cannot_change
BEFORE UPDATE OF owner_player_id ON farms
BEGIN
  SELECT RAISE(ABORT, 'ownership transfer is not implemented');
END;

CREATE TABLE farm_tiles (
  farm_id TEXT NOT NULL,
  x INTEGER NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
  y INTEGER NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
  terrain_type TEXT NOT NULL CHECK (terrain_type IN ('GRASS', 'SOIL', 'WATER', 'BLOCKED')),
  tile_state TEXT NOT NULL CHECK (tile_state IN ('IDLE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, x, y),
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_farm_tiles_farm_id ON farm_tiles(farm_id);
