import { describe, expect, it } from "vitest";
import {
  assertStorageDeltaFits,
  isOverCapacity,
  nextWarehouseTier,
  warehouseAvailable,
  type WarehouseTierDefinition
} from "@happy-farm/domain";

/**
 * The storage capacity primitive. Pure rules, so every future transaction (harvest, shop, crafting,
 * shipping) reasons about the same net-delta arithmetic.
 */

const tiers: readonly WarehouseTierDefinition[] = [
  {
    tier: 0,
    displayNameKey: "warehouse.tier.starter.name",
    capacity: 100,
    upgrade: { currencyDefinitionId: "currency_gold", gold: 10, materials: {} }
  },
  { tier: 1, displayNameKey: "warehouse.tier.early.name", capacity: 250, upgrade: null }
];

function fits(capacity: number, used: number, deltas: readonly number[]): void {
  assertStorageDeltaFits(capacity, used, deltas);
}

describe("warehouse capacity", () => {
  it("reports available space and the over-capacity flag", () => {
    expect(warehouseAvailable({ capacity: 100, used: 40 })).toBe(60);
    expect(warehouseAvailable({ capacity: 100, used: 100 })).toBe(0);
    expect(warehouseAvailable({ capacity: 100, used: 130 })).toBe(0);
    expect(isOverCapacity({ capacity: 100, used: 130 })).toBe(true);
    expect(isOverCapacity({ capacity: 100, used: 100 })).toBe(false);
  });

  it("looks up the next tier, and reports the top of the ladder", () => {
    expect(nextWarehouseTier(tiers, 0)?.tier).toBe(1);
    expect(nextWarehouseTier(tiers, 1)).toBeNull();
    expect(nextWarehouseTier(tiers, 9)).toBeNull();
  });

  it("accepts a net delta that fits and refuses one that overflows", () => {
    expect(() => {
      fits(100, 40, [50]);
    }).not.toThrow();
    expect(() => {
      fits(100, 40, [60]);
    }).not.toThrow();
    expect(() => {
      fits(100, 40, [61]);
    }).toThrow(/warehouse/i);
  });

  it("lets a negative delta free space, and rejects a delta that would make usage negative", () => {
    expect(() => {
      fits(100, 90, [-10]);
    }).not.toThrow();
    expect(() => {
      fits(100, 10, [-11]);
    }).toThrow(/storage delta/i);
  });

  it("evaluates a mixed input/output delta on its net change", () => {
    // Consume 30, produce 20: nets -10, so it fits even at the ceiling.
    expect(() => {
      fits(100, 100, [-30, 20]);
    }).not.toThrow();
    // Consume 10, produce 40: nets +30, so it needs at least 30 units of room.
    expect(() => {
      fits(100, 60, [-10, 40]);
    }).not.toThrow();
    expect(() => {
      fits(100, 95, [-10, 40]);
    }).toThrow(/warehouse/i);
  });

  it("refuses invalid capacity, usage and deltas", () => {
    expect(() => {
      fits(-1, 0, [1]);
    }).toThrow();
    expect(() => {
      fits(100, -1, [1]);
    }).toThrow();
    expect(() => {
      fits(100, 0, [1.5]);
    }).toThrow();
    expect(() => {
      fits(100, 0, [Number.NaN]);
    }).toThrow();
  });
});
