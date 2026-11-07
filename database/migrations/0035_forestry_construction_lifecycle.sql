-- Forestry lifecycle for persisted broadleaf/pine constructions.
--
-- The construction row is the stable instance identity. This table owns only the chop cycle, so
-- Move/Store/Restore can change the construction row without resetting a stump or its regeneration
-- clock. Ambient scenery is intentionally absent: it has no server identity and cannot settle loot.
CREATE TABLE forestry_construction_states (
  construction_id TEXT PRIMARY KEY REFERENCES farm_constructions(id) ON DELETE CASCADE,
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  last_chopped_at TEXT,
  regeneration_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((last_chopped_at IS NULL AND regeneration_at IS NULL) OR (last_chopped_at IS NOT NULL AND regeneration_at IS NOT NULL))
);

CREATE INDEX idx_forestry_construction_states_farm
  ON forestry_construction_states(farm_id, construction_id);

-- Existing saves get one ready lifecycle row per eligible tree. INSERT OR IGNORE makes the migration
-- safe to re-run in local/test harnesses and never overwrites a previously chopped tree.
INSERT OR IGNORE INTO forestry_construction_states (
  construction_id, farm_id, entry_id, last_chopped_at, regeneration_at, version, created_at, updated_at
)
SELECT id, farm_id, catalogue_entry_id, NULL, NULL, 1, created_at, updated_at
FROM farm_constructions
WHERE catalogue_entry_id IN ('world.tree_broad', 'world.tree_pine', 'place_tree_broad', 'place_tree_pine');

