import { CloudflareAccessAuthenticator, type AccessAuthBindings, type AccessTokenVerifier } from "./access-auth";
import { EconomyService, GrantStarterPackage, InventoryService } from "@happy-farm/application";
import { createHandler } from "./handler";
import {
  AccessPlayerDirectory,
  OnboardingAuthenticator,
  readStarterGrantPolicy
} from "./player-onboarding";
import { D1StarterGrantRepository, D1WalletRepository } from "./d1-repositories";
import {
  CryptoIdGenerator,
  GameDataCurrencyDefinitions,
  GameDataCropDefinitions,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  SystemClock,
  gameDataProgressionDefinition,
  gameDataStarterPackage
} from "./runtime";
import { isApiRequest, rewriteToApiRequest } from "./staging-routing";
import type { D1DatabaseLike } from "./d1-types";

/**
 * The deployed Worker: staging today, production when it exists.
 *
 * Two jobs in one script, because they want the same origin:
 *
 *   /api/*  -> the existing handler (the prefix is stripped here, once)
 *   else    -> Cloudflare static assets: the SPA shell, JS, CSS, and the generated GLB models
 *
 * Identity comes from Cloudflare Access (`Cf-Access-Jwt-Assertion`, cryptographically verified in
 * `access-auth.ts`), and the first verified visit creates that visitor's Player row. Nothing here
 * reads an identity supplied by the browser, and nothing here imports the development bridge:
 * `dev-auth.ts`, `dev-index.ts` and `workers/api/dev/**` are not in this file's import graph, so
 * `/__dev/bootstrap` cannot exist in a deployment built from it.
 *
 * Configuration is fail-closed. With `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` unset, every authenticated
 * route answers NOT_AUTHENTICATED rather than falling back to another authenticator.
 */

/** The static asset binding, when a deployment serves the web app next to the API. */
interface StaticAssets {
  fetch(request: Request): Promise<Response>;
}

export interface DeploymentEnv extends AccessAuthBindings {
  readonly DB: D1DatabaseLike;
  readonly ASSETS?: StaticAssets;
  /**
   * Which players may receive the one-time starter package. Absent means `NEW_PLAYERS`, which
   * grants it only to a visitor whose Player row this request creates.
   */
  readonly STARTER_GRANT_POLICY?: string;
}

export interface DeploymentWorkerOptions {
  /** Test seam: a deterministic verifier instead of the team's live JWKS. */
  readonly verifier?: AccessTokenVerifier;
}

export function createDeploymentWorker(env: DeploymentEnv, options: DeploymentWorkerOptions = {}) {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  const access = new CloudflareAccessAuthenticator({
    ...env,
    ...(options.verifier === undefined ? {} : { verifier: options.verifier })
  });
  // Onboarding is not a route and never a command: the same shared use case the development host
  // calls is handed to the authenticator, which only ever invokes it for a player the world has not
  // granted the package to. No request body can reach any part of it.
  const grantStarterPackage = new GrantStarterPackage(
    new D1StarterGrantRepository(env.DB),
    new InventoryService(new GameDataItemDefinitions(), clock),
    new EconomyService(ids, clock),
    new GameDataCurrencyDefinitions(),
    new D1WalletRepository(env.DB),
    clock,
    gameDataStarterPackage
  );
  const handler = createHandler({
    db: env.DB,
    authenticator: new OnboardingAuthenticator(access, new AccessPlayerDirectory(env.DB), clock, {
      grantStarterPackage: (actor) => grantStarterPackage.execute(actor),
      starterGrantPolicy: readStarterGrantPolicy(env.STARTER_GRANT_POLICY)
    }),
    ids,
    fingerprints: new Sha256Fingerprint(),
    cropDefinitions: new GameDataCropDefinitions(),
    itemDefinitions: new GameDataItemDefinitions(),
    currencyDefinitions: new GameDataCurrencyDefinitions(),
    shopEntries: new GameDataShopEntries(),
    plotDefinitions: new GameDataPlotDefinitions(),
    treeDefinitions: new GameDataTreeDefinitions(),
    progressionDefinition: gameDataProgressionDefinition,
    clock
  });

  return async function handleDeploymentRequest(request: Request): Promise<Response> {
    if (isApiRequest(new URL(request.url).pathname)) {
      return handler(rewriteToApiRequest(request));
    }
    if (env.ASSETS !== undefined) {
      // Static assets own everything that is not the API: the shell, hashed bundles, GLB models and
      // the SPA fallback. An unknown /api route never reaches this branch, so it answers with the
      // API's own JSON 404 instead of an HTML page.
      return env.ASSETS.fetch(request);
    }
    // A Worker deployed without static assets keeps serving the API at the root, which is how the
    // API has always been deployed and what its own tests exercise.
    return handler(request);
  };
}

export default {
  fetch(request: Request, env: DeploymentEnv): Promise<Response> {
    return createDeploymentWorker(env)(request);
  }
};
