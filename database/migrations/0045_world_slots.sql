-- World map slots, see docs/design/WORLD_MAP.md.
-- The sea chart itself is game data (packages/game-data/src/world/sea-chart.ts). This table only
-- records which farm holds which slot. A slot holds one farm (the primary key) and a farm holds
-- one slot (the unique farm_id), so two claims can never share a place.
CREATE TABLE IF NOT EXISTS world_slots (
  slot_id TEXT PRIMARY KEY NOT NULL CHECK (slot_id GLOB 'slot_[a-z]*_[0-9]*_[0-9]*'),
  region TEXT NOT NULL CHECK (region IN ('NORTH', 'EAST', 'SOUTH', 'WEST')),
  farm_id TEXT NOT NULL UNIQUE REFERENCES farms(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS world_slots_region ON world_slots (region);

-- Farms that already have a chosen island take a place in each region's first archipelago, in
-- creation order, round the four regions. Every first archipelago has at least four slots, so the
-- first sixteen such farms always fit. Any later one is placed the next time it asks for its slot.
INSERT OR IGNORE INTO world_slots (slot_id, region, farm_id, claimed_at)
SELECT
  'slot_' || lower(region) || '_1_' || CAST(slot_number AS TEXT),
  region,
  farm_id,
  created_at
FROM (
  SELECT
    farm_id,
    created_at,
    CASE ((position - 1) % 4) WHEN 0 THEN 'NORTH' WHEN 1 THEN 'EAST' WHEN 2 THEN 'SOUTH' ELSE 'WEST' END AS region,
    ((position - 1) / 4) + 1 AS slot_number
  FROM (
    SELECT farm_id, created_at, ROW_NUMBER() OVER (ORDER BY created_at, farm_id) AS position
    FROM farm_islands
  )
)
WHERE slot_number <= 4;
