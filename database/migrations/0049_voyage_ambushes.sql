-- Pirate ambushes on voyages (docs/design/NAVAL.md, W5c).
-- A voyage the server planned an ambush for carries it here when it starts: when it strikes, the
-- fight's seed, and the pirates. `ambush_status` is PENDING until the fight is decided by replaying
-- the player's submitted inputs (or none, if the ship was called home after the ambush struck), then
-- holds the outcome. A voyage with no ambush has these all NULL.
ALTER TABLE ship_voyages ADD COLUMN ambush_at TEXT;
ALTER TABLE ship_voyages ADD COLUMN ambush_seed INTEGER CHECK (ambush_seed IS NULL OR ambush_seed BETWEEN 0 AND 4294967295);
ALTER TABLE ship_voyages ADD COLUMN ambush_pirates TEXT CHECK (ambush_pirates IS NULL OR length(ambush_pirates) BETWEEN 2 AND 400);
ALTER TABLE ship_voyages ADD COLUMN ambush_status TEXT CHECK (ambush_status IS NULL OR ambush_status IN ('PENDING', 'WON', 'LOST', 'FLED', 'TIMEOUT'));
