-- A step marker on the warehouse row: the proof that an upgrade transaction actually moved it.
--
-- V16.2's upgrade settlement wrote its idempotency receipt when the warehouse row was at the tier and
-- version the transaction claimed. That check is not unique to the transaction that did the work: two
-- *different* upgrades racing from the same tier read the same state, one moves the row, and the
-- other - whose own step was refused by the `tier`/`version` guard - could still satisfy the check
-- from the winner's write, commit its ledger row and charge the player for a tier it never raised.
--
-- The marker makes the step provable: the row records the economy transaction that last raised it,
-- and a receipt is written only when the row still names *this* transaction. A racing loser names the
-- winner's id, so its batch rolls back whole - no charge, no receipt, no tier jump.
--
-- Additive and nullable: every existing row keeps its tier, capacity and version, and simply has no
-- marker until its next paid upgrade. No data is rewritten, moved or removed.
ALTER TABLE home_island_warehouses ADD COLUMN last_upgrade_transaction_id TEXT
  CHECK (last_upgrade_transaction_id IS NULL OR last_upgrade_transaction_id GLOB 'econ_*');
