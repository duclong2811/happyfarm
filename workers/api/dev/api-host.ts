import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DevAuthBindings } from "../src/dev-auth";
import { DEV_AUTH_BOOTSTRAP_PATH } from "../src/dev-auth";
import { createDevWorker, type DevEnv } from "../src/dev-index";
import { readDevVars } from "./dev-vars";
import { applyMigrations } from "./migrations";
import { repairDuplicateFarmOwnership, type FarmOwnershipRepair } from "./repair-farm-ownership";
import { SqliteD1Database } from "./sqlite-d1";

/**
 * DEVELOPMENT-ONLY host for the real development Worker entrypoint.
 *
 * `src/dev-index.ts` (routed to by `wrangler.dev.toml`) is the single implementation of the
 * development API: the same authenticator, the same handler, the same routes. This host only
 * supplies the two things `workerd` normally provides — a `D1DatabaseLike` binding and the
 * `fetch(request, env)` runtime — so a live development backend can run on a machine where the
 * native Worker runtime cannot start.
 *
 * It is never bundled into the production Worker (`wrangler.toml` still points at `src/index.ts`)
 * and it never relaxes authentication: identity still comes from server-side bindings only.
 */
export interface DevApiHost {
  readonly databasePath: string;
  readonly appliedMigrations: readonly string[];
  /**
   * What the one-farm-per-player repair had to do to this local database, if anything.
   *
   * Non-zero means the file predates V13.6.1: it held several farms for one player, which is exactly
   * what `0014`'s unique index refuses, so the runner resolved it before applying the migrations. The
   * host reports it rather than logging it itself so the caller that owns a logger can say so.
   */
  readonly farmOwnershipRepair: FarmOwnershipRepair;
  readonly configured: boolean;
  handle(request: Request): Promise<Response>;
  /** Same-origin Vite traffic with the server-held dev credential attached. */
  handleTrustedBrowserRequest(request: Request): Promise<Response>;
  /** Releases the local database handle. Long-lived servers keep the host open for their lifetime. */
  close(): void;
}

export interface DevApiHostOptions {
  readonly repoRoot: string;
  readonly databasePath?: string;
}

export function createDevApiHost(options: DevApiHostOptions): DevApiHost {
  const workerDir = join(options.repoRoot, "workers", "api");
  const databasePath =
    options.databasePath ??
    process.env.DEV_DATABASE_PATH ??
    join(options.repoRoot, ".wrangler", "dev-local.sqlite");

  const directory = dirname(databasePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const sqlite = new DatabaseSync(databasePath);
  // D1 enforces foreign keys while applying migrations too. Enabling it before the runner starts
  // keeps the local database from accepting a migration that production would reject.
  sqlite.exec("PRAGMA foreign_keys = ON");
  // The repair has to happen *before* the migrations: `0014` creates the unique index on
  // `farms(owner_player_id)`, and a local file written before V13.6.1 can hold duplicates that the
  // index cannot be created over. See `repair-farm-ownership.ts`.
  const farmOwnershipRepair = repairDuplicateFarmOwnership(sqlite);
  const appliedMigrations = applyMigrations(sqlite, join(options.repoRoot, "database", "migrations"));

  const devVarsPath = process.env.DEV_VARS_PATH ?? join(workerDir, ".dev.vars");
  const bindings: DevAuthBindings = readDevVars(devVarsPath);
  const configured =
    bindings.DEV_AUTH_ENABLED?.toLowerCase() === "true" &&
    bindings.DEV_AUTH_TOKEN !== undefined &&
    bindings.DEV_AUTH_TOKEN.length > 0 &&
    bindings.DEV_PLAYER_ID !== undefined;

  const database = new SqliteD1Database(sqlite);
  const env: DevEnv = { ...bindings, DB: database };
  const handle = createDevWorker(env);
  const devToken = bindings.DEV_AUTH_TOKEN;
  let bootstrapped = false;

  /**
   * Onboards the development identity, once, on the server.
   *
   * The browser no longer knows this route exists: it would only have carried a development-only
   * path into the shipped bundle. The dev host performs the same onboarding the deployed Worker
   * performs inside its authenticator, so both environments give a first-time visitor a Player row
   * before their first command.
   */
  async function ensureBootstrapped(): Promise<void> {
    if (!configured || devToken === undefined || bootstrapped) return;
    bootstrapped = true;
    await handle(
      new Request(`http://localhost${DEV_AUTH_BOOTSTRAP_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${devToken}` }
      })
    );
  }

  return {
    databasePath,
    appliedMigrations,
    farmOwnershipRepair,
    configured,
    handle,
    handleTrustedBrowserRequest: async (request: Request) => {
      if (!configured || devToken === undefined) return handle(request);
      await ensureBootstrapped();
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${devToken}`);
      return handle(new Request(request, { headers }));
    },
    close: () => {
      database.close();
    }
  };
}
