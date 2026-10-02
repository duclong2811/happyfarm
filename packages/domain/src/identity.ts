import type { PlayerId } from "./ids";

/**
 * The ways a player can prove who they are.
 *
 * A player is the durable gameplay owner; an identity is one credential that resolves to them. The
 * distinction is the whole point of this module: a guest who later signs in with Google must keep
 * the same player - and therefore the same farm, wallet, inventory and world - rather than becoming
 * a second account beside their own progress.
 *
 * `GUEST` is an anonymous bearer credential, `CLOUDFLARE_ACCESS` is the verified Access subject that
 * staging and production use, and `GOOGLE`/`EMAIL` are the identities a future linking pass will
 * attach. Nothing here depends on a transport, a database, or a crypto implementation: these are the
 * rules, and the identity repository is what makes the database enforce them.
 */
export const IDENTITY_KINDS = ["GUEST", "CLOUDFLARE_ACCESS", "GOOGLE", "EMAIL"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

/** One identity, and the player it proves. */
export interface PlayerIdentity {
  readonly playerId: PlayerId;
  readonly kind: IdentityKind;
  readonly issuer: string;
  readonly subject: string;
}

/**
 * The one key an identity is unique on, inside its kind.
 *
 * Two rows with the same key *are* the same identity, whatever else they carry, which is why the
 * database has a matching unique index. The separator is a NUL because no issuer or subject may
 * contain one, so no pair of distinct identities can be spelled into the same key.
 */
export function identityKey(identity: Pick<PlayerIdentity, "kind" | "issuer" | "subject">): string {
  return `${identity.kind}\u0000${identity.issuer}\u0000${identity.subject}`;
}

export type AttachIdentityResult =
  | {
      readonly ok: true;
      /** Whether the identity was new; `false` means it already resolved to this player. */
      readonly attached: boolean;
      readonly identities: readonly PlayerIdentity[];
    }
  | {
      /**
       * The identity already belongs to a *different* player.
       *
       * Refusing is the whole point: merging two players' progress is a decision a human has to
       * make, so an automatic link must never quietly move somebody else's farm. The future linking
       * pass owns that policy; this rule only refuses to guess.
       */
      readonly ok: false;
      readonly reason: "IDENTITY_ALREADY_LINKED";
      readonly ownerPlayerId: PlayerId;
    };

/**
 * Attaches one identity to a player, or refuses when it already belongs to someone else.
 *
 * Pure: the caller keeps the list, and the database keeps the same invariant with its unique
 * `(kind, issuer, subject)` index. Attaching an identity the player already has is not an error and
 * changes nothing, so a replayed link request is harmless.
 */
export function attachIdentity(
  existing: readonly PlayerIdentity[],
  next: PlayerIdentity
): AttachIdentityResult {
  const key = identityKey(next);
  for (const identity of existing) {
    if (identityKey(identity) !== key) continue;
    if (identity.playerId === next.playerId) {
      return { ok: true, attached: false, identities: existing };
    }
    return { ok: false, reason: "IDENTITY_ALREADY_LINKED", ownerPlayerId: identity.playerId };
  }
  return { ok: true, attached: true, identities: [...existing, next] };
}

/**
 * The identity a player resolves to for one key, or null when nobody owns it yet.
 *
 * Reads are the only thing the gameplay path does with this model: the actor comes from the
 * identity, and every ownership check still happens against the player the identity names.
 */
export function resolveIdentity(
  identities: readonly PlayerIdentity[],
  key: Pick<PlayerIdentity, "kind" | "issuer" | "subject">
): PlayerIdentity | null {
  const wanted = identityKey(key);
  return identities.find((identity) => identityKey(identity) === wanted) ?? null;
}
