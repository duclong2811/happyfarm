import { homeIslandZoneRef, type ZoneRef } from "@happy-farm/contracts";

/**
 * Where a player is interacting.
 *
 * The long-term model is World -> Region -> Zone -> Presence -> Interaction, and this is the client's
 * small piece of it: the actor the server told us we are, and the place we are looking at. Today the
 * place is always the player's own island - one farm, one `HOME_ISLAND` zone - but interaction code
 * asks the context instead of assuming the farm, which is what keeps a fishing ground or a contested
 * island from being a rewrite later.
 *
 * **Location is not authority.** This object carries no ownership, no role and no permission, and
 * nothing in the client decides what may be done: every command still travels with the farm it means
 * and is authorized server-side from the authenticated actor. A client that could set its own zone
 * would still be able to do exactly nothing with it.
 */
export interface GameplayContext {
  /** The authenticated player, as the session endpoint reported them, or null before a session. */
  readonly playerId: string | null;
  readonly zone: ZoneRef;
}

/**
 * The context for the island a session is playing on.
 *
 * The zone is derived from the *farm* and the player is recorded beside it, never inside it: two
 * players who were somehow present in the same zone would still be two players, and one player's
 * account says nothing about which zone they are standing in.
 */
export function homeIslandContext(playerId: string | null, farmId: string): GameplayContext {
  return { playerId, zone: homeIslandZoneRef(farmId) };
}

/** Whether two contexts name the same player and the same place. */
export function sameGameplayContext(a: GameplayContext | null, b: GameplayContext | null): boolean {
  if (a === null || b === null) return a === b;
  return a.playerId === b.playerId && a.zone.kind === b.zone.kind && a.zone.zoneId === b.zone.zoneId;
}
