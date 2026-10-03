-- Fishing actions: the durable half of one fishing attempt.
--
-- A fishing action is the smallest persisted thing that makes the server the authority on when a
-- catch may be claimed: an actor, the zone and spot it happened in, and the two timestamps. The
-- waiting itself is a comparison against `ready_at`, never a timer, so nothing is written while the
-- player waits and a refresh cannot lose or duplicate the attempt.
--
-- One row per attempt, keyed by the server-issued action id. Settling is a guarded transition of this
-- row (ACTIVE -> SETTLED) inside the same batch as the inventory credit, the experience award and the
-- idempotency receipt, so a replayed or racing settlement finds the row already moved and pays
-- nothing. `fishing_catches` is deliberately not a second table: the action row *is* the effect
-- record, and the receipt's guard reads it.
--
-- The unique partial index is what makes "one active action per player" true under concurrency: two
-- simultaneous starts cannot both win, so the loser retries and finds the winner's action.
--
-- Note for anyone editing this file: comments are line comments (`--`), never block comments, and no
-- comment contains a semicolon. Wrangler's statement splitter does not understand a block comment.
PRAGMA foreign_keys = ON;

CREATE TABLE fishing_actions (
  action_id TEXT PRIMARY KEY NOT NULL CHECK (action_id GLOB 'fishact_*'),
  actor_player_id TEXT NOT NULL,
  -- The zone the attempt happened in. Explicit, and not a farm: a future shared ground names itself
  -- here instead, and the settlement code does not change.
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  spot_id TEXT NOT NULL CHECK (spot_id GLOB 'spot_*'),
  table_id TEXT NOT NULL CHECK (table_id GLOB 'fishtable_*'),
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
CREATE INDEX idx_fishing_actions_actor_status ON fishing_actions(actor_player_id, status);

-- At most one live attempt per player, enforced by the database rather than by a check-then-insert.
CREATE UNIQUE INDEX idx_fishing_actions_one_active
  ON fishing_actions(actor_player_id)
  WHERE status = 'ACTIVE';
