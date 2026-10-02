-- V13.3.1: the starter island's ordinary objects become editable too.
--
-- V13.3 gave the island a table of world objects (`farm_constructions`) and seeded the mill plus a
-- ring of authored vegetation. V13.3.1 promotes the rest of what a player *sees* as an individual
-- object: the procedural forest, the authored buildings, and the set dressing - each with a stable
-- placement key, seeded additively as starter world version 2.
--
-- Two facts about that population drive this migration, and neither needs a table rebuild:
--
--   1. **The island's objects stand at a world position, not on the grid.** A tree the generator grew
--      is at x = -4.37, and an authored building is at 42.5. `anchor_x`/`anchor_y` are declared
--      INTEGER, and SQLite's INTEGER *affinity* stores a value like 42.5 as REAL rather than rounding
--      it - which is exactly what is wanted here, so the column keeps storing the position the object
--      actually stands at. The DTO admits a fractional anchor; the *cells* a row occupies are still
--      derived by flooring it, so ownership, occupancy and the crop/tree checks stay on the grid.
--
--   2. **The starter arrangement may nest; a player's edit may not.** The scatter grows bushes and
--      rocks close together, and two of them can share a cell. That is the island as it already looks,
--      so seeding must be allowed to reproduce it - while a *player* placing, moving or restoring an
--      object must still respect every object standing there. The occupancy triggers therefore ignore
--      a conflict between two `STARTER` rows, and nothing else.
--
-- The trigger bodies below are 0012's, with that one predicate added; the table, its indexes, its
-- columns and every other trigger are untouched.
PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS farm_construction_requires_free_cells;
DROP TRIGGER IF EXISTS farm_construction_update_requires_free_cells;

-- Nothing already stands there - except another starter object. The starter arrangement is the
-- island as it was grown; two of its own objects may share a cell, and the player's edits are still
-- checked against both of them.
CREATE TRIGGER farm_construction_requires_free_cells
BEFORE INSERT ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM farm_constructions AS other
    WHERE other.farm_id = NEW.farm_id
      AND other.state = 'ACTIVE'
      AND NOT (NEW.source = 'STARTER' AND other.source = 'STARTER')
      AND NEW.min_x <= other.max_x
      AND NEW.max_x >= other.min_x
      AND NEW.min_y <= other.max_y
      AND NEW.max_y >= other.min_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;

CREATE TRIGGER farm_construction_update_requires_free_cells
BEFORE UPDATE ON farm_constructions
WHEN NEW.state = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM farm_constructions AS other
    WHERE other.farm_id = NEW.farm_id
      AND other.state = 'ACTIVE'
      AND other.id <> NEW.id
      AND NOT (NEW.source = 'STARTER' AND other.source = 'STARTER')
      AND NEW.min_x <= other.max_x
      AND NEW.max_x >= other.min_x
      AND NEW.min_y <= other.max_y
      AND NEW.max_y >= other.min_y
  )
BEGIN
  SELECT RAISE(ABORT, 'construction cells are already occupied');
END;
