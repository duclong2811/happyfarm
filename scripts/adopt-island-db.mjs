/**
 * `npm run db:adopt-island` - make the island test database the one local database.
 *
 * Local development keeps its data in `.wrangler/dev-local.sqlite`, the file `npm run dev` always
 * opens and the local stand-in for the Cloudflare D1 database (same migrations, same order). A second
 * file, `.wrangler/island-test.sqlite`, was used to try the island picker with a fresh player. This
 * folds the two back into one:
 *
 * 1. the current `dev-local.sqlite` is copied to `.wrangler/backups/` (nothing is deleted);
 * 2. `island-test.sqlite` becomes `dev-local.sqlite` (a clean `VACUUM INTO` copy, WAL included);
 * 3. `island-test.sqlite` is moved to `.wrangler/backups/` too, so only one live database remains.
 *
 * Stop `npm run dev` first: the dev server holds the database open.
 * `--dir <path>` points at another `.wrangler` folder (used by the tests).
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = dirFlag === -1 ? join(repoRoot, ".wrangler") : resolve(args[dirFlag + 1] ?? ".");
const live = join(dir, "dev-local.sqlite");
const island = join(dir, "island-test.sqlite");
const backups = join(dir, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function companions(path) {
  return [path, `${path}-wal`, `${path}-shm`];
}

/** A consistent single-file copy, whatever is still sitting in the source's WAL. */
function copyDatabase(source, target) {
  const database = new DatabaseSync(source);
  try {
    database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    database.close();
  }
}

if (!existsSync(island)) {
  console.error(`[db:adopt-island] ${island} does not exist - there is nothing to adopt.`);
  process.exit(1);
}
mkdirSync(backups, { recursive: true });

if (existsSync(live)) {
  const saved = join(backups, `dev-local-${stamp}.sqlite`);
  copyDatabase(live, saved);
  for (const file of companions(live)) rmSync(file, { force: true });
  console.log(`[db:adopt-island] old dev-local.sqlite saved as ${saved}`);
}

copyDatabase(island, live);
const parked = join(backups, `island-test-${stamp}.sqlite`);
copyDatabase(island, parked);
for (const file of companions(island)) rmSync(file, { force: true });

const check = new DatabaseSync(live);
const farms = check.prepare("SELECT f.name AS name, i.element AS element, i.outline AS outline FROM farms f LEFT JOIN farm_islands i ON i.farm_id = f.id").all();
check.close();
console.log(`[db:adopt-island] dev-local.sqlite now holds: ${farms.map((farm) => `${farm.name} (${farm.element ?? "old island"}${farm.outline ? ` / ${farm.outline}` : ""})`).join(", ") || "no farms"}`);
console.log(`[db:adopt-island] island-test.sqlite parked as ${parked}. Run \`npm run dev\` as usual.`);
