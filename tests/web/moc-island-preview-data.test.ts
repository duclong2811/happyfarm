import { describe, expect, it } from "vitest";
import { MOC_PREVIEW_LAYOUT, mocPresentationDockWorld, mocPresentationSpawnWorld, mocPreviewForestPlacements } from "../../apps/web/src/moc-island-preview-data";
import { neighborLandDepth } from "../../apps/web/src/render/neighbor-island-template";

function distance(a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distanceToSegment(point: { readonly x: number; readonly z: number }, start: { readonly x: number; readonly z: number }, end: { readonly x: number; readonly z: number }): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.001) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return distance(point, { x: start.x + dx * t, z: start.z + dz * t });
}

describe("Mộc dev preview layout", () => {
  it("keeps a stable seed and three readable forest masses", () => {
    expect(MOC_PREVIEW_LAYOUT.seed).toBe(20261018);
    expect(MOC_PREVIEW_LAYOUT.placements.filter((placement) => placement.group === "FOREST_BACK")).toHaveLength(34);
    expect(MOC_PREVIEW_LAYOUT.placements.filter((placement) => placement.group === "FOREST_LEFT")).toHaveLength(18);
    expect(MOC_PREVIEW_LAYOUT.placements.filter((placement) => placement.group === "FOREST_RIGHT")).toHaveLength(18);
  });

  it("puts forest placements on the template land and clear of routes/settlement", () => {
    const forest = MOC_PREVIEW_LAYOUT.placements.filter((placement) => placement.group.startsWith("FOREST_"));
    const house = MOC_PREVIEW_LAYOUT.placements.find((placement) => placement.id === "farmhouse");
    const barn = MOC_PREVIEW_LAYOUT.placements.find((placement) => placement.id === "storage-barn-t1");
    const yard = MOC_PREVIEW_LAYOUT.placements.find((placement) => placement.id === "workbench");
    if (house === undefined || barn === undefined || yard === undefined) throw new Error("preview anchors are missing");
    for (const placement of forest) {
      expect(neighborLandDepth(MOC_PREVIEW_LAYOUT.template, placement.x, placement.z)).toBeLessThan(0);
      expect(distance(placement, house)).toBeGreaterThanOrEqual(7);
      expect(distance(placement, barn)).toBeGreaterThanOrEqual(7);
      expect(distance(placement, yard)).toBeGreaterThanOrEqual(7);
      for (const route of MOC_PREVIEW_LAYOUT.routes) {
        for (let index = 1; index < route.points.length; index += 1) {
          const start = route.points[index - 1];
          const end = route.points[index];
          if (start !== undefined && end !== undefined) expect(distanceToSegment(placement, start, end)).toBeGreaterThanOrEqual(2.8);
        }
      }
    }
  });

  it("records the missing log-pile asset instead of substituting a stump", () => {
    expect(MOC_PREVIEW_LAYOUT.missing.map((item) => item.id)).toContain("log_pile");
    expect(MOC_PREVIEW_LAYOUT.placements.some((placement) => placement.modelId.includes("stump"))).toBe(false);
  });

  it("derives the dock from the front shoreline instead of the old inland hint", () => {
    const { dock, template } = MOC_PREVIEW_LAYOUT;
    expect(dock.oldHintDelta).toBeGreaterThan(20);
    expect(neighborLandDepth(template, dock.land.x, dock.land.z)).toBeLessThan(0);
    expect(Math.abs(neighborLandDepth(template, dock.shore.x, dock.shore.z))).toBeLessThan(0.002);
    expect(neighborLandDepth(template, dock.water.x, dock.water.z)).toBeGreaterThan(0.02);
    const dockRoute = MOC_PREVIEW_LAYOUT.routes.find((route) => route.id === "dock-to-fork");
    expect(dockRoute?.points[0]).toEqual(dock.land);
  });

  it("uses one world conversion for the active dock and arrival spawn", () => {
    const center = { x: 112, z: 0 };
    const dock = mocPresentationDockWorld(center);
    const spawn = mocPresentationSpawnWorld(center);
    expect(dock).toEqual({ x: center.x + MOC_PREVIEW_LAYOUT.dock.land.x, z: center.z + MOC_PREVIEW_LAYOUT.dock.land.z });
    expect(Math.hypot(spawn.x - dock.x, spawn.z - dock.z)).toBeCloseTo(2, 6);
    expect(mocPreviewForestPlacements()).toHaveLength(70);
  });
});
