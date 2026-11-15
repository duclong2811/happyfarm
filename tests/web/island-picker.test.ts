import { describe, expect, it } from "vitest";
import { buildIslandGround, generateIsland, HOME_ISLAND_GRID_SIZE } from "@happy-farm/game-data";
import { ISLAND_SEED_LIMIT, PICKER_GRID_SIZE, islandPreviewPixels, islandSiteCounts, randomIslandSeed } from "../../apps/web/src/island-picker";

describe("island picker", () => {
  it("previews exactly the island the server will build", () => {
    expect(PICKER_GRID_SIZE).toBe(HOME_ISLAND_GRID_SIZE);
    const preview = generateIsland("KIM", 99, PICKER_GRID_SIZE, "LONG");
    const stored = buildIslandGround({ element: "KIM", outline: "LONG", seed: 99 });
    expect(preview.sites.length).toBe(stored.sites.length);
    expect(islandSiteCounts(preview).ore).toBe(6);
  });

  it("only ever offers seeds the server accepts", () => {
    expect(randomIslandSeed(() => 0)).toBe(1);
    expect(randomIslandSeed(() => 0.999999999999)).toBeLessThanOrEqual(ISLAND_SEED_LIMIT);
    for (let index = 0; index < 50; index += 1) {
      const seed = randomIslandSeed(Math.random);
      expect(Number.isInteger(seed) && seed >= 1 && seed <= ISLAND_SEED_LIMIT).toBe(true);
    }
  });

  it("paints one opaque pixel per cell", () => {
    const island = generateIsland("THUY", 5, 32, "ROUND");
    const pixels = islandPreviewPixels(island);
    expect(pixels.length).toBe(32 * 32 * 4);
    for (let index = 3; index < pixels.length; index += 4) expect(pixels[index]).toBe(255);
  });
});
