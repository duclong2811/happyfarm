import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apiPath, isApiRequest, rewriteToApiRequest } from "../../workers/api/src/staging-routing";
import { createDeploymentWorker } from "../../workers/api/src/index";
import { NodeD1Database } from "../support/node-d1";

/**
 * The deployment boundary: one origin, two owners.
 *
 * `/api/*` belongs to the handler (with the prefix stripped once, here) and everything else belongs
 * to Cloudflare's static asset binding, including the SPA fallback. The tests below hold that line,
 * and check the staging configuration and the development bridge's absence from the import graph.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WORKER_ROOT = `${REPO_ROOT}workers/api/`;

function openDatabase(): NodeD1Database {
  return new NodeD1Database(readFileSync(`${REPO_ROOT}database/migrations/0001_phase_1_foundation.sql`, "utf8"));
}

interface AssetsCall {
  readonly path: string;
}

function fakeAssets(calls: AssetsCall[]) {
  return {
    fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      calls.push({ path });
      if (path === "/somewhere-else") {
        // What Cloudflare's single-page-application fallback returns for a client route.
        return Promise.resolve(
          new Response("<!doctype html><title>app shell</title>", { headers: { "content-type": "text/html" } })
        );
      }
      return Promise.resolve(new Response("asset", { headers: { "content-type": "application/octet-stream" } }));
    }
  };
}

describe("api prefix boundary", () => {
  it("maps the public prefix onto the handler's own path space", () => {
    expect(apiPath("/api")).toBe("/");
    expect(apiPath("/api/")).toBe("/");
    expect(apiPath("/api/health")).toBe("/health");
    expect(apiPath("/api/farms/farm_1/crops")).toBe("/farms/farm_1/crops");
  });

  it("does not treat a lookalike path as the API", () => {
    for (const path of ["/", "/index.html", "/apian/health", "/assets/index-abc.js", "/apiary"]) {
      expect(apiPath(path), path).toBeNull();
      expect(isApiRequest(path), path).toBe(false);
    }
  });

  it("rewrites the request without losing method, headers, body, or query", async () => {
    const original = new Request("https://staging.test/api/shop/buy?debug=1", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-jwt-assertion": "token" },
      body: JSON.stringify({ shopEntryId: "x" })
    });
    const rewritten = rewriteToApiRequest(original);
    expect(new URL(rewritten.url).pathname).toBe("/shop/buy");
    expect(new URL(rewritten.url).search).toBe("?debug=1");
    expect(rewritten.method).toBe("POST");
    expect(rewritten.headers.get("cf-access-jwt-assertion")).toBe("token");
    expect(await rewritten.text()).toBe(JSON.stringify({ shopEntryId: "x" }));
  });
});

describe("deployed worker routing", () => {
  it("serves the API for /api/* and static assets for everything else", async () => {
    const db = openDatabase();
    const calls: AssetsCall[] = [];
    const handle = createDeploymentWorker({ DB: db, ASSETS: fakeAssets(calls) });

    const health = await handle(new Request("https://staging.test/api/health"));
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(calls).toHaveLength(0);

    for (const path of ["/", "/index.html", "/assets/index-abc.js", "/assets/character_farmer-abc.glb", "/somewhere-else"]) {
      const response = await handle(new Request(`https://staging.test${path}`));
      expect(response.status, path).toBe(200);
      expect(calls.at(-1)?.path, path).toBe(path);
    }
    db.close();
  });

  it("answers an unknown API route with the API's JSON 404, never the app shell", async () => {
    const db = openDatabase();
    const calls: AssetsCall[] = [];
    const handle = createDeploymentWorker({ DB: db, ASSETS: fakeAssets(calls) });
    const response = await handle(new Request("https://staging.test/api/does-not-exist"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.text();
    expect(body).not.toContain("<!doctype html");
    expect(calls).toHaveLength(0);
    db.close();
  });

  it("routes unauthenticated API calls to a 401 rather than to assets", async () => {
    const db = openDatabase();
    const calls: AssetsCall[] = [];
    const handle = createDeploymentWorker({ DB: db, ASSETS: fakeAssets(calls) });
    const response = await handle(new Request("https://staging.test/api/wallet"));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
    db.close();
  });

  it("keeps serving the API at the root when no assets are bound", async () => {
    const db = openDatabase();
    const handle = createDeploymentWorker({ DB: db });
    expect((await handle(new Request("https://staging.test/health"))).status).toBe(200);
    expect((await handle(new Request("https://staging.test/api/health"))).status).toBe(200);
    db.close();
  });
});

describe("staging configuration", () => {
  const config = readFileSync(`${WORKER_ROOT}wrangler.staging.toml`, "utf8");
  // Comments explain the isolation and quote examples; the assertions below are about the values
  // that would actually be deployed.
  const effective = config
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  it("is a separate staging Worker on the deployed entrypoint", () => {
    expect(effective).toMatch(/^name = "happy-farm-staging"$/m);
    expect(effective).toMatch(/^main = "src\/index\.ts"$/m);
    expect(effective).not.toContain("dev-index");
  });

  it("serves the built web app with an SPA fallback next to the API", () => {
    expect(effective).toMatch(/^\[assets\]$/m);
    expect(effective).toMatch(/^directory = "\.\.\/\.\.\/apps\/web\/dist"$/m);
    expect(effective).toMatch(/^binding = "ASSETS"$/m);
    expect(effective).toMatch(/^not_found_handling = "single-page-application"$/m);
  });

  it("binds the staging database and never the local or an invented one", () => {
    expect(effective).toMatch(/^database_name = "happy-farm-staging"$/m);
    expect(effective).not.toContain("happy-farm-local");
    expect(effective).not.toMatch(/database_id = "00000000/);
    // The id is a sentinel: a deploy fails loudly until the operator pastes the real one.
    expect(effective).toMatch(/^database_id = "REPLACE_WITH_STAGING_D1_ID"$/m);
  });

  it("requires Access configuration instead of shipping a real team or audience", () => {
    expect(effective).toMatch(/^ACCESS_TEAM_DOMAIN = "REPLACE_WITH_ACCESS_TEAM_DOMAIN"$/m);
    expect(effective).toMatch(/^ACCESS_AUD = "REPLACE_WITH_ACCESS_AUD"$/m);
    // No real team domain or audience may be committed: only sentinels are values here.
    expect(effective).not.toMatch(/=\s*"https:\/\//);
    expect(effective).not.toMatch(/^\s*ACCESS_AUD\s*=\s*"(?!REPLACE_)/m);
  });
});

describe("development bridge isolation", () => {
  it("is absent from the deployed Worker's import graph", () => {
    const seen = new Set<string>();
    const queue = [resolve(WORKER_ROOT, "src/index.ts")];
    const forbidden = /dev-auth|dev-index|[\\/]dev[\\/]|DEV_AUTH|__dev|bootstrap/i;
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      if (forbidden.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) {
        offenders.push(relative(REPO_ROOT, file));
      }
      for (const match of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier === undefined || !specifier.startsWith(".")) continue;
        const base = resolve(dirname(file), specifier);
        for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
          try {
            readFileSync(candidate);
            queue.push(candidate);
            break;
          } catch {
            // Not a file we can follow; skip.
          }
        }
      }
    }

    const graph = [...seen].map((file) => relative(REPO_ROOT, file)).sort();
    expect(offenders).toEqual([]);
    expect(graph.length).toBeGreaterThan(3);
    expect(graph.every((file) => !forbidden.test(file))).toBe(true);
  });
});
