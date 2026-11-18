import { describe, expect, it } from "vitest";
import { generateIslandV2, ISLAND_ELEMENTS, ISLAND_OUTLINES, type GeneratedIsland, type IslandCellKind } from "@happy-farm/game-data";

/**
 * Island generator v2 (`docs/briefs/ISLAND_V2.md`): every element, every outline, several seeds.
 *
 * The rules held: the same template is the same island; every land and shallow cell can be reached on
 * foot from the camp; no land touches deep water directly (there is always a shelf to wade); the open
 * sea surrounds the grid; sites sit on ground that means what they are; and each element keeps its
 * identity and its proportions whatever the seed.
 */

const SEEDS = [1, 77, 4242];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function at(island: GeneratedIsland, x: number, y: number): IslandCellKind | undefined {
  return x >= 0 && y >= 0 && x < island.size && y < island.size ? island.cells[y * island.size + x] : undefined;
}

const isWater = (kind: IslandCellKind | undefined): boolean => kind === undefined || kind === "DEEP" || kind === "SHALLOW";

function reachableFromCamp(island: GeneratedIsland): { reached: number; walkable: number } {
  const camp = island.sites.find((site) => site.kind === "CAMP");
  const size = island.size;
  const seen = new Uint8Array(size * size);
  let reached = 0;
  if (camp !== undefined) {
    const stack = [camp.y * size + camp.x];
    seen[camp.y * size + camp.x] = 1;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      reached += 1;
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of N4) {
        const kind = at(island, x + dx, y + dy);
        const next = (y + dy) * size + x + dx;
        if (kind === undefined || kind === "DEEP" || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return { reached, walkable: island.cells.filter((kind) => kind !== "DEEP").length };
}

describe("island generator v2", () => {
  it("is deterministic per template and different across seeds", () => {
    expect(generateIslandV2("THUY", 11, 96, "ROUND")).toEqual(generateIslandV2("THUY", 11, 96, "ROUND"));
    expect(generateIslandV2("THUY", 11, 96, "ROUND").cells).not.toEqual(generateIslandV2("THUY", 29, 96, "ROUND").cells);
  });

  for (const element of ISLAND_ELEMENTS) {
    for (const outline of ISLAND_OUTLINES) {
      it(`${element} ${outline}: walkable, shelved, bounded, with legal sites`, () => {
        for (const seed of SEEDS) {
          const island = generateIslandV2(element, seed, 96, outline);
          const label = `${element}/${outline}/${String(seed)}`;
          const count = (kind: string) => island.sites.filter((site) => site.kind === kind).length;

          // Everything walkable joins the camp.
          const { reached, walkable } = reachableFromCamp(island);
          expect(reached, label).toBe(walkable);

          // Land never meets deep water directly, and the grid's rim is open sea.
          for (let y = 0; y < island.size; y += 1) {
            for (let x = 0; x < island.size; x += 1) {
              const kind = at(island, x, y);
              if (!isWater(kind)) {
                for (const [dx, dy] of N4) expect(at(island, x + dx, y + dy), `${label} land at ${String(x)},${String(y)}`).not.toBe("DEEP");
              }
              if (x < 3 || y < 3 || x >= island.size - 3 || y >= island.size - 3) expect(kind, label).toBe("DEEP");
            }
          }

          // Identity: counts per element.
          expect(count("CAMP"), label).toBe(1);
          expect(count("DOCK"), label).toBe(1);
          expect(count("ORE"), label).toBe(element === "KIM" ? 6 : 3);
          if (element === "MOC") expect(count("TREE"), label).toBeGreaterThanOrEqual(120);
          if (element === "THUY") {
            expect(count("FISH_BAY"), label).toBe(10);
            expect(count("FISHING"), label).toBeGreaterThanOrEqual(6);
          }
          if (element === "HOA") expect(count("PASTURE"), label).toBeGreaterThanOrEqual(5);
          expect(count("FISHING"), label).toBeGreaterThanOrEqual(2);

          // Every site on ground that means what it is.
          for (const site of island.sites) {
            const kind = at(island, site.x, site.y);
            const where = `${label} ${site.kind} at ${String(site.x)},${String(site.y)}`;
            switch (site.kind) {
              case "CAMP":
                expect(["GRASS", "MEADOW"], where).toContain(kind);
                break;
              case "DOCK":
                expect(kind, where).toBe("SAND");
                expect(N4.some(([dx, dy]) => at(island, site.x + dx, site.y + dy) === "SHALLOW"), where).toBe(true);
                break;
              case "ORE":
                expect(isWater(kind) || kind === "SAND", where).toBe(false);
                break;
              case "FISH_BAY":
                expect(kind, where).toBe("SHALLOW");
                break;
              case "FISHING": {
                expect(kind, where).toBe("DEEP");
                // Within a cast of the shelf: some walkable cell is at most 2.5 cells away.
                let near = false;
                for (let dy = -3; dy <= 3 && !near; dy += 1) {
                  for (let dx = -3; dx <= 3 && !near; dx += 1) {
                    if (Math.hypot(dx, dy) <= 2.5 && at(island, site.x + dx, site.y + dy) !== "DEEP" && at(island, site.x + dx, site.y + dy) !== undefined) near = true;
                  }
                }
                expect(near, where).toBe(true);
                break;
              }
              case "PASTURE":
                expect(kind, where).toBe("MEADOW");
                break;
              case "TREE":
                expect(isWater(kind) || kind === "SAND", where).toBe(false);
                break;
            }
          }
        }
      });
    }
  }

  it("keeps each element's proportions whatever the seed", () => {
    const share = (island: GeneratedIsland, kind: IslandCellKind): number => {
      const interior = island.cells.filter((cell) => !isWater(cell) && cell !== "SAND").length;
      return island.cells.filter((cell) => cell === kind).length / interior;
    };
    for (const seed of SEEDS) {
      expect(share(generateIslandV2("KIM", seed, 96, "ROUND"), "ROCK")).toBeCloseTo(0.3, 1);
      expect(share(generateIslandV2("HOA", seed, 96, "ROUND"), "ROCK")).toBeLessThan(0.12);
      expect(share(generateIslandV2("THO", seed, 96, "ROUND"), "FIELD")).toBeGreaterThan(0.3);
      expect(share(generateIslandV2("MOC", seed, 96, "ROUND"), "FOREST")).toBeGreaterThan(0.6);
      // Thủy has the widest shelf: more shallows than any other element.
      const shallows = (element: "THUY" | "THO") => generateIslandV2(element, seed, 96, "ROUND").cells.filter((cell) => cell === "SHALLOW").length;
      expect(shallows("THUY")).toBeGreaterThan(shallows("THO") * 1.8);
    }
  });

  it("stays inside a Worker's CPU budget", () => {
    // Warm the JIT, then time a spread of templates. Generous for a shared CI machine; the bench in
    // the v2 work measured about 5.5-6 ms per island against v1's 4 ms.
    for (let warm = 0; warm < 10; warm += 1) generateIslandV2("THO", warm, 96, "ROUND");
    const start = performance.now();
    let runs = 0;
    for (const element of ISLAND_ELEMENTS) {
      for (const outline of ISLAND_OUTLINES) {
        generateIslandV2(element, 900 + runs, 96, outline);
        runs += 1;
      }
    }
    expect((performance.now() - start) / runs).toBeLessThan(15);
  });
});
