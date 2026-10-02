import { describe, expect, it } from "vitest";
import {
  HOME_ISLAND_ZONE_PREFIX,
  ZoneRefSchema,
  farmIdFromHomeIslandZone,
  homeIslandZoneRef
} from "@happy-farm/contracts";
import { homeIslandContext, sameGameplayContext } from "../../apps/web/src/interaction/context";

/**
 * Where a player is, versus who they are.
 *
 * The whole point of V14.1's world work is that the game stops saying "the player's farm" everywhere
 * and starts saying "the zone the player is in". These tests pin the three facts that keep that
 * honest: the current world resolves to a HOME_ISLAND zone derived from the farm, the *place* is not
 * the *person*, and a zone reference is never a capability.
 */

const FARM_A = "farm_11111111-1111-4111-8111-111111111111";
const FARM_B = "farm_22222222-2222-4222-8222-222222222222";
const PLAYER_A = "player_33333333-3333-4333-8333-333333333333";
const PLAYER_B = "player_44444444-4444-4444-8444-444444444444";

describe("the current world as a zone", () => {
  it("resolves the farm the player is on to one HOME_ISLAND zone", () => {
    const zone = homeIslandZoneRef(FARM_A);
    expect(zone.kind).toBe("HOME_ISLAND");
    expect(zone.zoneId).toBe(`${HOME_ISLAND_ZONE_PREFIX}${FARM_A}`);
    // It is a well-formed reference, so it could one day travel on the wire.
    expect(ZoneRefSchema.safeParse(zone).success).toBe(true);
  });

  it("gives the same farm the same zone and different farms different zones", () => {
    expect(homeIslandZoneRef(FARM_A)).toEqual(homeIslandZoneRef(FARM_A));
    expect(homeIslandZoneRef(FARM_A)).not.toEqual(homeIslandZoneRef(FARM_B));
  });

  it("carries a location and nothing else", () => {
    // The exact shape matters: a reference with room for an owner, a role or a permission would
    // eventually grow one, and location would start to mean authority.
    expect(Object.keys(homeIslandZoneRef(FARM_A)).sort()).toEqual(["kind", "zoneId"]);
    expect(JSON.stringify(homeIslandZoneRef(FARM_A))).not.toContain("player_");
  });

  it("maps back to the farm it was derived from, and to nothing for any other kind of place", () => {
    expect(farmIdFromHomeIslandZone(homeIslandZoneRef(FARM_A))).toBe(FARM_A);
    // A shared fishing ground is not a farm, however it is spelled: the reverse lookup refuses by kind.
    expect(
      farmIdFromHomeIslandZone({ kind: "SHARED_FISHING", zoneId: `${HOME_ISLAND_ZONE_PREFIX}${FARM_A}` })
    ).toBeNull();
    expect(farmIdFromHomeIslandZone({ kind: "HOME_ISLAND", zoneId: "zone_home_island_" })).toBeNull();
  });
});

describe("a gameplay context", () => {
  it("keeps the player and the place apart", () => {
    const context = homeIslandContext(PLAYER_A, FARM_A);
    expect(context.playerId).toBe(PLAYER_A);
    expect(context.zone).toEqual(homeIslandZoneRef(FARM_A));
    // The zone says nothing about who is standing in it: two players on the same island share the
    // zone and stay two players.
    expect(homeIslandContext(PLAYER_B, FARM_A).zone).toEqual(context.zone);
    expect(homeIslandContext(PLAYER_B, FARM_A).playerId).not.toBe(context.playerId);
    expect(sameGameplayContext(homeIslandContext(PLAYER_B, FARM_A), context)).toBe(false);
  });

  it("has no context at all before a session has told the page who it is playing as", () => {
    // The page records the server's answer; a dev host with no session endpoint has no player id, and
    // the context still names the place honestly rather than inventing an actor.
    const anonymous = homeIslandContext(null, FARM_A);
    expect(anonymous.playerId).toBeNull();
    expect(anonymous.zone).toEqual(homeIslandZoneRef(FARM_A));
    expect(sameGameplayContext(anonymous, anonymous)).toBe(true);
    expect(sameGameplayContext(null, anonymous)).toBe(false);
  });

  it("changes when the player moves to another island, and only then", () => {
    const here = homeIslandContext(PLAYER_A, FARM_A);
    const elsewhere = homeIslandContext(PLAYER_A, FARM_B);
    expect(sameGameplayContext(here, elsewhere)).toBe(false);
    expect(sameGameplayContext(here, homeIslandContext(PLAYER_A, FARM_A))).toBe(true);
  });
});
