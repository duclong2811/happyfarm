-- V16.2.1A: make the farm-scoped list reads index-only.
--
-- The V16.2.1 staging baseline read about 4.54M rows/day against a 5M Free ceiling. D1 Insights put
-- 2.13M of it on one query, the client's full `farm_tiles` list, and another 1.77M on the full
-- `farm_constructions` list - 86% of the day in two "read one farm's rows" queries.
--
-- Every one of those list reads ran as:
--   SEARCH <table> USING INDEX idx_<table>_farm_id (farm_id=?)
--   USE TEMP B-TREE FOR ORDER BY
-- A non-covering farm_id index does two rows-reads per returned row - one index entry plus one table
-- fetch - and the ORDER BY then sorts the whole result. Measured on staging: 144 tiles = 289
-- rows-read, 720 tiles = 1440, 382 constructions = 764. Exactly two per row.
--
-- These indexes are covering and match the query's own order, so each read becomes an index-only
-- scan in that order: one rows-read per returned row, and no temp sort. They are the smallest change
-- that removes the waste without touching any gameplay rule; server authority, timestamps, maturity
-- and settlement are all unchanged.
--
-- Comments here are line comments with no semicolon - Wrangler's statement splitter needs that.
-- Additive and staging-safe: indexes carry no player data, so an interrupted apply leaves the tables
-- untouched, and IF NOT EXISTS / IF EXISTS make a re-run harmless.

CREATE INDEX IF NOT EXISTS idx_farm_tiles_farm_yx
  ON farm_tiles(farm_id, y, x, terrain_type, tile_state, version, updated_at);

CREATE INDEX IF NOT EXISTS idx_crop_instances_farm_yx
  ON crop_instances(farm_id, tile_y, tile_x, id, crop_definition_id, planted_by_player_id, planted_at, version, created_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_tree_instances_farm_yx
  ON tree_instances(farm_id, tile_y, tile_x, id, tree_definition_id, planted_by_player_id, planted_at, last_harvested_at, version, created_at, updated_at);

-- The single-column farm_id indexes these replace are strictly redundant: each new index has
-- farm_id as its leading column, so it answers every `WHERE farm_id = ?` the old one did. Dropping
-- them keeps the write cost of the covering copies from stacking on top of an index nobody uses.
DROP INDEX IF EXISTS idx_farm_tiles_farm_id;
DROP INDEX IF EXISTS idx_crop_instances_farm_id;
DROP INDEX IF EXISTS idx_tree_instances_farm_id;
