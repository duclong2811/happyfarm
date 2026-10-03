-- Resource nodes: the mutable half of mining, and the shape forestry reuses.
--
-- A node's *definition* (verb, timings, drop table, model, level) and its *placement* (node id,
-- position, zone kind) are static game data. This file stores only what actually changes: when a
-- node next becomes available, and the player's gather attempts against it.
--
-- The availability row is written lazily by the first successful gather, exactly as a wallet is
-- written by the first settlement: "no row" means never gathered, which is available. Regeneration is
-- therefore a comparison of `available_at` against the server clock, not a job - nothing ticks, and a
-- player who closes the game comes back to a deposit that is ready.
--
-- Both tables are zone-scoped: `resource_node_states` is keyed by (zone_id, node_id), so reading a
-- zone's nodes is one bounded range scan of that zone's own rows and never a scan of a future world.
--
-- Note for anyone editing this file: comments are line comments (`--`), never block comments, and no
-- comment contains a semicolon. Wrangler's statement splitter does not understand a block comment.
PRAGMA foreign_keys = ON;

-- No foreign key to a node table: nodes are game data, not rows. `zone_id` is a zone (for a home
-- island, `zone_home_island_<farmId>`), which is what keeps this table usable by a shared ground later.
CREATE TABLE resource_node_states (
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  node_id TEXT NOT NULL CHECK (node_id GLOB 'node_*'),
  available_at TEXT NOT NULL,
  depleted_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (zone_id, node_id)
);

-- One row per gather attempt, keyed by the server-issued action id. The verb travels with the action
-- so forestry's CHOP reuses this table and this settlement without a schema change.
CREATE TABLE resource_actions (
  action_id TEXT PRIMARY KEY NOT NULL CHECK (action_id GLOB 'resact_*'),
  actor_player_id TEXT NOT NULL,
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  node_id TEXT NOT NULL CHECK (node_id GLOB 'node_*'),
  definition_id TEXT NOT NULL CHECK (definition_id GLOB 'resource_*'),
  verb TEXT NOT NULL CHECK (verb IN ('MINE', 'CHOP')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SETTLED', 'CANCELLED')),
  started_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  settled_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'SETTLED' OR settled_at IS NOT NULL),
  FOREIGN KEY (actor_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- The one targeted read a refresh performs: this actor's active attempt, if any.
CREATE INDEX idx_resource_actions_actor_status ON resource_actions(actor_player_id, status);

-- At most one live gather per player, enforced by the database rather than by a check-then-insert.
CREATE UNIQUE INDEX idx_resource_actions_one_active
  ON resource_actions(actor_player_id)
  WHERE status = 'ACTIVE';
