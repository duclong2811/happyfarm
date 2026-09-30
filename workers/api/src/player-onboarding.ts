import { parsePlayerId, type Player, type PlayerId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort } from "@happy-farm/application";
import type { AccessIdentity } from "./access-auth";
import type { D1DatabaseLike } from "./d1-types";

/**
 * The deployed onboarding step: a verified Access visitor gets a Player row, and - once - the
 * starter package.
 *
 * Farm, inventory, wallet and progression rows hang off `players(id)`, so an authenticated visitor
 * needs a real Player row before the first command can persist. This is the production counterpart
 * of the development host's onboarding, and does the same two things: create the row if it is
 * missing, and hand the player the one-time starter package they cannot start the game without. It
 * creates no farm and no reward of any other kind.
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

/**
 * Which players the deployed onboarding hands the starter package to.
 *
 * `NEW_PLAYERS` is the safe default and the only policy a production deployment should use: the
 * package goes to a visitor the world is creating a Player row for right now, and an existing
 * player's balance is never touched.
 *
 * `ALL_UNRECEIPTED` additionally repairs a player who exists but has no receipt - the alpha testers
 * created before the package existed, who cannot start the game with no gold and no seeds. It is
 * still one grant per player, because the receipt is the primary key; what changes is only who is
 * *offered* it. A deployment opts into it explicitly, so production isolation stays a decision
 * somebody made rather than a default.
 */
export type StarterGrantPolicy = "NEW_PLAYERS" | "ALL_UNRECEIPTED";

export interface OnboardingOptions {
  /** Applies the one-time starter package. Never called for a player who already has the receipt. */
  readonly grantStarterPackage?: (actor: ActorContext) => Promise<unknown>;
  /** Defaults to `NEW_PLAYERS`, which leaves every existing player's balance alone. */
  readonly starterGrantPolicy?: StarterGrantPolicy;
}

/** Reads the policy binding. Anything unrecognised, including absence, is the safe default. */
export function readStarterGrantPolicy(value: string | undefined): StarterGrantPolicy {
  return value?.trim().toUpperCase() === "ALL_UNRECEIPTED" ? "ALL_UNRECEIPTED" : "NEW_PLAYERS";
}

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
    private readonly clock: { now(): string },
    private readonly options: OnboardingOptions = {}
  ) {}

  async authenticate(request: Request): Promise<ActorContext | null> {
    const identity = await this.access.authenticateIdentity(request);
    if (identity === null) return null;
    let player: OnboardedPlayer | null;
    try {
      player = await this.directory.ensure(identity, this.clock.now());
    } catch {
      // A persistence failure must fail the request, not fall back to an unauthenticated actor.
      return null;
    }
    if (player === null) return null;
    const actor: ActorContext = { playerId: player.playerId };
    const policy = this.options.starterGrantPolicy ?? "NEW_PLAYERS";
    const grant = this.options.grantStarterPackage;
    if (grant !== undefined && (player.created || policy === "ALL_UNRECEIPTED")) {
      try {
        await grant(actor);
      } catch {
        // The visitor is authenticated and must stay that way: a starter package that could not
        // settle is a missing grant, not a broken identity. The receipt is what makes the grant
        // one-time, so the next pass under `ALL_UNRECEIPTED` retries it, and the staging repair
        // script settles it for a player who never comes back.
      }
    }
    return actor;
  }
}
