import { describe, expect, it } from "vitest";
import { buildIslandGround, ISLAND_DOCK_CLEARANCE_TILES, ISLAND_ELEMENTS, islandCellKindAt } from "@happy-farm/game-data";
import { islandDecorPlan } from "../../apps/web/src/render/island-decor";

/**
 * A chosen island's set dressing (island-decor.ts): a pier and a boat inside the dock's protected
 * radius, and a village on open land around the camp that never sits on the camp's spawn, a mine, a
 * tree or another piece - and that moves out of the way of the player's fields and buildings.
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

  it("moves out of the way of the player's fields instead of standing in them", () => {
    const untouched = islandDecorPlan(groundOf("THO", 77));
    const well = untouched.props.find((piece) => piece.modelId === "viet_well");
    if (well === undefined) throw new Error("no well");
    // The player tills a 7x7 field right where the well stood.
    const field = (x: number, y: number) => Math.abs(x - Math.round(well.x)) <= 3 && Math.abs(y - Math.round(well.y)) <= 3;
    const moved = islandDecorPlan(groundOf("THO", 77), field);
    const wellNow = moved.props.find((piece) => piece.modelId === "viet_well");
    expect(wellNow).toBeDefined();
    expect(field(Math.round(wellNow?.x ?? 0), Math.round(wellNow?.y ?? 0))).toBe(false);
  });

  it("keeps a village on an island whose camp is ringed by fields (the owner's own Hỏa island)", () => {
    // About 400 tilled cells around the camp, as on the staging farm that hid its whole village.
    const ground = { ...buildIslandGround({ element: "HOA", outline: "ROUND", seed: 1651848797 }) };
    const camp = ground.sites.find((site) => site.kind === "CAMP");
    if (camp === undefined) throw new Error("no camp");
    const farmed = (x: number, y: number) => Math.abs(x - camp.x) <= 11 && Math.abs(y - camp.y) <= 12 && Math.hypot(x - camp.x, y - camp.y) > 1.5;
    const plan = islandDecorPlan({ ...ground, sites: ground.sites.map((site) => ({ ...site })) }, farmed);
    const village = plan.props.filter((piece) => piece.id.startsWith("village."));
    expect(village.length).toBeGreaterThanOrEqual(8);
    for (const piece of village) expect(farmed(Math.round(piece.x), Math.round(piece.y)), piece.modelId).toBe(false);
  });
});
