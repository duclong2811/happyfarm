-- Work Areas: player-named groups of cells a future Job may be asked to work (V16.2.2A).
--
-- A work area is orchestration metadata. It is not land ownership, not a land-use decision, not a
-- placement reservation and not occupancy: a cell named here is still free for any crop, tree,
-- building or node the ordinary rules allow. Nothing in this file touches land, gold, inventory,
-- crops, trees, buildings or nodes, and creating an area costs nothing.
--
-- Membership is an explicit (area, x, y) row, never a rectangle. A rectangle is the editor's
-- selection convenience; the durable shape is the cell list, because an orchard along a shore or a
-- quarry on a flank is not a rectangle and a stored rectangle would force a later migration to learn
-- geometry it did not need. The set is bounded by the server (`MAX_WORK_AREA_CELLS`), and
-- `idx_work_area_cells_area_yx` makes the membership read an index-only scan in the query's own
-- order - the V16.2.1A lesson applied to the one new hot read this slice adds.
--
-- The zone columns are stored so a future expansion island or shared ground is another row rather
-- than a redesign, and so a later Job can be scoped by place. They are a location, never authority.
--
-- Comments here are line comments with no semicolon - Wrangler's statement splitter needs that.
-- Additive and compatible with every existing save: two new tables, no existing row touched.
PRAGMA foreign_keys = ON;

CREATE TABLE work_areas (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'workarea_*'),
  farm_id TEXT NOT NULL,
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('FARM', 'ORCHARD', 'FORESTRY', 'MINING', 'LIVESTOCK', 'AQUACULTURE')),
  -- The stored name is already trimmed and NFC-normalised by the domain; SQLite's length() counts
  -- characters, so a Unicode name is bounded by what a player reads, not by its byte length.
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- One farm's areas, in creation order: the list read, and nothing global.
CREATE INDEX idx_work_areas_farm ON work_areas(farm_id, created_at, id);

-- The same list scoped by place, for a future expansion island or shared ground.
CREATE INDEX idx_work_areas_zone ON work_areas(zone_id, created_at, id);

-- Membership. The primary key is what makes "these cells, once" true under concurrency; two racing
-- membership writes cannot interleave into a set neither editor drew because the area's version
-- guard refuses the loser before it writes.
CREATE TABLE work_area_cells (
  work_area_id TEXT NOT NULL,
  x INTEGER NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
  y INTEGER NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
  PRIMARY KEY (work_area_id, x, y),
  FOREIGN KEY (work_area_id) REFERENCES work_areas(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

-- The membership read: one area's own cells, covering and already in the order the client draws
-- them, so it costs one rows-read per cell and needs no temp sort.
CREATE INDEX idx_work_area_cells_area_yx ON work_area_cells(work_area_id, y, x);
