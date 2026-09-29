#!/usr/bin/env node
/**
 * Refuses to deploy staging while its configuration is still a template.
 *
 * The staging Worker is fail-closed by construction - a sentinel team domain cannot verify a token -
 * but a deploy that silently shipped the sentinel would look successful and then reject every tester.
 * This check turns that into a loud, actionable failure.
 *
 * Run: npm run check:staging-config
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG = fileURLToPath(new URL("../../workers/api/wrangler.staging.toml", import.meta.url));

const REQUIRED_REPLACEMENTS = [
  ["REPLACE_WITH_STAGING_D1_ID", "create the staging database and paste its id", "wrangler d1 create happy-farm-staging"],
  ["REPLACE_WITH_ACCESS_TEAM_DOMAIN", "set the Access team domain", "Cloudflare dashboard → Zero Trust → Access → Applications"],
  ["REPLACE_WITH_ACCESS_AUD", "set the Access application audience tag", "the application's overview page shows the AUD tag"]
];

const text = readFileSync(CONFIG, "utf8");
const pending = REQUIRED_REPLACEMENTS.filter(([sentinel]) => text.includes(sentinel));

if (pending.length === 0) {
  process.stdout.write("staging configuration has no remaining placeholders\n");
} else {
  process.stderr.write("staging configuration is not ready to deploy:\n");
  for (const [sentinel, reason, where] of pending) {
    process.stderr.write(`  ${sentinel}: ${reason} (${where})\n`);
  }
  process.stderr.write("see docs/deployment.md for the full checklist\n");
  process.exitCode = 1;
}
