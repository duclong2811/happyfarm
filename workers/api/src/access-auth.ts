import { playerIdFromUuid, type PlayerId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort } from "@happy-farm/application";

/**
 * Cloudflare Access authentication for the staging and production Workers.
 *
 * The browser never sends an identity. Cloudflare Access puts a signed JWT in
 * `Cf-Access-Jwt-Assertion` after it has challenged the visitor, and this module proves that JWT
 * really came from the configured Access application before HappyFarm believes anything in it:
 * signature against the team's published JWKS, `iss`, `aud`, and the token's own validity window.
 * Decoding without verifying is never enough, and no email/custom header is trusted.
 *
 * The Access subject (`sub`) is mapped to a HappyFarm `PlayerId` by hashing the pair
 * `(issuer, subject)`, so the same person always gets the same id and the id carries no PII. Two
 * different Access users cannot collide in practice, and no client can choose either value.
 *
 * Configuration is fail-closed: with no team domain or audience, or with a JWKS that cannot be
 * fetched, `authenticate` resolves to null and every protected route answers NOT_AUTHENTICATED.
 * The development bridge is never consulted, and never imported here.
 */

export interface AccessAuthBindings {
  /** Access team domain, e.g. `https://<team>.cloudflareaccess.com`. */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** Access application audience tag. */
  readonly ACCESS_AUD?: string;
}

export interface AccessAuthConfig {
  readonly teamDomain: string;
  readonly audience: string;
  readonly jwksUrl: string;
}

/** A verified Access visitor, before HappyFarm turns the id into an actor. */
export interface AccessIdentity {
  readonly playerId: PlayerId;
  readonly issuer: string;
  readonly subject: string;
}

/** An authenticator that can also hand back the identity it verified, for onboarding. */
export interface IdentityAuthenticator extends AuthenticationPort<Request> {
  authenticateIdentity(request: Request): Promise<AccessIdentity | null>;
}

/** How long a fetched JWKS may be reused before it is fetched again. */
const JWKS_CACHE_MS = 60 * 60 * 1000;
/** Leeway for clock skew between Cloudflare and the Worker, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

function asText(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Reads the bindings, or null when the deployment is not configured for Access. */
export function readAccessConfig(bindings: AccessAuthBindings): AccessAuthConfig | null {
  const rawDomain = asText(bindings.ACCESS_TEAM_DOMAIN);
  const audience = asText(bindings.ACCESS_AUD);
  if (rawDomain === null || audience === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawDomain);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".cloudflareaccess.com")) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  const teamDomain = `${parsed.protocol}//${parsed.hostname}`;
  // The certificate endpoint is Cloudflare's documented one for an Access team domain.
  return { teamDomain, audience, jwksUrl: `${teamDomain}/cdn-cgi/access/certs` };
}

interface AccessClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: readonly string[];
  readonly exp: number;
  readonly nbf?: number;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson(value: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A verifier is the seam tests inject; production uses the JWKS-backed one below. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<Record<string, unknown> | null>;
}

interface JwkSet {
  readonly keys: readonly Record<string, unknown>[];
}

export interface JwksAccessVerifierOptions {
  readonly jwksUrl: string;
  /** Test seam: production leaves this as the global fetch. */
  readonly fetchJwks?: (url: string) => Promise<unknown>;
  /** Test seam for the clock, in seconds. */
  readonly nowSeconds?: () => number;
}

/**
 * Verifies an Access JWT against the team's JWKS.
 *
 * Only RS256 is accepted: the algorithm comes from the token header but is checked here, so a token
 * cannot ask for `none`, an HMAC algorithm, or anything else the application did not configure.
 */
export function createJwksAccessVerifier(options: JwksAccessVerifierOptions): AccessTokenVerifier {
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const fetchJwks = options.fetchJwks ?? (async (url: string) => (await fetch(url)).json());
  let cached: { readonly at: number; readonly keys: JwkSet } | null = null;

  async function keys(): Promise<JwkSet | null> {
    const now = Date.now();
    if (cached !== null && now - cached.at < JWKS_CACHE_MS) return cached.keys;
    try {
      const payload: unknown = await fetchJwks(options.jwksUrl);
      if (typeof payload !== "object" || payload === null) return null;
      const keys = (payload as { readonly keys?: unknown }).keys;
      if (!Array.isArray(keys)) return null;
      const set: JwkSet = { keys: keys as readonly Record<string, unknown>[] };
      cached = { at: now, keys: set };
      return set;
    } catch {
      return null;
    }
  }

  return {
    async verify(token: string): Promise<Record<string, unknown> | null> {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) return null;
      const header = decodeJson(encodedHeader);
      const claims = decodeJson(encodedPayload);
      const signature = decodeBase64Url(encodedSignature);
      if (header === null || claims === null || signature === null) return null;
      if (header.alg !== "RS256") return null;
      const keyId = header.kid;
      if (typeof keyId !== "string") return null;

      const set = await keys();
      const jwk = set?.keys.find((candidate) => candidate.kid === keyId);
      if (jwk === undefined) return null;
      const modulus = jwk.n;
      const exponent = jwk.e;
      if (typeof modulus !== "string" || typeof exponent !== "string") return null;

      let cryptoKey: CryptoKey;
      try {
        cryptoKey = await crypto.subtle.importKey(
          "jwk",
          { kty: "RSA", n: modulus, e: exponent, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"]
        );
      } catch {
        return null;
      }
      const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
      const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signed);
      if (!valid) return null;
      if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds()) return null;
      if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds()) return null;
      return claims;
    }
  };
}

function readClaims(claims: Record<string, unknown>, config: AccessAuthConfig): AccessClaims | null {
  const issuer = claims.iss;
  const subject = claims.sub;
  const rawAudience = claims.aud;
  const expiry = claims.exp;
  if (typeof issuer !== "string" || typeof subject !== "string" || subject.length === 0) return null;
  if (issuer !== config.teamDomain) return null;
  const audience = Array.isArray(rawAudience)
    ? rawAudience.filter((entry): entry is string => typeof entry === "string")
    : typeof rawAudience === "string"
      ? [rawAudience]
      : [];
  if (!audience.includes(config.audience)) return null;
  if (typeof expiry !== "number") return null;
  return {
    iss: issuer,
    sub: subject,
    aud: audience,
    exp: expiry,
    ...(typeof claims.nbf === "number" ? { nbf: claims.nbf } : {})
  };
}

/**
 * The deterministic HappyFarm id for an Access identity.
 *
 * `player_<uuid v5 form>` is derived from the issuer and subject, so it is stable across logins,
 * different for different subjects, and reveals nothing about the person.
 */
export async function playerIdForAccessSubject(issuer: string, subject: string): Promise<PlayerId> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`happy-farm/access\u0000${issuer}\u0000${subject}`))
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return playerIdFromUuid(uuid);
}

export interface CloudflareAccessAuthenticatorOptions extends AccessAuthBindings {
  /** Test seam; production builds the JWKS verifier from the team domain. */
  readonly verifier?: AccessTokenVerifier;
}

/** The Access authenticator. Missing configuration, missing token, or any invalid claim → null. */
export class CloudflareAccessAuthenticator implements IdentityAuthenticator {
  private readonly config: AccessAuthConfig | null;
  private readonly verifier: AccessTokenVerifier | null;

  constructor(options: CloudflareAccessAuthenticatorOptions) {
    this.config = readAccessConfig(options);
    this.verifier =
      options.verifier ?? (this.config === null ? null : createJwksAccessVerifier({ jwksUrl: this.config.jwksUrl }));
  }

  /** Whether this deployment can authenticate anyone at all. */
  get configured(): boolean {
    return this.config !== null && this.verifier !== null;
  }

  async authenticateIdentity(request: Request): Promise<AccessIdentity | null> {
    const config = this.config;
    const verifier = this.verifier;
    if (config === null || verifier === null) return null;
    const raw = request.headers.get(ACCESS_JWT_HEADER);
    if (raw === null || raw.length === 0 || raw.length > 8192) return null;
    const verified = await verifier.verify(raw);
    if (verified === null) return null;
    const claims = readClaims(verified, config);
    if (claims === null) return null;
    return {
      playerId: await playerIdForAccessSubject(claims.iss, claims.sub),
      issuer: claims.iss,
      subject: claims.sub
    };
  }

  async authenticate(request: Request): Promise<ActorContext | null> {
    const identity = await this.authenticateIdentity(request);
    return identity === null ? null : { playerId: identity.playerId };
  }
}
