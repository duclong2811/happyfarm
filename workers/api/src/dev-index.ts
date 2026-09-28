import type { ApiFailure, ApiSuccess, ErrorCode } from "@happy-farm/contracts";
import { createHandler } from "./handler";
import {
  DEV_AUTH_BOOTSTRAP_PATH,
  DevAuthenticator,
  devIdentity,
  readDevAuthConfig,
  type DevAuthBindings
} from "./dev-auth";
import { DevPlayerBootstrap, type DevBootstrapResult } from "./dev-player-repository";
import {
  CryptoIdGenerator,
  GameDataCurrencyDefinitions,
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  GameDataShopEntries,
  Sha256Fingerprint,
  SystemClock
} from "./runtime";
import type { D1DatabaseLike } from "./d1-types";

/**
 * DEVELOPMENT-ONLY Worker entrypoint.
 *
 * Isolation contract:
 * - `src/index.ts` remains the production entrypoint and still wires `UnconfiguredAuthenticator`.
 * - This file is selected only by `wrangler.dev.toml`; production config never references it.
 * - `DevAuthenticator` and the `/__dev/bootstrap` route exist only here and in `dev-auth.ts`.
 *
 * Authentication is limited to one server-configured development identity. The browser supplies
 * only a bearer credential; it can never select the player, issuer, or subject.
 */
export interface DevEnv extends DevAuthBindings {
  readonly DB: D1DatabaseLike;
}

export interface DevBootstrapStatus {
  readonly playerId: string;
  readonly status: string;
  readonly created: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function devErrorStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
      return 400;
    case "NOT_AUTHENTICATED":
      return 401;
    case "RESOURCE_NOT_FOUND":
      return 404;
    case "CONFLICT_STALE_STATE":
      return 409;
    default:
      return 500;
  }
}

function failure(code: ErrorCode, requestId: string): Response {
  const body: ApiFailure = { ok: false, error: { code, requestId } };
  return jsonResponse(body, devErrorStatus(code));
}

export function createDevWorker(env: DevEnv) {
  const config = readDevAuthConfig(env);
  const authenticator = new DevAuthenticator(config);
  const clock = new SystemClock();
  const core = createHandler({
    db: env.DB,
    authenticator,
    ids: new CryptoIdGenerator(),
    fingerprints: new Sha256Fingerprint(),
    cropDefinitions: new GameDataCropDefinitions(),
    itemDefinitions: new GameDataItemDefinitions(),
    currencyDefinitions: new GameDataCurrencyDefinitions(),
    shopEntries: new GameDataShopEntries(),
    clock
  });
  const bootstrap = new DevPlayerBootstrap(env.DB);

  async function handleBootstrap(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    if (request.method !== "POST") {
      return failure("RESOURCE_NOT_FOUND", requestId);
    }
    const actor = await authenticator.authenticate(request);
    const identity = devIdentity(config);
    if (actor === null || identity === null || identity.playerId !== actor.playerId) {
      return failure("NOT_AUTHENTICATED", requestId);
    }
    // Server-configured identity only: any request body is rejected, never parsed.
    const declaredLength = request.headers.get("content-length");
    const declaresBody = declaredLength !== null && Number(declaredLength) > 0;
    if (declaresBody || request.body !== null) {
      return failure("INVALID_INPUT", requestId);
    }
    let result: DevBootstrapResult | null;
    try {
      result = await bootstrap.ensure(identity, clock.now());
    } catch {
      // Unexpected persistence failures must not leak SQL/D1 detail to the client.
      return failure("INTERNAL_ERROR", requestId);
    }
    if (result === null) {
      return failure("CONFLICT_STALE_STATE", requestId);
    }
    const body: ApiSuccess<{ player: DevBootstrapStatus }> = {
      ok: true,
      data: {
        player: { playerId: result.playerId, status: result.status, created: result.created }
      }
    };
    return jsonResponse(body);
  }

  return async function handleDevRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === DEV_AUTH_BOOTSTRAP_PATH) {
      return handleBootstrap(request);
    }
    return core(request);
  };
}

export default {
  fetch(request: Request, env: DevEnv): Promise<Response> {
    return createDevWorker(env)(request);
  }
};
