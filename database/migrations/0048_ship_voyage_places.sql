-- Ships seen at sea (docs/design/NAVAL.md, W5b-lite).
-- The chart and the archipelago reads list the voyages under way in the reader's charted world, by
-- the places they sail from and to. These two partial indexes keep that read to the voyages that are
-- actually under way, whatever the number of ended ones.
CREATE INDEX IF NOT EXISTS ship_voyages_underway_to ON ship_voyages (to_slot_id) WHERE status = 'UNDERWAY';
CREATE INDEX IF NOT EXISTS ship_voyages_underway_from ON ship_voyages (from_slot_id) WHERE status = 'UNDERWAY';
