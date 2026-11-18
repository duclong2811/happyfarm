import { describe, expect, it } from "vitest";
import {
  buildIslandGround,
  generateIsland,
  islandCellCode,
  ISLAND_GENERATOR_VERSION,
  classifyIslandTile,
  HOME_ISLAND_GRID_ORIGIN,
  HOME_ISLAND_GRID_SIZE,
  islandCellKindAt,
  islandGroundCapabilities,
  isValidIslandCells,
  ISLAND_ELEMENTS,
  ISLAND_OUTLINES
} from "@happy-farm/game-data";

/** FNV-1a, so a silent change to generator v1 shows up as a failing fingerprint. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

describe("stored island ground", () => {
  it("lays every template on a well-formed grid centred on the old island", () => {
    for (const element of ISLAND_ELEMENTS) {
      for (const outline of ISLAND_OUTLINES) {
        const ground = buildIslandGround({ element, outline, seed: 4242 });
        expect(ground.size).toBe(HOME_ISLAND_GRID_SIZE);
        expect(isValidIslandCells(ground.cells, ground.size)).toBe(true);
        expect(ground.originX + ground.size / 2).toBe(18);
        expect(ground.originY + ground.size / 2).toBe(18);
      }
    }
  });

  it("refuses malformed cell strings", () => {
    expect(isValidIslandCells("dddd", 2)).toBe(true);
    expect(isValidIslandCells("ddd", 2)).toBe(false);
    expect(isValidIslandCells("ddxd", 2)).toBe(false);
  });

  it("treats everything off the grid as open sea", () => {
    const ground = buildIslandGround({ element: "THO", outline: "ROUND", seed: 9 });
    expect(islandCellKindAt(ground, { x: HOME_ISLAND_GRID_ORIGIN.x - 1, y: 0 })).toBe("DEEP");
    expect(islandCellKindAt(ground, { x: 0.5, y: 0 })).toBe("DEEP");
    expect(classifyIslandTile(ground, { x: 500, y: 500 }).terrain).toBe("WATER");
  });

  it("classifies sites for the job they exist for", () => {
    const kim = buildIslandGround({ element: "KIM", outline: "ROUND", seed: 31 });
    const ores = kim.sites.filter((site) => site.kind === "ORE");
    expect(ores.length).toBe(6);
    for (const ore of ores) {
      expect(classifyIslandTile(kim, ore).terrain).toBe("BLOCKED");
      expect(islandGroundCapabilities(kim, ore)).toEqual(["MINING"]);
    }
    const thuy = buildIslandGround({ element: "THUY", outline: "ROUND", seed: 31 });
    for (const bay of thuy.sites.filter((site) => site.kind === "FISH_BAY")) {
      const ground = classifyIslandTile(thuy, bay);
      expect(ground.terrain).toBe("WATER");
      expect(ground.shallowWater || ground.protectedGround).toBe(true);
    }
    const dock = thuy.sites.find((site) => site.kind === "DOCK");
    expect(dock).toBeDefined();
    if (dock !== undefined) {
      expect(classifyIslandTile(thuy, dock)).toMatchObject({ terrain: "SHORE", protectedGround: true });
    }
    const camp = thuy.sites.find((site) => site.kind === "CAMP");
    if (camp !== undefined) expect(classifyIslandTile(thuy, camp).terrain).toBe("LAND");
  });

  it("keeps generator v1 stable: stored v1 islands must stay reproducible", () => {
    const prints = ["THO", "KIM", "THUY"].map((element) =>
      fingerprint(generateIsland(element as "THO", 101, HOME_ISLAND_GRID_SIZE, "ROUND").cells.map(islandCellCode).join(""))
    );
    expect(prints).toMatchInlineSnapshot(`
      [
        "5b696f6f",
        "137cfc41",
        "5791f59b",
      ]
    `);
  });

  it("builds new farms with generator v2, and keeps v2 stable: a change must bump ISLAND_GENERATOR_VERSION", () => {
    expect(ISLAND_GENERATOR_VERSION).toBe(2);
    const prints = ["THO", "KIM", "THUY"].map((element) =>
      fingerprint(buildIslandGround({ element: element as "THO", outline: "ROUND", seed: 101 }).cells)
    );
    expect(buildIslandGround({ element: "KIM", outline: "ROUND", seed: 101 }).generatorVersion).toBe(2);
    expect(prints).toMatchInlineSnapshot(`
      [
        "a9e86741",
        "db6bd80b",
        "a823b412",
      ]
    `);
  });
});
