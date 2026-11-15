import { describe, expect, it } from "vitest";
import { generateIsland, ISLAND_ELEMENTS, ISLAND_SHAPES, type IslandSiteKind } from "@happy-farm/domain";

const count = (kind: IslandSiteKind, sites: readonly { kind: IslandSiteKind }[]): number => sites.filter((site) => site.kind === kind).length;

describe("island generator", () => {
  it("is deterministic: the same element and seed always give the same island", () => {
    for (const element of ISLAND_ELEMENTS) {
      expect(generateIsland(element, 11)).toEqual(generateIsland(element, 11));
    }
    expect(generateIsland("THUY", 11).cells).not.toEqual(generateIsland("THUY", 29).cells);
  });

  it("gives each element its specialty", () => {
    for (const seed of [11, 29, 404]) {
      expect(count("ORE", generateIsland("KIM", seed).sites)).toBe(6);
      expect(count("TREE", generateIsland("MOC", seed).sites)).toBeGreaterThanOrEqual(120);
      expect(count("FISH_BAY", generateIsland("THUY", seed).sites)).toBeGreaterThanOrEqual(8);
      expect(count("PASTURE", generateIsland("HOA", seed).sites)).toBeGreaterThanOrEqual(5);
      for (const element of ISLAND_ELEMENTS) expect(count("DOCK", generateIsland(element, seed).sites)).toBe(1);
    }
  });

  it("puts every site on ground that suits it", () => {
    for (const element of ISLAND_ELEMENTS) {
      const island = generateIsland(element, 29);
      const kindAt = (x: number, y: number) => island.cells[y * island.size + x];
      for (const site of island.sites) {
        const kind = kindAt(site.x, site.y);
        if (site.kind === "FISH_BAY") expect(kind).toBe("SHALLOW");
        else if (site.kind === "DOCK") expect(kind).toBe("SAND");
        else expect(["DEEP", "SHALLOW"]).not.toContain(kind);
      }
    }
  });

  it("gives the water island a long coast: far more shoreline than a round island of the same size", () => {
    // Coast length relative to land area: a round island has the least coast for its size.
    const shoreline = (element: "THUY" | "THO"): number => {
      const island = generateIsland(element, 11);
      const water = (x: number, y: number): boolean => {
        const cell = island.cells[y * island.size + x];
        return cell === undefined || cell === "DEEP" || cell === "SHALLOW";
      };
      let land = 0;
      let coast = 0;
      for (let y = 0; y < island.size; y += 1) {
        for (let x = 0; x < island.size; x += 1) {
          if (water(x, y)) continue;
          land += 1;
          if (water(x + 1, y) || water(x - 1, y) || water(x, y + 1) || water(x, y - 1)) coast += 1;
        }
      }
      return coast / Math.sqrt(land);
    };
    expect(shoreline("THUY")).toBeGreaterThan(shoreline("THO") * 1.3);
  });

  it("keeps each element's specialty whatever outline the player picks", () => {
    for (const shape of ISLAND_SHAPES) {
      expect(generateIsland("KIM", 7, 96, shape).shape).toBe(shape);
      expect(count("ORE", generateIsland("KIM", 7, 96, shape).sites)).toBe(6);
      expect(count("FISH_BAY", generateIsland("THUY", 7, 96, shape).sites)).toBeGreaterThanOrEqual(8);
      expect(count("PASTURE", generateIsland("HOA", 7, 96, shape).sites)).toBeGreaterThanOrEqual(5);
    }
  });

  it("gives an atoll a shallow lagoon in the middle", () => {
    const atoll = generateIsland("THUY", 7, 96, "ATOLL");
    expect(atoll.cells[48 * 96 + 48]).toBe("SHALLOW");
    expect(generateIsland("THUY", 7, 96, "ROUND").cells[48 * 96 + 48]).not.toBe("SHALLOW");
  });
});
