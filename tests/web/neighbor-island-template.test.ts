import { describe, expect, it } from "vitest";
import { NEIGHBOR_PREVIEW_WATER_SCALE, neighborForestLayout, neighborGroundHeight, neighborIslandTemplate, neighborLandDepth, neighborOutlineRadius, neighborPresentationCenter, neighborWaterDepth, neighborWorldPoint } from "../../apps/web/src/render/neighbor-island-template";
import { islandRimPoint } from "../../apps/web/src/render/terrain-height";
import { ISLAND_HALF_DEPTH_WORLD, ISLAND_HALF_WIDTH_WORLD, ISLAND_SHAPE, WORLD_CENTER_WORLD } from "../../apps/web/src/render/world-config";

describe("neighbour island templates", () => {
  it("keeps the Mộc outline deterministic, irregular and finite", () => {
    const template = neighborIslandTemplate("MOC");
    const samples = Array.from({ length: 32 }, (_, index) => neighborOutlineRadius(template, index * Math.PI / 16));
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.08);
    expect(neighborWorldPoint(template, { x: 112, z: 0 }, 0, 1)).toEqual(
      neighborWorldPoint(template, { x: 112, z: 0 }, 0, 1)
    );
    expect(neighborGroundHeight(template, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(neighborGroundHeight(template, 0, 0)).toBeLessThanOrEqual(template.relief);
  });

  it("keeps all four future island identities on the same stable contract", () => {
    for (const kind of ["MOC", "KIM", "THUY", "HOA"] as const) {
      const template = neighborIslandTemplate(kind);
      expect(template.kind).toBe(kind);
      expect(template.radiusX).toBeGreaterThan(10);
      expect(template.radiusZ).toBeGreaterThan(10);
      expect(Number.isFinite(template.dockLocal.x)).toBe(true);
      expect(Number.isFinite(template.npcLocal.z)).toBe(true);
      expect(Number.isFinite(template.workLocal.x)).toBe(true);
      expect(template.supportLocal.length).toBeGreaterThan(0);
    }
  });

  it("gives the three live islands different readable working layouts", () => {
    const moc = neighborIslandTemplate("MOC");
    const kim = neighborIslandTemplate("KIM");
    const thuy = neighborIslandTemplate("THUY");
    expect(moc.supportLocal.some((detail) => detail.kind === "TREE")).toBe(true);
    expect(kim.supportLocal.some((detail) => detail.kind === "ROCK")).toBe(true);
    expect(thuy.supportLocal.some((detail) => detail.kind === "WATER")).toBe(true);
    expect(new Set([moc.radiusX, kim.radiusX, thuy.radiusX]).size).toBeGreaterThan(1);
  });

  it("derives profession terrain and LOD detail from the same authored profile", () => {
    const moc = neighborIslandTemplate("MOC");
    const kim = neighborIslandTemplate("KIM");
    const thuy = neighborIslandTemplate("THUY");
    expect(moc.terrainKind).toBe("FOREST");
    expect(neighborForestLayout(moc, 3701)).toEqual(neighborForestLayout(moc, 3701));
    expect(neighborForestLayout(moc, 3701).length).toBeGreaterThan(moc.forestLocal.length);
    expect(kim.terrainKind).toBe("RIDGE");
    expect(kim.ridgeLines.length).toBeGreaterThan(1);
    expect(kim.oreLocal.length).toBeGreaterThan(5);
    expect(neighborGroundHeight(kim, -5, -2)).toBeGreaterThan(neighborGroundHeight(moc, -5, -2));
    expect(thuy.terrainKind).toBe("COAST");
    expect(thuy.waterChannels.length).toBeGreaterThan(1);
    expect(neighborWaterDepth(thuy, 2, 13)).toBeGreaterThan(0.9);
    expect(thuy.waterChannels.every((pond) => pond.length < 20 && pond.width < 20)).toBe(true);
    expect(moc.presentationProps.some((prop) => prop.id.includes("stump"))).toBe(true);
    expect(kim.supportLocal.some((detail) => detail.kind === "TREE" || detail.kind === "BUSH")).toBe(true);
    expect(moc.forestZones.map((zone) => zone.count)).toEqual([17, 15, 14, 18]);
    expect(moc.forestZones.every((zone) => zone.count >= 14)).toBe(true);
    expect(moc.radiusX).toBe(56);
    expect(moc.radiusZ).toBe(50);
    expect(neighborForestLayout(moc, 3701)).toHaveLength(76);
    expect(moc.supportLocal.filter((detail) => detail.kind === "TREE")).toHaveLength(9);
  });

  it("keeps persisted gameplay coordinates without a presentation transform", () => {
    const stored = { x: 112, z: 0 };
    const moc = neighborPresentationCenter("MOC", stored);
    const kim = neighborPresentationCenter("KIM", { x: -112, z: 0 });
    const thuy = neighborPresentationCenter("THUY", { x: 0, z: 112 });
    expect(moc).toEqual(stored);
    expect(kim).toEqual({ x: -112, z: 0 });
    expect(thuy).toEqual({ x: 0, z: 112 });
    // HOME's visual half-width is ~58.9m; the live island's water shell is under 61m.
    // The nearest HOME/Mộc edges are therefore separated by more than 45m and cannot be walked.
  });

  it("keeps the HOME LOD water shells separated from HOME and one another", () => {
    const home = {
      minX: WORLD_CENTER_WORLD.worldX - ISLAND_HALF_WIDTH_WORLD,
      maxX: WORLD_CENTER_WORLD.worldX + ISLAND_HALF_WIDTH_WORLD,
      minZ: WORLD_CENTER_WORLD.worldZ - ISLAND_HALF_DEPTH_WORLD,
      maxZ: WORLD_CENTER_WORLD.worldZ + ISLAND_HALF_DEPTH_WORLD
    };
    const islands = [
      { slot: "MOC" as const, x: 112, z: 0 },
      { slot: "KIM" as const, x: -112, z: 0 },
      { slot: "THUY" as const, x: 0, z: 112 }
    ].map((item) => {
      const template = neighborIslandTemplate(item.slot);
      const shellX = template.radiusX * 1.15 * NEIGHBOR_PREVIEW_WATER_SCALE;
      const shellZ = template.radiusZ * 1.15 * NEIGHBOR_PREVIEW_WATER_SCALE;
      return { ...item, minX: item.x - shellX, maxX: item.x + shellX, minZ: item.z - shellZ, maxZ: item.z + shellZ };
    });
    for (const island of islands) {
      expect(island.minX > home.maxX || island.maxX < home.minX || island.minZ > home.maxZ || island.maxZ < home.minZ).toBe(true);
    }
    for (let index = 0; index < islands.length; index += 1) {
      for (let other = index + 1; other < islands.length; other += 1) {
        const a = islands[index];
        const b = islands[other];
        if (a === undefined || b === undefined) continue;
        expect(a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ).toBe(true);
      }
    }
  });

  it("keeps transformed HOME and neighbour water shells separated by a real sea corridor", () => {
    const sampleCount = 128;
    const homeScale = NEIGHBOR_PREVIEW_WATER_SCALE * 1.14;
    const neighbourScale = NEIGHBOR_PREVIEW_WATER_SCALE * 1.12;
    const homePoints = Array.from({ length: sampleCount }, (_, index) => {
      const rim = islandRimPoint(index / sampleCount * Math.PI * 2, ISLAND_SHAPE);
      return {
        x: WORLD_CENTER_WORLD.worldX + (rim.worldX - WORLD_CENTER_WORLD.worldX) * homeScale,
        z: WORLD_CENTER_WORLD.worldZ + (rim.worldZ - WORLD_CENTER_WORLD.worldZ) * homeScale
      };
    });
    const neighbourPoints = (slot: "MOC" | "KIM" | "THUY", center: { x: number; z: number }) => {
      const template = neighborIslandTemplate(slot);
      return Array.from({ length: sampleCount }, (_, index) => neighborWorldPoint(template, center, index / sampleCount * Math.PI * 2, neighbourScale));
    };
    const minimumDistance = (left: readonly { x: number; z: number }[], right: readonly { x: number; z: number }[]) => {
      let minimum = Number.POSITIVE_INFINITY;
      for (const a of left) for (const b of right) minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.z - b.z));
      return minimum;
    };
    const moc = neighbourPoints("MOC", { x: 112, z: 0 });
    const kim = neighbourPoints("KIM", { x: -112, z: 0 });
    const thuy = neighbourPoints("THUY", { x: 0, z: 112 });
    expect(minimumDistance(homePoints, moc)).toBeGreaterThan(15);
    expect(minimumDistance(homePoints, kim)).toBeGreaterThan(15);
    expect(minimumDistance(homePoints, thuy)).toBeGreaterThan(15);
    expect(minimumDistance(moc, thuy)).toBeGreaterThan(8);
    expect(minimumDistance(kim, thuy)).toBeGreaterThan(8);
  });

  it("keeps every NPC settlement footprint and access route on dry, in-bounds terrain", () => {
    for (const kind of ["MOC", "KIM", "THUY"] as const) {
      const template = neighborIslandTemplate(kind);
      for (const point of [template.dockLocal, template.npcLocal, template.houseLocal, template.storeLocal, template.workLocal]) {
        expect(neighborLandDepth(template, point.x, point.z), `${kind} land ${String(point.x)},${String(point.z)}`).toBeLessThan(0);
        if (point !== template.dockLocal) {
          expect(neighborWaterDepth(template, point.x, point.z), `${kind} water ${String(point.x)},${String(point.z)}`).toBeLessThanOrEqual(0.22);
        }
      }
      const routePoints = [template.dockLocal, template.npcLocal, template.houseLocal, template.storeLocal, template.workLocal];
      for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        if (start === undefined || end === undefined) continue;
        for (let step = 0; step <= 10; step += 1) {
          const amount = step / 10;
          const x = start.x + (end.x - start.x) * amount;
          const z = start.z + (end.z - start.z) * amount;
          expect(neighborLandDepth(template, x, z), `${kind} route ${String(index)}:${String(step)}`).toBeLessThan(0.08);
          if (index !== 0 || step >= 3) {
            expect(neighborWaterDepth(template, x, z), `${kind} route-water ${String(index)}:${String(step)}`).toBeLessThanOrEqual(0.22);
          }
        }
      }
    }
    const thuy = neighborIslandTemplate("THUY");
    expect(neighborWaterDepth(thuy, 2, 13)).toBeGreaterThan(0.9);
    expect(neighborLandDepth(thuy, 2, 13)).toBeLessThan(0);
  });
});
