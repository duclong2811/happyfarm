import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Emergency Funding surface, by construction.
 *
 * The block is part of the Auto panel, and these assertions pin the two things a reviewer cannot see
 * from the server: that the client only ever offers resources the authoritative catalogue buys, and
 * that it renders names through the existing display pipeline instead of printing an id or a raw key.
 */

const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");
const block = /function fundingBlock[\s\S]*?\n\}/u.exec(source)?.[0] ?? "";
const sellable = /function sellableFundingEntries[\s\S]*?\n\}/u.exec(source)?.[0] ?? "";

describe("the emergency funding controls", () => {
  it("renders the enable toggle, the safety sentence and the priority arrows", () => {
    expect(block).not.toBe("");
    expect(block).toContain('t("workers.funding")');
    expect(block).toContain('t("workers.fundingHint")');
    expect(block).toContain("fundingMoveButton");
    expect(source).toContain('"compact auto-funding-move"');
    expect(block).toContain("MAX_FUNDING_ITEMS");
  });

  it("offers only what the authoritative shop buys, and never a seed", () => {
    expect(sellable).toContain("entry.sellPrice !== null");
    expect(sellable).toContain('entry.category !== "SEED"');
  });

  it("shows display names, never a raw id or an untranslated key", () => {
    expect(block).toContain("itemLabel(itemDefinitionId)");
    expect(block).toContain("displayName(state.language, entry.itemDisplayNameKey, entry.itemDefinitionId)");
    expect(block).not.toContain("t(entry.itemDisplayNameKey)");
  });
});
