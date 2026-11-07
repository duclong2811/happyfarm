import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the browser is allowed to ask for offline reconciliation.
 *
 * B3 is only safe while the client triggers it on *entry or resume*: the growth poll must stay a pure
 * read of crops and trees, and no timer, background loop or `beforeunload` handler may ever drive a
 * settlement. These assertions read the client source, so a later edit that quietly wires
 * reconciliation into the poll fails here instead of on the staging bill.
 */

const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");

function count(pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

describe("the reconciliation trigger", () => {
  it("is asked for exactly twice: on farm load and on resume from a real absence", () => {
    expect(count(/reconcileAutoOnce\(\)/gu)).toBe(3); // definition + loadFarm call + resume call
    expect(count(/api\(\)\.reconcileAuto\(/gu)).toBe(1);
  });

  it("is never wired to the growth poll, a timer or an unload handler", () => {
    const poll = /function refreshGrowthOnce[\s\S]*?\n {2}\}/u.exec(source)?.[0] ?? "";
    expect(poll).not.toContain("reconcile");
    expect(source).not.toContain("beforeunload");
    expect(source).not.toContain("sendBeacon");
    // The resume path only asks after a real absence, not on every tab switch.
    expect(source).toContain("awayMs >= 60_000");
  });

  it("keeps the growth poll at its own five-second cadence", () => {
    expect(source).toContain("window.setInterval(refreshGrowthOnce, GROWTH_REFRESH_INTERVAL_MS)");
  });
});
