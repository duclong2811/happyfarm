-- V16.2.3B: additive Production Rate foundation. Existing actor_jobs remain legacy by default.
PRAGMA foreign_keys = ON;

ALTER TABLE actor_jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'LEGACY_ACTION_AUTO'
  CHECK (execution_mode IN ('LEGACY_ACTION_AUTO', 'RATE_PRODUCTION'));

CREATE TABLE production_sources (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'production_source_*'),
  farm_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('RENEWABLE', 'FINITE')),
  output_item_definition_id TEXT NOT NULL CHECK (output_item_definition_id GLOB 'item_*'),
  rate_per_hour INTEGER NOT NULL CHECK (rate_per_hour BETWEEN 0 AND 1000000000),
  remaining_stock INTEGER CHECK (remaining_stock IS NULL OR remaining_stock BETWEEN 0 AND 9007199254740991),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK ((kind = 'FINITE' AND remaining_stock IS NOT NULL) OR (kind = 'RENEWABLE' AND remaining_stock IS NULL))
);

CREATE INDEX idx_production_sources_farm ON production_sources(farm_id, id);

CREATE TABLE production_assignments (
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
  FOREIGN KEY (actor_job_id) REFERENCES actor_jobs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (work_area_id) REFERENCES work_areas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (source_id) REFERENCES production_sources(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_production_assignments_actor_source ON production_assignments(actor_id, source_id);
CREATE UNIQUE INDEX idx_production_assignments_actor_job ON production_assignments(actor_job_id);
CREATE INDEX idx_production_assignments_farm ON production_assignments(farm_id, id);

CREATE TABLE production_settlement_receipts (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 100),
  cursor_before TEXT NOT NULL,
  cursor_after TEXT NOT NULL,
  produced_quantity INTEGER NOT NULL CHECK (produced_quantity >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, request_id),
  FOREIGN KEY (assignment_id) REFERENCES production_assignments(id) ON UPDATE RESTRICT ON DELETE CASCADE
);
