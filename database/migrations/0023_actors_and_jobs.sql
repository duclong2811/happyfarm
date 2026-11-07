-- Actors and jobs: who could work, where, and in what order (V16.2.2B).
--
-- This is the *configuration* spine of automation, not automation. An actor is the entity capable of
-- performing jobs; a job is a durable statement of intent - an actor, a work area, a profession, a
-- stable game-data target, a priority and an enabled flag. Nothing here executes: creating a job
-- plants nothing, harvests nothing, moves nobody, and writes no inventory, experience, gold or
-- warehouse row. There is no cargo, no route, no activity, no watermark and no simulation.
--
-- An actor is deliberately not a player. `owner_player_id` is identity - whose actor this is - and the
-- actor's own id is what a job references, so a later slice's NPCs, carts and ships are new rows
-- rather than a re-identification of everybody's history.
--
-- `work_area_id` is RESTRICT, not CASCADE, on purpose: a job's area is its WHERE, and an area that
-- silently deleted the configuration pointing at it would lose work the player never asked to lose.
-- The application refuses first, with `WORK_AREA_IN_USE`, so the player is told which step comes first.
--
-- Comments are line comments with no semicolon - Wrangler's statement splitter needs that.
-- Additive and compatible with every existing save: two new tables, no existing row touched.
PRAGMA foreign_keys = ON;

CREATE TABLE actors (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'actor_*'),
  owner_player_id TEXT NOT NULL,
  -- The vocabulary is the full one so a later slice adds rows, not an enum; only MAIN_CHARACTER is
  -- ever created today.
  kind TEXT NOT NULL CHECK (kind IN ('MAIN_CHARACTER', 'NPC_WORKER', 'VEHICLE', 'SHIP')),
  -- Control is configuration: it is what the future Auto ON/OFF writes. Activity is runtime and is
  -- deliberately not a column, because nothing writes it yet.
  control_mode TEXT NOT NULL DEFAULT 'PLAYER_CONTROLLED' CHECK (control_mode IN ('PLAYER_CONTROLLED', 'AUTO_CONTROLLED')),
  zone_kind TEXT NOT NULL CHECK (length(zone_kind) BETWEEN 1 AND 40),
  zone_id TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 120),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Exactly one Main Character per player, enforced by the database rather than by a check somebody has
-- to remember: repeated logins, two tabs, a refreshed guest session and two simultaneous bootstraps
-- all converge on one row. Partial, so the NPCs a later slice adds are not capped at one per player.
CREATE UNIQUE INDEX idx_actors_one_main_character ON actors(owner_player_id) WHERE kind = 'MAIN_CHARACTER';

-- Every actor a player owns, in creation order: the owner's lookup, and nothing global.
CREATE INDEX idx_actors_owner ON actors(owner_player_id, created_at, id);

CREATE TABLE actor_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'job_*'),
  actor_id TEXT NOT NULL,
  -- The farm the work belongs to: the authorization root a route scopes by, and what keeps a job from
  -- being reachable through a farm it does not belong to.
  farm_id TEXT NOT NULL,
  work_area_id TEXT NOT NULL,
  -- The same profession vocabulary a work area is named with, so a job and its area are compatible by
  -- construction rather than by a translation table.
  kind TEXT NOT NULL CHECK (kind IN ('FARM', 'ORCHARD', 'FORESTRY', 'MINING', 'LIVESTOCK', 'AQUACULTURE')),
  -- A stable game-data id: crop_*, tree_* or resource_*. Never a translated label.
  target_definition_id TEXT NOT NULL CHECK (length(target_definition_id) BETWEEN 1 AND 120),
  -- 1 is first. Dense and contiguous across one actor's jobs, which the transactional reorder keeps
  -- true; the ceiling is MAX_JOBS_PER_ACTOR in the domain.
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 24),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (work_area_id) REFERENCES work_areas(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- The query a future executor asks, and the panel asks: one actor's own jobs, in priority order.
-- Ordered, so the read walks the index in the order it is used and needs no temp sort, and bounded to
-- one actor because `actor_id` leads. At most MAX_JOBS_PER_ACTOR rows, so a covering copy of the row
-- would buy nothing.
CREATE INDEX idx_actor_jobs_actor_priority ON actor_jobs(actor_id, priority, id);

-- A work area's own references: the delete guard's count, and the lookup that names them.
CREATE INDEX idx_actor_jobs_work_area ON actor_jobs(work_area_id, id);
