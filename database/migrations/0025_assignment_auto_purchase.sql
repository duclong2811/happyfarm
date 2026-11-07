-- V16.2.2D1: the one Assignment policy Auto needs to plan with.
--
-- The C.5 design's supply resolution is: use what the actor carries, else the Warehouse, else buy -
-- and "else buy" is a *policy*, not a fact. This is that policy, and it is the only schema change D1
-- needs: everything else (control mode, cargo, the transfer directions, the skill identity derived
-- from `(kind, target)`) already exists.
--
-- Default OFF, which is the safe direction: an existing assignment never starts spending gold because
-- a new build shipped. A player turns it on per assignment, in the panel.
--
-- Comments are line comments with no semicolon - Wrangler's statement splitter needs that.
-- Additive and compatible with every existing save: one column with a default, nothing rewritten.
ALTER TABLE actor_jobs ADD COLUMN auto_purchase_supplies INTEGER NOT NULL DEFAULT 0
  CHECK (auto_purchase_supplies IN (0, 1));
