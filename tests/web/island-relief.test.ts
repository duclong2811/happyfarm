import { describe, expect, it } from "vitest";
import { generateHomeIsland, type GeneratedIsland } from "@happy-farm/game-data";
import { islandRelief, RELIEF_BASE_WORLD, RELIEF_TAG, RELIEF_WALKABLE_MAX_WORLD } from "../../apps/web/src/render/island-relief";

/**
 * Mountains on a chosen island (island-relief.ts): they rise from rock alone, Kim gets ranges, Hỏa
 * a volcano, every mine keeps a walkable way out, and the same island always gets the same relief.
 */

const SEEDS = [1, 77, 4242, 9001];

function reliefOf(island: GeneratedIsland) {
  return islandRelief({
    size: island.size,
    element: island.element,
    seed: island.seed,
    isRock: (index) => island.cells[index] === "ROCK",
    ore: island.sites.filter((site) => site.kind === "ORE")
  });
}

describe("island relief", () => {
  it("raises nothing but rock, so every field, building and crop stands on level ground", () => {
    for (const element of ["THO", "KIM", "MOC", "THUY", "HOA"] as const) {
      for (const seed of SEEDS) {
        const island = generateHomeIsland(element, seed, 96, "ROUND");
        const relief = reliefOf(island);
        island.cells.forEach((kind, index) => {
          if (kind !== "ROCK") expect(relief.height[index], `${element}/${String(seed)} ${kind}`).toBe(0);
          else expect(relief.height[index]).toBeGreaterThanOrEqual(RELIEF_BASE_WORLD - 1e-6);
        });
      }
    }
  });

  it("gives Kim mountain ranges, and every mine a walkable way out to open ground", () => {
    for (const seed of SEEDS) {
      const island = generateHomeIsland("KIM", seed, 96, "ROUND");
      const relief = reliefOf(island);
      const size = island.size;
      expect(Math.max(...relief.height), String(seed)).toBeGreaterThan(4);
      for (const site of island.sites.filter((entry) => entry.kind === "ORE")) {
        // Walk from the mine over cells no higher than a walker can climb, until open ground.
        const seen = new Uint8Array(size * size);
        const stack = [site.y * size + site.x];
        seen[site.y * size + site.x] = 1;
        let out = false;
        while (stack.length > 0) {
          const index = stack.pop() ?? 0;
          if (island.cells[index] !== "ROCK") {
            out = true;
            break;
          }
          const x = index % size;
          const y = (index - x) / size;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const next = (y + dy) * size + x + dx;
            if (seen[next] === 1 || (relief.height[next] ?? 0) > RELIEF_WALKABLE_MAX_WORLD) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
        expect(out, `KIM/${String(seed)} mine at ${String(site.x)},${String(site.y)}`).toBe(true);
        expect(relief.height[site.y * size + site.x]).toBeCloseTo(RELIEF_BASE_WORLD, 5);
      }
    }
  });

  it("gives Hỏa a volcano too high to climb, with lava in its crater", () => {
    for (const seed of SEEDS) {
      const island = generateHomeIsland("HOA", seed, 96, "ROUND");
      const relief = reliefOf(island);
      expect(relief.volcano, String(seed)).not.toBeNull();
      expect(Math.max(...relief.height)).toBeGreaterThan(RELIEF_WALKABLE_MAX_WORLD * 3);
      expect(relief.tag.includes(RELIEF_TAG.LAVA)).toBe(true);
    }
  });

  it("is the same relief for the same island", () => {
    const island = generateHomeIsland("KIM", 77, 96, "ROUND");
    expect(reliefOf(island)).toEqual(reliefOf(island));
  });
});
