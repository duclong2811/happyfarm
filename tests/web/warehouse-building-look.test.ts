import { describe, expect, it } from "vitest";
import { WAREHOUSE_TIER_LOOKS, warehouseLookFor } from "../../apps/web/src/render/buildings";
import { BUILDING_MODELS } from "../../apps/web/src/render/building-model-urls";
import { warehouseTiers } from "@happy-farm/game-data";

describe("the storage building grows with the warehouse", () => {
  it("has a shipped look for every warehouse tier game data defines", () => {
    for (const tier of warehouseTiers) {
      const look = warehouseLookFor(tier.tier);
      expect(look, `tier ${String(tier.tier)}`).not.toBeNull();
      expect(BUILDING_MODELS.has(look ?? ""), `tier ${String(tier.tier)}`).toBe(true);
    }
    expect(WAREHOUSE_TIER_LOOKS.length).toBeGreaterThanOrEqual(warehouseTiers.length);
  });

  it("never shrinks as the tier rises, and draws nothing special before the tier is known", () => {
    const sizes = WAREHOUSE_TIER_LOOKS.map((id) => BUILDING_MODELS.get(id)?.sizeWorld ?? 0);
    for (let index = 1; index < sizes.length; index += 1) expect(sizes[index]).toBeGreaterThanOrEqual(sizes[index - 1] ?? 0);
    expect(warehouseLookFor(null)).toBeNull();
    expect(warehouseLookFor(-1)).toBeNull();
    expect(warehouseLookFor(99)).toBe(WAREHOUSE_TIER_LOOKS[WAREHOUSE_TIER_LOOKS.length - 1]);
  });
});
