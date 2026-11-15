/**
 * `npm run dev:island [file]` - the local game on a second development database.
 *
 * The dev API keeps its data in `.wrangler/dev-local.sqlite` unless DEV_DATABASE_PATH names another
 * file. Setting that variable differs per shell (PowerShell, cmd, bash) and only lasts for the one
 * terminal, which is how a player who chose an island on a test database came back to the old farm
 * after a restart. This sets it for them, to an absolute path under `.wrangler/` (gitignored), and
 * then runs the ordinary `npm run dev`.
 *
 * Only a bare file name is accepted, so the database always stays inside `.wrangler/`.
 */
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requested = basename(process.argv[2] ?? "island-test.sqlite");
const databasePath = resolve(repoRoot, ".wrangler", requested.endsWith(".sqlite") ? requested : `${requested}.sqlite`);

console.log(`[dev:island] using ${databasePath}`);
const child = spawn("npm", ["run", "dev"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DEV_DATABASE_PATH: databasePath }
});
child.on("exit", (code) => process.exit(code ?? 0));
