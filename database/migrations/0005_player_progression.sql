-- Authoritative player experience, and the level derived from it.
--
-- A progression row is the only record of how far a player has come, so two properties are enforced
-- here rather than trusted to the caller: experience never decreases, and the optimistic version
-- always advances. The level column caches the curve applied to `xp`; SQL cannot recompute it, so
-- `assertProgression` in `packages/domain/src/progression.ts` refuses a row where the two disagree
-- rather than writing the disagreement forward.
--
-- Rows are created lazily on the first award, exactly like wallets. The development bootstrap is
-- required to create only the player, so this table must tolerate a player that has no row yet.
PRAGMA foreign_keys = ON;

CREATE TABLE player_progression (
  player_id TEXT PRIMARY KEY NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10000),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp BETWEEN 0 AND 9007199254740991),
  progression_version INTEGER NOT NULL DEFAULT 1 CHECK (progression_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER player_progression_monotonic_update
BEFORE UPDATE ON player_progression
WHEN NEW.xp < OLD.xp
  OR NEW.level < OLD.level
  OR NEW.progression_version <= OLD.progression_version
BEGIN
  SELECT RAISE(ABORT, 'player progression cannot regress');
END;