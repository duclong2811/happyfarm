-- V13.6.2: player identities.
--
-- A Player is the durable gameplay owner: the farm, wallet, inventory, progression and world all
-- hang off `players(id)`. An *identity* is one way of proving who that player is. Today a player is
-- proved either by a Cloudflare Access subject (the staging and production path) or by an anonymous
-- guest bearer credential; later a Google or email account joins the list.
--
-- Several identities may point at one player, which is exactly what makes "link an account later
-- without losing the farm" a schema-level possibility instead of a redesign. Guest is therefore an
-- authentication state, never a throwaway farm: the same player row survives the upgrade.
--
-- Additive and forward-only. `players` keeps its columns, and its existing (auth_issuer,
-- auth_subject) pair stays the player's *primary* identity; that pair is still NOT NULL and still
-- unique, so nothing about the old code path changes. No table is rebuilt and no row is rewritten.
-- Every player that exists when this migration runs is backfilled as a CLOUDFLARE_ACCESS identity.
--
-- A GUEST identity's subject is the SHA-256 hex of its bearer credential. The credential itself is
-- never stored, so a database leak does not hand an attacker a usable guest session.
--
-- Note for anyone editing this file: comments are line comments (`--`), never block comments, and
-- no comment contains a semicolon. Wrangler's statement splitter does not understand a block
-- comment, and a semicolon inside one splits the statement - see docs/deployment/STAGING.md.
CREATE TABLE player_identities (
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('GUEST', 'CLOUDFLARE_ACCESS', 'GOOGLE', 'EMAIL')),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (kind, issuer, subject)
);

CREATE INDEX idx_player_identities_player_id ON player_identities(player_id);

-- Backfill: every existing player row is a Cloudflare Access identity (the development host's
-- single identity uses the same shape with its own issuer). The id is derived from the player id so
-- the insert is deterministic, and the unique (kind, issuer, subject) index keeps it one row.
INSERT INTO player_identities (id, player_id, kind, issuer, subject, created_at, last_seen_at)
SELECT 'identity_access_' || id, id, 'CLOUDFLARE_ACCESS', auth_issuer, auth_subject, created_at, updated_at
FROM players;
