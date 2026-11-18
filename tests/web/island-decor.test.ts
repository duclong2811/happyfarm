import { describe, expect, it } from "vitest";
import { buildIslandGround, ISLAND_DOCK_CLEARANCE_TILES, ISLAND_ELEMENTS, islandCellKindAt } from "@happy-farm/game-data";
import { islandDecorPlan, visibleIslandDecor } from "../../apps/web/src/render/island-decor";

/**
 * A chosen island's set dressing (island-decor.ts): a pier and a boat inside the dock's protected
 * radius, and a village on open land around the camp that never sits on the camp's spawn, a mine, a
 * tree or another piece - and that gives way wherever the player builds.
 */

const SEEDS = [1, 77, 4242];

function groundOf(element: (typeof ISLAND_ELEMENTS)[number], seed: number) {
  const ground = buildIslandGround({ element, outline: "ROUND", seed });
  return { ...ground, sites: ground.sites.map((site) => ({ ...site })) };
}

describe("island decor", () => {
  for (const element of ISLAND_ELEMENTS) {
    it(`${element}: a pier at the dock and a village around the camp, in sensible places`, () => {
      for (const seed of SEEDS) {
        const ground = groundOf(element, seed);
        const plan = islandDecorPlan(ground);
        const label = `${element}/${String(seed)}`;
        const dock = ground.sites.find((site) => site.kind === "DOCK");
        const camp = ground.sites.find((site) => site.kind === "CAMP");
        if (dock === undefined || camp === undefined) throw new Error(`${label} has no dock or camp`);

        // The pier and the boat stay inside the dock's protected radius, where nothing is built.
        expect(plan.pier, label).not.toBeNull();
        const pier = plan.pier;
        const boat = plan.boat;
        if (pier === null || boat === null) throw new Error(label);
        const end = { x: pier.x + pier.dirX * pier.lengthTiles, y: pier.y + pier.dirY * pier.lengthTiles };
        expect(Math.hypot(end.x - dock.x, end.y - dock.y), label).toBeLessThanOrEqual(ISLAND_DOCK_CLEARANCE_TILES + 0.5);
        expect(Math.hypot(boat.x - dock.x, boat.y - dock.y), label).toBeLessThanOrEqual(ISLAND_DOCK_CLEARANCE_TILES + 0.5);
        expect(["SHALLOW", "DEEP"], label).toContain(islandCellKindAt(ground, { x: Math.round(boat.x), y: Math.round(boat.y) }));

        const village = plan.props.filter((piece) => piece.id.startsWith("village."));
        expect(village.length, label).toBeGreaterThanOrEqual(6);
        const ores = ground.sites.filter((site) => site.kind === "ORE");
        for (const piece of village) {
          const where = `${label} ${piece.modelId}`;
          expect(["GRASS", "MEADOW", "FIELD"], where).toContain(islandCellKindAt(ground, { x: Math.round(piece.x), y: Math.round(piece.y) }));
          expect(Math.hypot(piece.x - camp.x, piece.y - camp.y), where).toBeGreaterThan(2.2);
          for (const ore of ores) expect(Math.hypot(piece.x - ore.x, piece.y - ore.y), where).toBeGreaterThan(3.5);
          for (const other of village) {
            if (other === piece) continue;
            expect(Math.hypot(piece.x - other.x, piece.y - other.y), `${where} vs ${other.modelId}`).toBeGreaterThan(Math.max(piece.radiusTiles, other.radiusTiles));
          }
        }
        for (const piece of plan.props.filter((entry) => entry.id.startsWith("dock."))) {
          expect(Math.hypot(piece.x - dock.x, piece.y - dock.y), `${label} ${piece.modelId}`).toBeLessThanOrEqual(ISLAND_DOCK_CLEARANCE_TILES);
        }
      }
    });
  }

  it("is the same village for the same island", () => {
    expect(islandDecorPlan(groundOf("THO", 77))).toEqual(islandDecorPlan(groundOf("THO", 77)));
  });

  it("gives way where the player builds, plants or tills", () => {
    const plan = islandDecorPlan(groundOf("THO", 77));
    const well = plan.props.find((piece) => piece.modelId === "civic.well.t1");
    if (well === undefined) throw new Error("no well");
    const all = visibleIslandDecor(plan.props, () => false);
    expect(all).toHaveLength(plan.props.length);
    // A barn built over the well's cell hides the well, and only what it covers.
    const built = (x: number, y: number) => x === Math.round(well.x) && y === Math.round(well.y);
    const shown = visibleIslandDecor(plan.props, built);
    expect(shown.some((piece) => piece.id === well.id)).toBe(false);
    expect(shown.length).toBeGreaterThanOrEqual(plan.props.length - 2);
  });
});
