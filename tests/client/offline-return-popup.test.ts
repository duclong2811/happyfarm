import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");

describe("offline return popup acceptance", () => {
  it("renders only positive server-produced rows", () => {
    expect(source).toContain("const rows = producedItems.filter((item) => item.quantity > 0);");
    expect(source).toContain("lastProductionItems = result.producedItems;");
    expect(source).toContain("showReturnPopup");
  });

  it("refreshes authoritative account state after reconciliation", () => {
    expect(source).toContain("await refreshAccount();");
    expect(source).toContain("client.getWarehouse()");
    expect(source).toContain("client.getInventory()");
  });

  it("keeps presentation time separate from economic quantity", () => {
    expect(source).toContain("localStorage.getItem(\"happyfarm.lastVisibleAt\")");
    expect(source).toContain("t(\"return.away\", { duration: formatAway(awayMs) })");
    expect(source).toContain("result.producedItems");
    expect(source).not.toMatch(/awayMs\s*\*|awayDuration\s*\*|treeCount\s*\*/u);
  });

  it("covers first load, hidden return, failure-safe behavior, and no production polling", () => {
    expect(source).toMatch(/Number\.isFinite\(previousActiveAt\)\s*&&\s*previousActiveAt\s*>\s*0/u);
    expect(source).toContain("awayMs >= 60_000");
    expect(source).toMatch(/catch\s*\{[\s\S]*?return false;/u);
    expect(source).toContain("if (Date.now() >= growthRefreshDueAt) refreshGrowthOnce();");
    const poll = /function refreshGrowthOnce[\s\S]*?\n\s*\}/u.exec(source)?.[0] ?? "";
    expect(poll).not.toContain("reconcileProductionOnce");
  });
});
