-- V16.2.2D2.3 B3.1: the emergency funding whitelist Auto may sell from.
--
-- Auto may buy the seed an assignment needs. When the player's Gold cannot cover that purchase, the
-- only thing Auto is allowed to sell is what the player explicitly named here, in the order they
-- named it. Nothing else is ever liquidated: this is a funding policy, not Auto Sell.
--
-- Two additive changes:
--   1. one flag on the assignment (default OFF, so every existing assignment keeps today's behavior);
--   2. one row per selected item, with a dense priority that Auto reads in order.
--
-- The item ids are game-data ids, not display names, and the selected set is bounded by
-- MAX_AUTO_FUNDING_ITEMS (8) in the domain. Whether an item is *sellable at all* is decided by the
-- authoritative shop catalogue at plan and at settlement time; this table only says which sellable
-- items this assignment may fall back on.
--
-- Comments are line comments with no semicolon - Wrangler's statement splitter needs that.
PRAGMA foreign_keys = ON;

ALTER TABLE actor_jobs ADD COLUMN auto_funding_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (auto_funding_enabled IN (0, 1));

CREATE TABLE auto_funding_items (
  job_id TEXT NOT NULL,
  item_definition_id TEXT NOT NULL CHECK (item_definition_id GLOB 'item_*'),
  -- 1 is sold first. Dense per assignment, bounded by MAX_AUTO_FUNDING_ITEMS.
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 8),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, item_definition_id),
  UNIQUE (job_id, priority),
  FOREIGN KEY (job_id) REFERENCES actor_jobs(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX idx_auto_funding_items_job ON auto_funding_items(job_id, priority);
