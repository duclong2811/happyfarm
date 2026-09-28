import { parsePlayerId, type Player, type PlayerId } from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";
import type { DevIdentity } from "./dev-auth";

interface PlayerIdentityRow {
  readonly id: string;
  readonly auth_issuer: string;
  readonly auth_subject: string;
  readonly status: Player["status"];
}

export interface DevBootstrapResult {
  readonly playerId: PlayerId;
  readonly status: Player["status"];
  readonly created: boolean;
}

/**
 * Development-only bootstrap for the single configured dev player.
 *
 * Farm and economy rows use `players(id)` foreign keys, so a configured dev actor needs a real
 * Player row before any gameplay command can persist. This adapter creates nothing else: no
 * wallet, inventory, farm, crop, progression, or ledger state.
 */
export class DevPlayerBootstrap {
  constructor(private readonly db: D1DatabaseLike) {}

  /** Idempotent: repeated calls resolve to the same row via the player id / (issuer, subject) keys. */
  async ensure(identity: DevIdentity, now: string): Promise<DevBootstrapResult | null> {
    const inserted = await this.db
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(identity.playerId, identity.issuer, identity.subject, identity.displayName, now, now)
      .run();
    const row = await this.db
      .prepare("SELECT id, auth_issuer, auth_subject, status FROM players WHERE id = ?")
      .bind(identity.playerId)
      .first<PlayerIdentityRow>();
    if (row === null) {
      return null;
    }
    if (row.auth_issuer !== identity.issuer || row.auth_subject !== identity.subject) {
      return null;
    }
    return {
      playerId: parsePlayerId(row.id),
      status: row.status,
      created: (inserted.meta.changes ?? 0) > 0
    };
  }
}
