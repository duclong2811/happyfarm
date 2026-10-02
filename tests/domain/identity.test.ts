import { describe, expect, it } from "vitest";
import { attachIdentity, identityKey, resolveIdentity, type PlayerIdentity } from "@happy-farm/domain";
import { FARM_ONE_ID, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * The identity rules, pure and without a database.
 *
 * These pin the architecture the alpha's guest mode is built on: an identity resolves to exactly one
 * player, a player may hold several identities, and a second player's identity is never quietly
 * absorbed. Farm ownership is untouched by all of it - `farms.owner_player_id` still names a player,
 * so every one of these cases leaves the farm exactly where it was.
 */
function identity(
  playerId: PlayerIdentity["playerId"],
  kind: PlayerIdentity["kind"],
  issuer: string,
  subject: string
): PlayerIdentity {
  return { playerId, kind, issuer, subject };
}

const guest = identity(PLAYER_ONE_ID, "GUEST", "happy-farm/guest", "a".repeat(64));
const google = identity(PLAYER_ONE_ID, "GOOGLE", "https://accounts.google.com", "google-subject-one");

describe("identity keys", () => {
  it("is stable for the same identity and different across kind, issuer, and subject", () => {
    expect(identityKey(guest)).toBe(identityKey({ ...guest }));
    expect(identityKey(guest)).not.toBe(identityKey(google));
    expect(identityKey(guest)).not.toBe(identityKey({ ...guest, subject: "b".repeat(64) }));
    expect(identityKey(guest)).not.toBe(identityKey({ ...guest, kind: "EMAIL" }));
    expect(identityKey(guest)).not.toBe(identityKey({ ...guest, issuer: "happy-farm/other" }));
  });

  it("distinguishes two identities whose issuer and subject are swapped", () => {
    // The separator is a NUL, which no issuer or subject may contain, so the fields cannot be
    // rearranged into each other's key.
    const first = identityKey({ kind: "GUEST", issuer: "issuer-a", subject: "subject-b" });
    const second = identityKey({ kind: "GUEST", issuer: "subject-b", subject: "issuer-a" });
    expect(first).not.toBe(second);
  });
});

describe("attaching identities to a player", () => {
  it("resolves the guest identity to the player that owns it", () => {
    expect(resolveIdentity([guest], guest)?.playerId).toBe(PLAYER_ONE_ID);
    expect(resolveIdentity([guest], identity(PLAYER_ONE_ID, "GUEST", "happy-farm/guest", "c".repeat(64)))).toBeNull();
  });

  it("keeps one player when a second identity is attached, so the farm survives the upgrade", () => {
    const attached = attachIdentity([guest], google);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.attached).toBe(true);
    // Both identities now name the same player, which is what leaves `farms.owner_player_id`
    // pointing at one unchanged farm rather than a second one.
    expect(resolveIdentity(attached.identities, guest)?.playerId).toBe(PLAYER_ONE_ID);
    expect(resolveIdentity(attached.identities, google)?.playerId).toBe(PLAYER_ONE_ID);
    expect(new Set(attached.identities.map((entry) => entry.playerId))).toEqual(new Set([PLAYER_ONE_ID]));
    expect(FARM_ONE_ID).toMatch(/^farm_/);
  });

  it("treats re-attaching an identity the player already has as a no-op", () => {
    const attached = attachIdentity([guest, google], { ...guest });
    expect(attached).toEqual({ ok: true, attached: false, identities: [guest, google] });
  });

  it("refuses to move an identity that already belongs to another player", () => {
    const otherGuest = identity(PLAYER_TWO_ID, "GUEST", "happy-farm/guest", "d".repeat(64));
    const conflict = attachIdentity([guest, otherGuest], identity(PLAYER_ONE_ID, "GUEST", "happy-farm/guest", otherGuest.subject));
    expect(conflict).toEqual({
      ok: false,
      reason: "IDENTITY_ALREADY_LINKED",
      ownerPlayerId: PLAYER_TWO_ID
    });
  });
});
