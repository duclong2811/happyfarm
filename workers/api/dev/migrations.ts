import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const TRACKING_TABLE = "dev_applied_migrations";

/**
 * Applies the committed D1 migrations, in filename order, to a local development database.
 *
 * The `.sql` files in `database/migrations/` stay the single source of truth; this runner only
 * tracks what a local file has already applied. Production migrations are still applied by
 * `wrangler d1 migrations apply`.
 */
export function applyMigrations(sqlite: DatabaseSync, migrationsDir: string): readonly string[] {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`
  );
  const rows = sqlite.prepare(`SELECT name FROM ${TRACKING_TABLE}`).all() as { name: string }[];
  const applied = new Set(rows.map((row) => row.name));
  const newlyApplied: string[] = [];
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const record = sqlite.prepare(`INSERT INTO ${TRACKING_TABLE} (name, applied_at) VALUES (?, ?)`);
    // The migration body and its tracking row commit together or not at all. Applying the SQL in
    // autocommit and recording it afterwards would strand the local database with schema the runner
    // does not know it applied, so every later run would re-apply it and fail.
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(readFileSync(join(migrationsDir, name), "utf8"));
      record.run(name, new Date().toISOString());
      sqlite.exec("COMMIT");
    } catch (error: unknown) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
    newlyApplied.push(name);
  }
  return newlyApplied;
}