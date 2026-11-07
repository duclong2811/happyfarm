-- V16.2.2D5: remember when the current short Main Character lease was issued.
-- This distinguishes a valid 180-second renewal from a legacy 24-hour lease that extends beyond the
-- old watermark. It is local additive state; no remote migration is applied by this task.
ALTER TABLE actor_auto_state ADD COLUMN lease_issued_at TEXT;

UPDATE actor_auto_state
SET lease_issued_at = updated_at
WHERE lease_issued_at IS NULL;
