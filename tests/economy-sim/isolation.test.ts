import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The simulator is a design tool, never a runtime dependency.
 *
 * It reads the game data, so it is tempting to import it "just for a constant" - which would put a
 * whole modelling package in the Worker bundle. This walks the production trees and refuses any
 * reference, the same technique the staging-routing test uses for the development bridge.
 */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "assets") continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) found.push(path);
    }
  };
  walk(root);
  return found;
}

describe("the economy simulator stays out of production", () => {
  it("is not imported by the browser client or by any Worker", () => {
    for (const root of ["apps", "workers"]) {
      for (const file of sourceFiles(join(repoRoot, root))) {
        const source = readFileSync(file, "utf8");
        expect(source.includes("@happy-farm/economy-sim"), file).toBe(false);
      }
    }
  });

  it("is not a dependency of the client or the deployed API", () => {
    for (const manifest of ["apps/web/package.json", "workers/api/package.json"]) {
      const parsed = JSON.parse(readFileSync(join(repoRoot, manifest), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(parsed.dependencies?.["@happy-farm/economy-sim"], manifest).toBeUndefined();
      expect(parsed.devDependencies?.["@happy-farm/economy-sim"], manifest).toBeUndefined();
    }
  });

  it("reads the game data it models, and only the game data", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "packages/economy-sim/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["@happy-farm/game-data"]);
  });
});
