import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Local development and the test suite must not be able to read remote D1.
 *
 * The V14.3.2 quota incident was caused by the *deployed staging Worker* serving its own polling
 * browsers, not by a repo script - but the guardrail that keeps it from ever being a script is worth
 * pinning. A routine command (`test`, `dev`, `build`, `typecheck`, `lint`) may not name a remote
 * database, and any `wrangler deploy` in a script must be a `--dry-run`.
 */

const repoRoot = new URL("../../", import.meta.url);

function readJson(relative: string): { readonly scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(new URL(relative, repoRoot), "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
}

function readText(relative: string): string {
  return readFileSync(new URL(relative, repoRoot), "utf8");
}

function scriptsOf(relative: string): Record<string, string> {
  return readJson(relative).scripts ?? {};
}

const PACKAGE_FILES = ["package.json", "apps/web/package.json", "workers/api/package.json"];

describe("no routine command can reach remote D1", () => {
  it("names no remote database in any workspace script", () => {
    for (const file of PACKAGE_FILES) {
      for (const [name, script] of Object.entries(scriptsOf(file))) {
        expect(script, `${file} ${name}`).not.toMatch(/--remote|d1\s+execute/);
      }
    }
  });

  it("only ever builds a Worker with a dry run, never deploys one", () => {
    for (const file of PACKAGE_FILES) {
      for (const [name, script] of Object.entries(scriptsOf(file))) {
        if (/wrangler\s+deploy/.test(script)) {
          expect(script, `${file} ${name}`).toContain("--dry-run");
        }
      }
    }
  });

  it("keeps the local migration explicit about being local", () => {
    const migrate = scriptsOf("package.json")["db:migrate:local"];
    expect(migrate).toBeDefined();
    expect(migrate).toContain("--local");
    expect(migrate).not.toContain("--remote");
  });

  it("runs the test suite with vitest and nothing that could touch a database", () => {
    const test = scriptsOf("package.json").test;
    expect(test).toContain("vitest");
    expect(test).not.toMatch(/wrangler|d1|--remote/);
  });
});

describe("local development resolves a local file", () => {
  it("points the dev API host at the local sqlite file, not at Cloudflare", () => {
    const host = readText("workers/api/dev/api-host.ts");
    // The development host talks to node:sqlite on a file under .wrangler; there is no D1 binding
    // and no remote call in it.
    expect(host).toContain("node:sqlite");
    expect(host).toContain("dev-local.sqlite");
    expect(host).not.toMatch(/https:\/\/.*cloudflare|wrangler\s*$/m);
  });

  it("serves /api through the dev host module, not a remote origin", () => {
    const vite = readText("apps/web/vite.config.ts");
    expect(vite).toContain("workers/api/dev/api-host.ts");
    expect(vite).not.toMatch(/https:\/\/(?!localhost)/);
  });
});

describe("the one explicit remote reader is staging-only and opt-in", () => {
  it("is the starter repair, and it refuses any other database", () => {
    const repair = readText("scripts/repair/starter-package-backfill.mjs");
    expect(repair).toContain('"--remote"');
    expect(repair).toContain('export const STAGING_DATABASE = "happy-farm-staging"');
  });
});
