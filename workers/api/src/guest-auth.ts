import { parsePlayerId, playerIdFromUuid, type IdentityKind, type PlayerId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort, Clock } from "@happy-farm/application";
import type { D1DatabaseLike } from "./d1-types";
import type { EstablishedSession, SessionPort } from "./session";

/**
 * Anonymous guest sessions: the public alpha's authentication path.
 *
 * A guest is not a throwaway farm. It is a real Player whose current identity happens to be an
 * unguessable bearer credential, stored as an opaque cookie. The credential is 256 bits from
 * `crypto.getRandomValues`, never `Math.random`, and only its SHA-256 is written to the database, so
 * a database leak does not hand out usable sessions. That single fact is also what will let a guest
 * link a Google or email account later: `player_identities` already maps several identities onto one
 * player, so upgrading the credential leaves the farm untouched.
 *
 * The browser proves nothing else. There is no `?player=`, no trusted local-storage id, no
 * fingerprinting, and no client-selected identity anywhere in this file.
 *
 * Everything here is policy-gated: `GUEST_AUTH_ENABLED` is read once, at the authentication
 * boundary, and defaults to off. Production therefore stays fail-closed without a single
 * `if (staging)` appearing near a route.
 */

export const GUEST_COOKIE_NAME = "hf_guest";
/** Guest identities live in their own namespace, so a guest can never collide with an Access subject. */
export const GUEST_IDENTITY_ISSUER = "happy-farm/guest";
export const GUEST_CREDENTIAL_BYTES = 32;
/**
 * Six months.
 *
 * Alpha testers come back after days or weeks, so a session that expires in minutes would strand
 * their farm behind a fresh identity. Six months is long enough to be a real "come back later" and
 * short enough not to be an immortal credential; revocation, when it is wanted, is deleting the
 * identity row.
 */
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
/** How stale `last_seen_at` may get before a session request refreshes it. */
const GUEST_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GUEST_DISPLAY_NAME = "Farmer";
/** 32 random bytes, base64url, without padding. */
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readGuestAuthEnabled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh guest credential. Cryptographically random, Cloudflare-Worker-safe. */
export function generateGuestCredential(): string {
  const bytes = new Uint8Array(GUEST_CREDENTIAL_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** The value stored server-side for a credential: never the credential itself. */
export async function hashGuestCredential(credential: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The cookie that carries a guest credential.
 *
 * `HttpOnly` keeps the credential out of reach of page scripts, `Secure` keeps it off plain HTTP,
 * `SameSite=Lax` stops a cross-site request from carrying it, and the request path is the whole
 * origin. No `Domain` attribute, so the cookie is scoped to exactly the host that set it.
 */
export function guestCookieHeader(
  credential: string,
  maxAgeSeconds: number = GUEST_SESSION_MAX_AGE_SECONDS
): string {
  return `${GUEST_COOKIE_NAME}=${credential}; Path=/; Max-Age=${String(maxAgeSeconds)}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Reads the guest credential from a `Cookie` header.
 *
 * A missing, malformed, or over-long cookie is "no guest session", never a crash and never a
 * partial match against somebody else's identity.
 */
export function readGuestCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader.length > 4096) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== GUEST_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return CREDENTIAL_PATTERN.test(value) ? value : null;
  }
  return null;
}

/**
 * The deterministic player id for a guest identity.
 *
 * Derived from the credential's hash exactly like an Access subject is derived from `(issuer,
 * subject)`: the same credential always resolves to the same player, a different one to a different
 * player, and the id reveals nothing about the credential. The namespace differs from Access, so
 * the two id spaces cannot collide.
 */
export async function guestPlayerId(subject: string): Promise<PlayerId> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`happy-farm/guest\u0000${subject}`)
    )
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return playerIdFromUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

interface GuestIdentityRow {
  readonly id: string;
  readonly player_id: string;
  readonly last_seen_at: string;
}

export interface ResolvedGuestIdentity {
  readonly identityId: string;
  readonly playerId: PlayerId;
  readonly lastSeenAt: string;
}

/**
 * The guest half of the identity table.
 *
 * Ownership is by credential hash: a row is reachable only by presenting the credential whose hash
 * it stores, so guessing, truncating, or editing a credential cannot reach another guest's player.
 */
export class D1GuestDirectory {
  constructor(private readonly db: D1DatabaseLike) {}

  async find(subject: string): Promise<ResolvedGuestIdentity | null> {
    const row = await this.db
      .prepare(
        "SELECT id, player_id, last_seen_at FROM player_identities WHERE kind = 'GUEST' AND issuer = ? AND subject = ?"
      )
      .bind(GUEST_IDENTITY_ISSUER, subject)
      .first<GuestIdentityRow>();
    if (row === null) return null;
    return {
      identityId: row.id,
      playerId: parsePlayerId(row.player_id),
      lastSeenAt: row.last_seen_at
    };
  }

  /**
   * Creates the player and its guest identity if they do not exist.
   *
   * Both inserts are `ON CONFLICT DO NOTHING`: the id is derived from the credential hash, so two
   * racing bootstraps for one credential settle on one player instead of two. `created` reports
   * whether *this* call created the player, which is what the starter-package policy keys off.
   */
  async ensure(
    subject: string,
    now: string
  ): Promise<{ readonly identityId: string; readonly playerId: PlayerId; readonly created: boolean } | null> {
    const playerId = await guestPlayerId(subject);
    const playerInsert = await this.db
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(playerId, GUEST_IDENTITY_ISSUER, subject, GUEST_DISPLAY_NAME, now, now)
      .run();
    await this.db
      .prepare(
        "INSERT INTO player_identities (id, player_id, kind, issuer, subject, created_at, last_seen_at) VALUES (?, ?, 'GUEST', ?, ?, ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(`identity_guest_${subject}`, playerId, GUEST_IDENTITY_ISSUER, subject, now, now)
      .run();
    const resolved = await this.find(subject);
    if (resolved === null) return null;
    return {
      identityId: resolved.identityId,
      playerId: resolved.playerId,
      created: (playerInsert.meta.changes ?? 0) > 0
    };
  }

  /**
   * Refreshes `last_seen_at` when it has gone stale.
   *
   * One conditional statement, and usually zero rows: a guest who plays every day costs one
   * indexed write a day, not one per request.
   */
  async touchIfStale(identityId: string, now: string): Promise<void> {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) return;
    const threshold = new Date(nowMs - GUEST_TOUCH_INTERVAL_MS).toISOString();
    await this.db
      .prepare("UPDATE player_identities SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?")
      .bind(now, identityId, threshold)
      .run();
  }
}

/** A verified identity that is stronger than a guest credential, with the kind that proves it. */
export interface StrongIdentityPort {
  authenticateIdentity(request: Request): Promise<{ readonly playerId: PlayerId; readonly kind: IdentityKind } | null>;
}

/**
 * Resolves an existing guest session. Never mints one.
 *
 * This is what every ordinary route sees: a cookie that resolves to a player is an actor, and
 * anything else - absent, malformed, unknown - is simply "not authenticated". Establishment is the
 * session endpoint's job and nowhere else.
 */
export class GuestAuthenticator implements AuthenticationPort<Request> {
  constructor(
    private readonly options: {
      readonly enabled: boolean;
      readonly directory: D1GuestDirectory;
    }
  ) {}

  async authenticate(request: Request): Promise<ActorContext | null> {
    if (!this.options.enabled) return null;
    const credential = readGuestCookie(request.headers.get("cookie"));
    if (credential === null) return null;
    const subject = await hashGuestCredential(credential);
    const resolved = await this.options.directory.find(subject);
    return resolved === null ? null : { playerId: resolved.playerId };
  }
}

/**
 * Cloudflare Access first, guest second.
 *
 * A verified strong identity always wins, so a browser that has both is the Access player and never
 * the anonymous one. The fallback is the guest resolver above, which means a request cannot mint a
 * player by being refused: it just answers NOT_AUTHENTICATED.
 */
export class CompositeAuthenticator implements AuthenticationPort<Request> {
  constructor(
    private readonly primary: AuthenticationPort<Request>,
    private readonly fallback: AuthenticationPort<Request>
  ) {}

  async authenticate(request: Request): Promise<ActorContext | null> {
    return (await this.primary.authenticate(request)) ?? (await this.fallback.authenticate(request));
  }
}

export interface GuestSessionOptions {
  readonly enabled: boolean;
  readonly clock: Clock;
  readonly directory: D1GuestDirectory;
  /** The verified paths that outrank a guest credential (Cloudflare Access today). */
  readonly strong: StrongIdentityPort;
  /** The one-time starter package, applied through the shared application use case. */
  readonly grantStarterPackage?: (actor: ActorContext) => Promise<unknown>;
  /** Whether a player who exists without a receipt may still be repaired. Defaults to NEW_PLAYERS. */
  readonly starterGrantPolicy?: "NEW_PLAYERS" | "ALL_UNRECEIPTED";
}

/**
 * `GET /session`: who the caller is, and - the first time - the credential that makes them them.
 *
 * A first visit mints a credential, creates the player and identity, hands over the one-time starter
 * package, and returns the `Set-Cookie`. A return visit resolves the same player and returns nothing
 * to set. An *invalid* cookie is treated as "no session" and mints a new identity - never adoption
 * of an existing player, which is the only safe reading of a credential nobody can prove.
 */
export class GuestSessionService implements AuthenticationPort<Request>, SessionPort {
  private readonly guest: GuestAuthenticator;

  constructor(private readonly options: GuestSessionOptions) {
    this.guest = new GuestAuthenticator({ enabled: options.enabled, directory: options.directory });
  }

  authenticate(request: Request): Promise<ActorContext | null> {
    return this.guest.authenticate(request);
  }

  async establish(request: Request): Promise<EstablishedSession | null> {
    const strong = await this.options.strong.authenticateIdentity(request);
    if (strong !== null) return strong;
    if (!this.options.enabled) return null;

    const credential = readGuestCookie(request.headers.get("cookie"));
    if (credential !== null) {
      const resolved = await this.options.directory.find(await hashGuestCredential(credential));
      if (resolved !== null) {
        await this.options.directory.touchIfStale(resolved.identityId, this.options.clock.now());
        await this.ensureStarterPackage(resolved.playerId, false);
        return { playerId: resolved.playerId, kind: "GUEST" };
      }
    }
    return this.mintGuest();
  }

  private async mintGuest(): Promise<EstablishedSession | null> {
    const credential = generateGuestCredential();
    const created = await this.options.directory.ensure(
      await hashGuestCredential(credential),
      this.options.clock.now()
    );
    if (created === null) return null;
    await this.ensureStarterPackage(created.playerId, created.created);
    return { playerId: created.playerId, kind: "GUEST", setCookie: guestCookieHeader(credential) };
  }

  /**
   * Applies the one-time starter package, exactly as the Access onboarding does.
   *
   * A guest who could not be granted still keeps their identity: the receipt makes the grant
   * one-time, so the next session request under `ALL_UNRECEIPTED` retries it rather than the page
   * failing to start.
   */
  private async ensureStarterPackage(playerId: PlayerId, created: boolean): Promise<void> {
    const grant = this.options.grantStarterPackage;
    if (grant === undefined) return;
    const policy = this.options.starterGrantPolicy ?? "NEW_PLAYERS";
    if (!created && policy !== "ALL_UNRECEIPTED") return;
    try {
      await grant({ playerId });
    } catch {
      // A missing grant is not a broken identity; the receipt is what makes it one-time.
    }
  }
}
