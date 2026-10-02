import type { IdentityKind, PlayerId } from "@happy-farm/domain";

/**
 * The session endpoint's contract with the handler.
 *
 * Establishing a session is deliberately its own request rather than a side effect of every route.
 * The client asks once at boot, the server answers with who the caller is and - the first time - a
 * `Set-Cookie` carrying the new guest credential. Ordinary gameplay routes only ever *resolve* an
 * existing identity, so no read or command can mint a player as a side effect of being called.
 */
export interface EstablishedSession {
  readonly playerId: PlayerId;
  readonly kind: IdentityKind;
  /**
   * The `Set-Cookie` header for a credential minted by this request.
   *
   * Absent when the caller already had an identity (an existing guest cookie, or a verified Access
   * assertion), because then this request changed nothing and has nothing to hand back.
   */
  readonly setCookie?: string;
}

export interface SessionPort {
  /**
   * Resolves the caller's identity, establishing one when the deployment allows it.
   *
   * Returns null when the deployment has guest access switched off and the caller presented no
   * verified identity. That is the production default, and it answers NOT_AUTHENTICATED rather than
   * inventing a player.
   */
  establish(request: Request): Promise<EstablishedSession | null>;
}
