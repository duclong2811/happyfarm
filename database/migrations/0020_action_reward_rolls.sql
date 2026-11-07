-- A payout rollback must not discard entropy already chosen for an action.
-- Nullable for existing actions, populated once on their first eligible settlement.
ALTER TABLE fishing_actions ADD COLUMN reward_roll REAL
  CHECK (reward_roll IS NULL OR (reward_roll >= 0 AND reward_roll < 1));
ALTER TABLE resource_actions ADD COLUMN reward_roll REAL
  CHECK (reward_roll IS NULL OR (reward_roll >= 0 AND reward_roll < 1));
ALTER TABLE resource_actions ADD COLUMN quantity_roll REAL
  CHECK (quantity_roll IS NULL OR (quantity_roll >= 0 AND quantity_roll < 1));

CREATE TRIGGER fishing_reward_roll_immutable
BEFORE UPDATE OF reward_roll ON fishing_actions
WHEN OLD.reward_roll IS NOT NULL AND NEW.reward_roll IS NOT OLD.reward_roll
BEGIN
  SELECT RAISE(ABORT, 'action reward roll is immutable');
END;

CREATE TRIGGER resource_reward_rolls_immutable
BEFORE UPDATE OF reward_roll, quantity_roll ON resource_actions
WHEN (OLD.reward_roll IS NOT NULL AND NEW.reward_roll IS NOT OLD.reward_roll)
  OR (OLD.quantity_roll IS NOT NULL AND NEW.quantity_roll IS NOT OLD.quantity_roll)
BEGIN
  SELECT RAISE(ABORT, 'action reward rolls are immutable');
END;
