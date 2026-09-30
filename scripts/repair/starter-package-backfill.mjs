#!/usr/bin/env node
/**
 * Repairs staging players who were created before the starter package existed.
 *
 * The alpha build created a Player row and granted nothing, so those testers hold no gold and no
 * seeds and cannot plant. This script hands each of them the same one-time package every new player
 * gets, by inserting the receipt `starter_grant_apply` already understands - the receipt insert *is*
 * the grant, so the script cannot credit a player by a path the game would not take, and a player
 * who already has a receipt is skipped by the primary key rather than by this script's bookkeeping.
 *
 * It is deliberately narrow and deliberately loud:
 *   * it only ever runs against the staging database and the staging config, by name;
 *   * it prints what it would do and writes nothing unless `--apply` is passed;
 *   * it reads the package (key, seed, quantity, currency, gold) out of game data rather than
 *     restating it, and refuses to run if that file no longer parses.
 *
 * Production is not a target and cannot become one by accident: there is no production database
 * name this script accepts, and the caller must name the staging database explicitly.
 *
 * Usage:
 *   node scripts/repair/starter-package-backfill.mjs --dry-run     (default)
 *   node scripts/repair/starter-package-backfill.mjs --apply
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The only database and config this repair may touch. */
export const STAGING_DATABASE = "happy-farm-staging";
export const STAGING_CONFIG = "workers/api/wrangler.staging.toml";

const DEFAULT_GAME_DATA = fileURLToPath(new URL("../../packages/game-data/src/starter/index.ts", import.meta.url));

/** Reads one `export const NAME = <literal>;` from a game-data module. */
function readLiteral(source, name) {
  const match = new RegExp(`export const ${name} = ("[^"]*"|[0-9_]+);`).exec(source);
  if (match === null) return null;
  const raw = match[1];
  if (raw.startsWith('"')) return raw.slice(1, -1);
  return Number(raw.replaceAll("_", ""));
}

/**
 * The package as game data defines it, or null when game data no longer looks the way this script
 * knows how to read. Null is a refusal, never a default: guessing the package here would be exactly
 * the second, silently-drifting starter-reward definition the game is supposed to have only one of.
 */
export function readStarterPackage(gameDataPath = DEFAULT_GAME_DATA) {
  const source = readFileSync(gameDataPath, "utf8");
  const grantKey = readLiteral(source, "STARTER_GRANT_KEY");
  const seedQuantity = readLiteral(source, "STARTER_SEED_QUANTITY");
  const goldAmount = readLiteral(source, "STARTER_GOLD_AMOUNT");
  const seedItem = (/seedItemDefinitionId:\s*"([^"]+)"/.exec(source) ?? [])[1];
  const currency = (/currencyDefinitionId:\s*"([^"]+)"/.exec(source) ?? [])[1];
  if (
    typeof grantKey !== "string" ||
    !/^starter_[a-z0-9_]+$/.test(grantKey) ||
    !Number.isSafeInteger(seedQuantity) ||
    seedQuantity <= 0 ||
    !Number.isSafeInteger(goldAmount) ||
    goldAmount <= 0 ||
    typeof seedItem !== "string" ||
    !/^item_[a-z0-9_]+$/.test(seedItem) ||
    typeof currency !== "string" ||
    !/^currency_[a-z0-9_]+$/.test(currency)
  ) {
    return null;
  }
  return { grantKey, seedItemDefinitionId: seedItem, seedQuantity, currencyDefinitionId: currency, goldAmount };
}

export function parseArgs(argv) {
  const options = { apply: false, database: STAGING_DATABASE, config: STAGING_CONFIG, limit: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--database") options.database = argv[++index] ?? "";
    else if (arg === "--config") options.config = argv[++index] ?? "";
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/** Refuses anything but the staging database and the staging config, by name. */
export function assertStagingTarget(options) {
  if (options.database !== STAGING_DATABASE) {
    throw new Error(
      `this repair only runs against ${STAGING_DATABASE}, not ${String(options.database)}: production balances are not touched by a script`
    );
  }
  if (options.config !== STAGING_CONFIG) {
    throw new Error(`this repair only runs with ${STAGING_CONFIG}, not ${String(options.config)}`);
  }
  if (options.limit !== null && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
}

/** Every player who has no receipt for this package version. */
export function selectUnreceiptedPlayersSql(packageDefinition) {
  return [
    "SELECT p.id AS player_id FROM players p",
    `WHERE NOT EXISTS (SELECT 1 FROM starter_grants g WHERE g.player_id = p.id AND g.grant_key = '${packageDefinition.grantKey}')`,
    "ORDER BY p.id"
  ].join(" ");
}

/**
 * The statements that hand the package to each player.
 *
 * `ON CONFLICT DO NOTHING` is the same one-time guard the game uses, so a player who was granted
 * between the read and the write is skipped rather than credited twice.
 */
export function planStatements(packageDefinition, playerIds, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const newId = options.newTransactionId ?? (() => `econ_${randomUUID()}`);
  return playerIds.map((playerId) => {
    const requestId = `starter:${packageDefinition.grantKey}:${playerId}`;
    return [
      "INSERT INTO starter_grants (player_id, grant_key, item_definition_id, item_quantity, currency_id, gold_amount, transaction_id, request_id, created_at)",
      `VALUES ('${playerId}', '${packageDefinition.grantKey}', '${packageDefinition.seedItemDefinitionId}', ${String(packageDefinition.seedQuantity)}, '${packageDefinition.currencyDefinitionId}', ${String(packageDefinition.goldAmount)}, '${newId()}', '${requestId}', '${now}')`,
      "ON CONFLICT DO NOTHING"
    ].join(" ");
  });
}

function runWrangler(options, command) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const stdout = execFileSync(
    npx,
    ["wrangler", "d1", "execute", options.database, "--remote", "--config", options.config, "--json", "--command", command],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  return JSON.parse(stdout);
}

function readPlayers(options, packageDefinition) {
  const parsed = runWrangler(options, selectUnreceiptedPlayersSql(packageDefinition));
  const rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : [];
  const players = rows.map((row) => row.player_id).filter((id) => typeof id === "string");
  return options.limit === null ? players : players.slice(0, options.limit);
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      [
        "Repair staging players created before the starter package existed.",
        "",
        "  node scripts/repair/starter-package-backfill.mjs [--dry-run | --apply] [--limit N]",
        "",
        `Only ${STAGING_DATABASE} with ${STAGING_CONFIG} is accepted. Nothing is written without --apply.`,
        ""
      ].join("\n")
    );
    return;
  }
  assertStagingTarget(options);
  const packageDefinition = readStarterPackage();
  if (packageDefinition === null) {
    throw new Error("could not read the starter package from packages/game-data/src/starter/index.ts");
  }
  const players = readPlayers(options, packageDefinition);
  const statements = planStatements(packageDefinition, players);
  process.stdout.write(
    `${String(players.length)} staging player(s) have no '${packageDefinition.grantKey}' receipt.\n`
  );
  if (statements.length === 0) return;
  if (!options.apply) {
    process.stdout.write(`dry run: ${String(statements.length)} statement(s) would run. Re-run with --apply.\n`);
    return;
  }
  runWrangler(options, `${statements.join(";\n")};`);
  process.stdout.write(`applied: ${String(statements.length)} statement(s).\n`);
}

// Imported by tests as a module: only a direct run touches a database.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
