-- World map exploration, see docs/design/WORLD_MAP.md (W4).
-- One row per place a player has visited. The chart a player sees is their home archipelago and
-- what can be seen from the places listed here (chartedArchipelagos in
-- packages/game-data/src/world/sea-chart.ts). A visit is recorded once, so visiting a place again
-- changes nothing. Rows are bounded by the number of places on the chart.
CREATE TABLE IF NOT EXISTS world_visits (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL CHECK (slot_id GLOB 'slot_[a-z]*_[0-9]*_[0-9]*'),
  visited_at TEXT NOT NULL,
  PRIMARY KEY (player_id, slot_id)
);
