import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The schema a test builds, taken from the migrations the repository actually ships.
 *
 * Most tests want *the current schema* - the one a deployment has after every migration - and hand
 * maintaining that list is how a suite drifts from production: a new migration that changes an
 * existing table (as 0026 does to the harvest settlement) fails every test that forgot to name it.
 * Reading the directory in order cannot drift.
 *
 * Tests that deliberately want an *older* schema - the migration tests that prove a live save survives
 * an upgrade - keep their own explicit lists; that is what makes them a proof.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../../database/migrations", import.meta.url));

/** Every migration this repository ships, in the order a deployment applies them. */
export function allMigrationNames(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** One migration's SQL, by file name. */
export function migrationSql(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");
}

/** The whole current schema, as one script. */
export function schemaSql(): string {
  return allMigrationNames()
    .map((name) => migrationSql(name))
    .join("\n");
}
