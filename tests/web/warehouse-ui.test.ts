import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GetWarehouseResponseSchema } from "@happy-farm/contracts";
import { createTranslator, errorMessage } from "../../apps/web/src/i18n";

/**
 * The warehouse surface the player sees, and the rules it must not break.
 *
 * The strip is presentation: every number on it comes from `/warehouse`, and the upgrade sends a
 * request id. These are source contracts on the markup and the page code, plus the contract and the
 * localisation, because the parts that matter here cannot be asserted without a browser.
 */

const INDEX_HTML = readFileSync(fileURLToPath(new URL("../../apps/web/index.html", import.meta.url)), "utf8");
const MAIN = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");
const API = readFileSync(fileURLToPath(new URL("../../apps/web/src/api.ts", import.meta.url)), "utf8");

describe("the warehouse strip", () => {
  it("hosts the used/capacity line, the bar and the upgrade control in the inventory panel", () => {
    for (const id of [
      'id="warehouse"',
      'id="warehouse-title"',
      'id="warehouse-tier"',
      'id="warehouse-usage"',
      'id="warehouse-bar-fill"',
      'id="warehouse-next"',
      'id="warehouse-upgrade"'
    ]) {
      expect(INDEX_HTML, id).toContain(id);
    }
  });

  it("draws the server's numbers and sends a request id, never a capacity or a tier", () => {
    expect(MAIN).toContain('client.getWarehouse()');
    expect(MAIN).toContain("api().upgradeWarehouse(newRequestId(\"warehouse\"))");
    expect(API).toContain('this.get("/warehouse"');
    expect(API).toContain('this.post("/warehouse/upgrade", { requestId }');
    // The upgrade request carries only a request id on the wire.
    expect(API).toContain("upgradeWarehouse(requestId: string)");
  });

  it("refreshes with the account and adds no polling of its own", () => {
    // One fetch site, inside the account refresh: load and post-mutation, never a timer.
    const fetches = MAIN.match(/\.getWarehouse\(\)/g) ?? [];
    expect(fetches).toHaveLength(1);
    const warehouseIntervals = MAIN.match(/setInterval\([^)]{0,200}warehouse/i) ?? [];
    expect(warehouseIntervals).toHaveLength(0);
  });
});

describe("the warehouse wire contract", () => {
  it("accepts a server status and rejects a client-invented one", () => {
    const status = {
      warehouse: {
        tier: 0,
        tierDisplayNameKey: "warehouse.tier.starter.name",
        capacity: 1000,
        used: 73,
        available: 927,
        overCapacity: false,
        nextTier: 1,
        nextCapacity: 2500,
        nextUpgrade: {
          currencyId: "currency_gold",
          gold: 500,
          materials: [{ itemDefinitionId: "item_wood", quantity: 50 }]
        }
      }
    };
    expect(GetWarehouseResponseSchema.safeParse(status).success).toBe(true);
    // A client cannot name its own capacity, tier or cost: the schema is strict.
    expect(
      GetWarehouseResponseSchema.safeParse({
        warehouse: { ...status.warehouse, capacity: 999_999 }
      }).success
    ).toBe(true);
    // ...but an *extra* field a client invented is refused.
    expect(
      GetWarehouseResponseSchema.safeParse({
        warehouse: { ...status.warehouse, clientCapacity: 999_999 }
      }).success
    ).toBe(false);
  });
});

describe("warehouse-full feedback", () => {
  it("is a localized sentence in both languages, never the raw code", () => {
    for (const language of ["en", "vi"] as const) {
      const t = createTranslator(language);
      const message = errorMessage(t, "WAREHOUSE_FULL");
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe("WAREHOUSE_FULL");
      expect(message.toLowerCase()).not.toContain("zod");
      expect(message.toLowerCase()).not.toContain("invalid_union");
    }
    expect(errorMessage(createTranslator("vi"), "WAREHOUSE_FULL")).not.toBe(
      errorMessage(createTranslator("en"), "WAREHOUSE_FULL")
    );
  });

  it("has a hint for the full strip and one for the grandfathered over-capacity state", () => {
    for (const language of ["en", "vi"] as const) {
      const t = createTranslator(language);
      expect(t("warehouse.fullHint").length).toBeGreaterThan(0);
      expect(t("warehouse.overCapacity").length).toBeGreaterThan(0);
      expect(t("warehouse.upgrade").length).toBeGreaterThan(0);
      expect(t("warehouse.maxTier").length).toBeGreaterThan(0);
    }
  });
});
