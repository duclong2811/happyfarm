import { existsSync, readFileSync } from "node:fs";

/**
 * Reads a wrangler-style `.dev.vars` file into server-side bindings.
 *
 * `.dev.vars` is gitignored, so the development bearer token and identity stay on the local
 * machine: only the *names* of the required variables are committed (`.dev.vars.example`).
 * Values are never logged and never sent to the browser.
 */
export function readDevVars(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const variables: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;
    variables[key] = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return variables;
}