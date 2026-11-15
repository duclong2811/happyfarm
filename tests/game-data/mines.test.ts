import { describe, expect, it } from "vitest";
import {
  ISLAND_ELEMENTS,
  ISLAND_OUTLINES,
  MINE_LEVELS,
  buildIslandGround,
  islandCellKindAt,
  islandMineTiles,
  mineSlotLevels
} from "@happy-farm/game-data";

describe("mine levels", () => {
  it("is the agreed ten-level ladder, rising in output, level and cost", () => {
    expect(MINE_LEVELS.map((entry) => entry.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(MINE_LEVELS[0]).toMatchObject({ orePerHour: 60, requiredPlayerLevel: 1, upgradeCost: null });
    expect(MINE_LEVELS[9]).toMatchObject({ orePerHour: 700, requiredPlayerLevel: 100, upgradeCost: { gold: 200_000, wood: 16_000, ore: 40_000 } });
    for (let index = 1; index < MINE_LEVELS.length; index += 1) {
      const previous = MINE_LEVELS[index - 1];
      const current = MINE_LEVELS[index];
      if (previous === undefined || current?.upgradeCost == null) throw new Error("ladder has a hole");
      expect(current.orePerHour).toBeGreaterThan(previous.orePerHour);
      expect(current.requiredPlayerLevel).toBeGreaterThan(previous.requiredPlayerLevel);
      expect(current.upgradeCost.gold).toBeGreaterThan(previous.upgradeCost?.gold ?? 0);
    }
  });

  it("opens three slots on most islands and six on Kim", () => {
    expect(mineSlotLevels(null)).toEqual([1, 20, 50]);
    expect(mineSlotLevels("THUY")).toEqual([1, 20, 50]);
    expect(mineSlotLevels("KIM")).toEqual([1, 10, 20, 35, 50, 70]);
  });
});

describe("island mine tiles", () => {
  it("finds every slot on solid ground, apart, for every element and outline", () => {
    for (const element of ISLAND_ELEMENTS) {
      for (const outline of ISLAND_OUTLINES) {
        for (const seed of [1, 77, 4242]) {
          const ground = buildIslandGround({ element, outline, seed });
          const count = mineSlotLevels(element).length;
          const tiles = islandMineTiles(ground, count);
          expect(tiles, `${element}/${outline}/${String(seed)}`).toHaveLength(count);
          tiles.forEach((tile, index) => {
            const kind = islandCellKindAt(ground, tile);
            expect(["DEEP", "SHALLOW", "SAND"]).not.toContain(kind);
            for (const other of tiles.slice(index + 1)) expect(Math.hypot(other.x - tile.x, other.y - tile.y)).toBeGreaterThanOrEqual(4);
          });
          // Same island, same answer.
          expect(islandMineTiles(ground, count)).toEqual(tiles);
        }
      }
    }
  });

  it("puts the island's own ore sites first", () => {
    const ground = buildIslandGround({ element: "KIM", outline: "ROUND", seed: 9 });
    const ore = ground.sites.filter((site) => site.kind === "ORE").map((site) => ({ x: site.x, y: site.y }));
    expect(islandMineTiles(ground, 6)).toEqual(ore);
  });
});
