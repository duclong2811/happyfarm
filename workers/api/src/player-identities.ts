import { parsePlayerId, type IdentityKind, type PlayerId } from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";

/**
 * The persistent player-identity table (migration `0015`).
 *
 * `players` is the durable gameplay owner and keeps its `(auth_issuer, auth_subject)` pair as the
 * player's primary identity, for backwards compatibility. This table is what the world actually
 * resolves through when a request has to answer "which player is this?" - and, unlike the single
 * pair on `players`, it can hold several identities for one player, which is what will let a guest
 * link a Google or email account without losing their farm.
 *
 * Writes are insert-or-nothing and the read-back is what decides: a racing request that loses the
 * unique `(kind, issuer, subject)` index reads the winner's row instead of forking a player.
 */
export interface AttachableIdentity {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly kind: IdentityKind;
  readonly issuer: string;
  readonly subject: string;
}

interface PlayerIdentityRow {
  readonly player_id: string;
}

export class D1PlayerIdentityRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  /** The player this identity resolves to, or null when nobody owns it. */
  async find(kind: IdentityKind, issuer: string, subject: string): Promise<PlayerId | null> {
    const row = await this.db
      .prepare("SELECT player_id FROM player_identities WHERE kind = ? AND issuer = ? AND subject = ?")
      .bind(kind, issuer, subject)
      .first<PlayerIdentityRow>();
    return row === null ? null : parsePlayerId(row.player_id);
  }

  /**
   * Links an identity to a player, idempotently.
   *
   * Returns the player the key ended up owned by, which is `input.playerId` for a fresh link and
   * the existing owner when the key was already taken. Callers that must not silently move an
   * identity compare the two - and, for a link request, refuse the mismatch instead of merging.
   */
  async attach(input: AttachableIdentity, now: string): Promise<PlayerId | null> {
    await this.db
      .prepare(
        "INSERT INTO player_identities (id, player_id, kind, issuer, subject, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(input.id, input.playerId, input.kind, input.issuer, input.subject, now, now)
      .run();
    return this.find(input.kind, input.issuer, input.subject);
  }
}
