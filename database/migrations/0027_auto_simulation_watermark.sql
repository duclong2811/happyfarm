-- V16.2.2D3A: server-time Auto reconciliation watermark.
-- NULL is intentional for existing actors: first AUTO observation initializes at server now.
ALTER TABLE actor_auto_state ADD COLUMN simulation_at TEXT;
