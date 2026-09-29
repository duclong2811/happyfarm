import { parsePlayerId, type Player, type PlayerId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort } from "@happy-farm/application";
import type { AccessIdentity } from "./access-auth";
import type { D1DatabaseLike } from "./d1-types";

/**
 * The production onboarding step: a verified Access visitor gets a Player row.
 *
 * Farm, inventory, wallet and progression rows hang off `players(id)`, so an authenticated visitor
 * needs a real Player row before the first command can persist. This is the production counterpart
 * of the development bootstrap, and deliberately does the same single thing: create the row if it
 * is missing, and nothing else. No wallet, no farm, no items, no ledger, no reward.
 *
 * The id is the one the Access subject hashed to. If a row already exists for that
 * `(issuer, subject)` pair - a seeded tester, a re-deploy, a second Worker instance - the existing
 * row wins and its id is returned, so identity never forks.
 */

export interface OnboardedPlayer {
  readonly playerId: PlayerId;
  readonly status: Player["status"];
  readonly created: boolean;
}

interface PlayerIdentityRow {
  readonly id: string;
  readonly status: Player["status"];
}

const DEFAULT_DISPLAY_NAME = "Farmer";

export class AccessPlayerDirectory {
  constructor(private readonly db: D1DatabaseLike) {}

  /** Idempotent: repeated calls resolve to the same row. */
  async ensure(identity: AccessIdentity, now: string): Promise<OnboardedPlayer | null> {
    // The unique (auth_issuer, auth_subject) index is what makes this safe under concurrency: a
    // racing request inserts nothing instead of creating a second identity for one person.
    const inserted = await this.db
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(identity.playerId, identity.issuer, identity.subject, DEFAULT_DISPLAY_NAME, now, now)
      .run();

    const row = await this.db
      .prepare("SELECT id, status FROM players WHERE auth_issuer = ? AND auth_subject = ?")
      .bind(identity.issuer, identity.subject)
      .first<PlayerIdentityRow>();
    if (row === null) return null;
    return {
      playerId: parsePlayerId(row.id),
      status: row.status,
      created: (inserted.meta.changes ?? 0) > 0
    };
  }
}

/** Authenticator that verifies a request and makes sure the verified visitor has a Player row. */
export class OnboardingAuthenticator implements AuthenticationPort<Request> {
  constructor(
    private readonly access: { authenticateIdentity(request: Request): Promise<AccessIdentity | null> },
    private readonly directory: AccessPlayerDirectory,
    private readonly clock: { now(): string }
  ) {}

  async authenticate(request: Request): Promise<ActorContext | null> {
    const identity = await this.access.authenticateIdentity(request);
    if (identity === null) return null;
    try {
      const player = await this.directory.ensure(identity, this.clock.now());
      return player === null ? null : { playerId: player.playerId };
    } catch {
      // A persistence failure must fail the request, not fall back to an unauthenticated actor.
      return null;
    }
  }
}
