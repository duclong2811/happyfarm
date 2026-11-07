-- V16.2.3D3A: canonical wild-fishery spot stock. Aquaculture has no rows here.
--
-- SQLite cannot add a value to the CHECK vocabulary on work_areas.kind or actor_jobs.kind. Those
-- two tables therefore need a rebuild. The live schema has more dependencies than those parents:
-- work_area_cells -> work_areas, actor_jobs -> work_areas, auto_funding_items -> actor_jobs,
-- production_assignments -> actor_jobs/work_areas, and production_settlement_receipts ->
-- production_assignments. Every dependent table is copied to a temporary name first, the old
-- dependency chain is removed from the leaves upward, and the replacement chain is renamed back.
-- This keeps foreign-key enforcement enabled throughout; it is intentionally not a PRAGMA
-- foreign_keys=OFF workaround, which is not reliable inside D1's migration transaction.
PRAGMA foreign_keys = ON;

CREATE TABLE work_areas_v16_2_3d3a (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'workarea_*'),
  farm_id TEXT NOT NULL,
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('FARM', 'ORCHARD', 'FORESTRY', 'MINING', 'LIVESTOCK', 'AQUACULTURE', 'FISHERY')),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE actor_jobs_v16_2_3d3a (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'job_*'),
  actor_id TEXT NOT NULL,
  farm_id TEXT NOT NULL,
  work_area_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('FARM', 'ORCHARD', 'FORESTRY', 'MINING', 'LIVESTOCK', 'AQUACULTURE', 'FISHERY')),
  target_definition_id TEXT NOT NULL CHECK (length(target_definition_id) BETWEEN 1 AND 120),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 24),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  auto_purchase_supplies INTEGER NOT NULL DEFAULT 0 CHECK (auto_purchase_supplies IN (0, 1)),
  auto_funding_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_funding_enabled IN (0, 1)),
  execution_mode TEXT NOT NULL DEFAULT 'LEGACY_ACTION_AUTO'
    CHECK (execution_mode IN ('LEGACY_ACTION_AUTO', 'RATE_PRODUCTION')),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (work_area_id) REFERENCES work_areas_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE work_area_cells_v16_2_3d3a (
  work_area_id TEXT NOT NULL,
  x INTEGER NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
  y INTEGER NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
  PRIMARY KEY (work_area_id, x, y),
  FOREIGN KEY (work_area_id) REFERENCES work_areas_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE TABLE auto_funding_items_v16_2_3d3a (
  job_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 8),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, item_definition_id),
  UNIQUE (job_id, priority),
  FOREIGN KEY (job_id) REFERENCES actor_jobs_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE TABLE production_assignments_v16_2_3d3a (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'production_assignment_*'),
  farm_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_job_id TEXT NOT NULL,
  work_area_id TEXT,
  source_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  settlement_cursor TEXT NOT NULL,
  production_remainder INTEGER NOT NULL DEFAULT 0 CHECK (production_remainder >= 0),
  blocked_reason TEXT CHECK (blocked_reason IS NULL OR blocked_reason IN ('WAREHOUSE_FULL', 'SOURCE_DEPLETED', 'DISABLED', 'NOT_READY')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (actor_job_id) REFERENCES actor_jobs_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (work_area_id) REFERENCES work_areas_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (source_id) REFERENCES production_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE production_settlement_receipts_v16_2_3d3a (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  cursor_before TEXT NOT NULL,
  cursor_after TEXT NOT NULL,
  produced_quantity INTEGER NOT NULL CHECK (produced_quantity >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, request_id),
  FOREIGN KEY (assignment_id) REFERENCES production_assignments_v16_2_3d3a(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

INSERT INTO work_areas_v16_2_3d3a SELECT * FROM work_areas;
INSERT INTO actor_jobs_v16_2_3d3a SELECT * FROM actor_jobs;
INSERT INTO work_area_cells_v16_2_3d3a SELECT * FROM work_area_cells;
INSERT INTO auto_funding_items_v16_2_3d3a SELECT * FROM auto_funding_items;
INSERT INTO production_assignments_v16_2_3d3a SELECT * FROM production_assignments;
INSERT INTO production_settlement_receipts_v16_2_3d3a SELECT * FROM production_settlement_receipts;

-- Remove the old dependency graph from its leaves toward the two rebuilt parents.
DROP TABLE production_settlement_receipts;
DROP TABLE auto_funding_items;
DROP TABLE production_assignments;
DROP TABLE work_area_cells;
DROP TABLE actor_jobs;
DROP TABLE work_areas;

ALTER TABLE work_areas_v16_2_3d3a RENAME TO work_areas;
ALTER TABLE actor_jobs_v16_2_3d3a RENAME TO actor_jobs;
ALTER TABLE work_area_cells_v16_2_3d3a RENAME TO work_area_cells;
ALTER TABLE auto_funding_items_v16_2_3d3a RENAME TO auto_funding_items;
ALTER TABLE production_assignments_v16_2_3d3a RENAME TO production_assignments;
ALTER TABLE production_settlement_receipts_v16_2_3d3a RENAME TO production_settlement_receipts;

CREATE INDEX idx_work_areas_farm ON work_areas(farm_id, created_at, id);
CREATE INDEX idx_work_areas_zone ON work_areas(zone_id, created_at, id);
CREATE INDEX idx_work_area_cells_area_yx ON work_area_cells(work_area_id, y, x);
CREATE INDEX idx_actor_jobs_actor_priority ON actor_jobs(actor_id, priority, id);
CREATE INDEX idx_actor_jobs_work_area ON actor_jobs(work_area_id, id);
CREATE INDEX idx_auto_funding_items_job ON auto_funding_items(job_id, priority);
CREATE UNIQUE INDEX idx_production_assignments_actor_source ON production_assignments(actor_id, source_id);
CREATE UNIQUE INDEX idx_production_assignments_actor_job ON production_assignments(actor_job_id);
CREATE INDEX idx_production_assignments_farm ON production_assignments(farm_id, id);

CREATE TABLE fishing_spot_states (
  zone_kind TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  spot_id TEXT NOT NULL CHECK (spot_id GLOB 'spot_*'),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  last_regenerated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (zone_id, spot_id)
);

CREATE INDEX idx_fishing_spot_states_zone ON fishing_spot_states(zone_kind, zone_id, spot_id);
