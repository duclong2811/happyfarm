import { parsePlayerId, type PlayerId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort } from "@happy-farm/application";

/**
 * Development-only authentication. This module must never be imported by the deployed entrypoint
 * (`src/index.ts`), which authenticates with Cloudflare Access and stays fail-closed without
 * configuration. See `docs/deployment.md` and ADR 0019.
 */
export const DEV_AUTH_BOOTSTRAP_PATH = "/__dev/bootstrap";
export const DEV_PLAYER_DEFAULT_DISPLAY_NAME = "Dev Player";
export const MAX_DEV_BOOTSTRAP_BODY_BYTES = 0;

/** Server-side development bindings. `DEV_AUTH_TOKEN` is a secret and stays out of committed config. */
export interface DevAuthBindings {
  readonly DEV_AUTH_ENABLED?: string;
  readonly DEV_AUTH_TOKEN?: string;
  readonly DEV_PLAYER_ID?: string;
  readonly DEV_AUTH_ISSUER?: string;
  readonly DEV_AUTH_SUBJECT?: string;
  readonly DEV_PLAYER_DISPLAY_NAME?: string;
}

export interface DevAuthConfig {
  readonly enabled: boolean;
  readonly token: string | null;
  readonly playerId: PlayerId | null;
  readonly issuer: string | null;
  readonly subject: string | null;
  readonly displayName: string;
}

/** The single server-configured development identity. The browser never supplies any of it. */
export interface DevIdentity {
  readonly playerId: PlayerId;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
}

function asText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function asPlayerId(value: string | undefined): PlayerId | null {
  const raw = asText(value);
  if (raw === null) {
    return null;
  }
  try {
    return parsePlayerId(raw);
  } catch {
    return null;
  }
}

export function readDevAuthConfig(bindings: DevAuthBindings): DevAuthConfig {
  const displayName = asText(bindings.DEV_PLAYER_DISPLAY_NAME) ?? DEV_PLAYER_DEFAULT_DISPLAY_NAME;
  return {
    enabled: asText(bindings.DEV_AUTH_ENABLED)?.toLowerCase() === "true",
    token: asText(bindings.DEV_AUTH_TOKEN),
    playerId: asPlayerId(bindings.DEV_PLAYER_ID),
    issuer: asText(bindings.DEV_AUTH_ISSUER),
    subject: asText(bindings.DEV_AUTH_SUBJECT),
    displayName: displayName.length > 80 ? DEV_PLAYER_DEFAULT_DISPLAY_NAME : displayName
  };
}

/** Returns the configured identity only when development auth is fully and safely configured. */
export function devIdentity(config: DevAuthConfig): DevIdentity | null {
  if (
    !config.enabled ||
    config.token === null ||
    config.playerId === null ||
    config.issuer === null ||
    config.subject === null
  ) {
    return null;
  }
  return {
    playerId: config.playerId,
    issuer: config.issuer,
    subject: config.subject,
    displayName: config.displayName
  };
}

export function readBearerToken(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) {
    return null;
  }
  const token = match[1];
  return token === undefined ? null : token;
}

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** Compares secrets by hashing both sides, then folding every byte into one accumulator. */
export async function devTokensMatch(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([digest(provided), digest(expected)]);
  if (providedDigest.length !== expectedDigest.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < providedDigest.length; index += 1) {
    difference |= (providedDigest[index] ?? 0) ^ (expectedDigest[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Fails closed: a missing/invalid/disabled configuration, a missing credential, or a
 * mismatched token all resolve to "no actor". Client-supplied identity is never read.
 */
export class DevAuthenticator implements AuthenticationPort<Request> {
  private readonly identity: DevIdentity | null;

  constructor(private readonly config: DevAuthConfig) {
    this.identity = devIdentity(config);
  }

  async authenticate(request: Request): Promise<ActorContext | null> {
    const identity = this.identity;
    const expected = this.config.token;
    if (identity === null || expected === null) {
      return null;
    }
    const provided = readBearerToken(request.headers.get("authorization"));
    if (provided === null) {
      return null;
    }
    if (!(await devTokensMatch(provided, expected))) {
      return null;
    }
    return { playerId: identity.playerId };
  }
}
