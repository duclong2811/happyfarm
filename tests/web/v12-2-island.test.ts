import { describe, expect, it } from "vitest";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import { createSharedAssets } from "../../apps/web/src/render/materials";
import { ROAD_CLEARANCE_WORLD } from "../../apps/web/src/render/placement";
import { movementDestination, selectableCellAt } from "../../apps/web/src/render/world-cell-selection";
import { buildLandOwnership } from "../../apps/web/src/render/land-ownership";
import { cellKey } from "../../apps/web/src/render/world-cell";
import {
  getAvailableCellActions,
  type CellActionId
} from "../../apps/web/src/render/world-cell-actions";
import {
  FARM_FIELD_BOUNDS,
  PLAZA,
  ROADS,
  ROAD_SHOULDER_WORLD,
  ROAD_WIDTH_TILES
} from "../../apps/web/src/render/world-config";

/**
 * The V12.2 island: its road is dirt, its village is paved, and nothing grows in the road.
 *
 * The brief for this pass is mostly about *consistency* - the map the island starts with must match
 * the game it is the start of - so these are the things a player would notice: a road they can see
 * from the estate camera, the paving that starts where the village does, and the ground between them
 * still being land nobody has built on.
 */

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_v122",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 500,
    requiredLevel: 1,
    unlocked
  };
}

function starterTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

function starterScene() {
  const owned = starterTiles();
  return buildFarmSceneInput({
    tiles: owned.map((entry) => tile(entry.x, entry.y)),
    crops: [],
    trees: [],
    plots: [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1)),
    selected: null
  });
}

/** How far a point is from the nearest road's *rendered* edge - ribbon plus shoulder. */
function clearanceFromRoad(worldX: number, worldZ: number, world: ReturnType<typeof starterScene>["world"]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const road of world.roads) {
    const edge = road.widthWorld / 2 + ROAD_SHOULDER_WORLD[road.kind];
    for (const sample of road.samples) {
      best = Math.min(best, Math.hypot(worldX - sample.worldX, worldZ - sample.worldZ) - edge);
    }
  }
  return best;
}

describe("the island's own road", () => {
  const { world } = starterScene();

  it("is dirt from the harbour to the village, and paved nowhere else", () => {
    const spine = ROADS.find((road) => road.id === "harbour_spine");
    expect(spine?.kind).toBe("SECONDARY");
    // Only the two cheap classes are authored: a stone or paved road in the starting world would be
    // infrastructure the player is supposed to build.
    expect(new Set(ROADS.map((road) => road.kind))).toEqual(new Set(["SECONDARY", "PATH"]));
    expect(ROAD_WIDTH_TILES.SECONDARY).toBeGreaterThanOrEqual(2);
  });

  it("keeps large scenery out of its clearance corridor", () => {
    // The rule is the one `placementRejection` applies: the rendered edge plus ROAD_CLEARANCE_WORLD,
    // scaled by how big the thing is. A tree keeps half again the base margin, because a canopy that
    // clears the road with its trunk can still hang over it.
    const large = new Set(["tree", "pine", "bush", "rock"]);
    const scaleFor = (kind: string): number => (kind === "tree" || kind === "pine" ? 1.5 : 1.2);
    const offenders = world.scenery
      .filter((entry) => large.has(entry.kind))
      .map((entry) => ({
        entry,
        clearance: clearanceFromRoad(entry.worldX, entry.worldZ, world)
      }))
      .filter(
        ({ entry, clearance }) => clearance < ROAD_CLEARANCE_WORLD * scaleFor(entry.kind) - 0.001
      );
    expect(
      offenders.map(({ entry, clearance }) => `${entry.kind} ${clearance.toFixed(2)}m from the road edge`),
      "nothing large may stand inside a road's clearance corridor"
    ).toEqual([]);
    // …and the corridor is not so wide that it empties the island of scenery.
    expect(world.scenery.length).toBeGreaterThan(60);
  });

  it("leaves the road itself clear of the farm's own land", () => {
    for (const road of world.roads) {
      for (const sample of road.samples) {
        const insideReserve =
          sample.worldX >= FARM_FIELD_BOUNDS.minX * 1.08 - 5.5 * 1.08 &&
          sample.worldX <= (FARM_FIELD_BOUNDS.maxX + 1) * 1.08 - 5.5 * 1.08 &&
          sample.worldZ >= FARM_FIELD_BOUNDS.minY * 1.08 - 5.5 * 1.08 &&
          sample.worldZ <= (FARM_FIELD_BOUNDS.maxY + 1) * 1.08 - 5.5 * 1.08;
        expect(insideReserve, `${road.id} runs through the land the catalogue sells`).toBe(false);
      }
    }
  });
});

describe("the village is the only paved place", () => {
  it("draws a plaza with its own surface, and that surface is not the road's", () => {
    const { world } = starterScene();
    expect(world.plaza.radiusWorldX).toBeGreaterThan(0);
    expect(world.plaza.radiusWorldZ).toBeGreaterThan(0);
    const assets = createSharedAssets();
    try {
      // The plaza is paved: its material is deliberately not the dirt the road is made of. (The two
      // are different shades in the same palette, which is what makes the transition read.)
      expect(assets.plaza.color.getHex()).not.toBe(assets.roadDirt.color.getHex());
      expect(assets.plaza.color.getHex()).not.toBe(assets.roadStone.color.getHex());
    } finally {
      assets.dispose();
    }
    // The plaza's own centre is inside the settlement, which is the one place a district still
    // decides anything: civic ground grows no crops.
    expect(PLAZA.center).toEqual({ x: 45, y: 3 });
  });
});

describe("starter ownership and movement are untouched", () => {
  const scene = starterScene();

  it("still starts the player with the same twelve-tile square", () => {
    const ownership = buildLandOwnership({ cells: scene.cells, ownedTiles: starterTiles() });
    // V12.2 changes no server-authoritative land: the starter square is the same 144 cells, and the
    // share of the island is a measurement rather than a decision.
    expect(ownership.ownedCellCount).toBe(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(ownership.ownedCells.has(cellKey(0, 0))).toBe(true);
    expect(ownership.ownedCells.has(cellKey(INITIAL_LAND_SIZE, 0))).toBe(false);
    expect(ownership.eligibleBlocks.length).toBeGreaterThan(0);
  });

  it("still moves a character to any walkable cell the player clicks", () => {
    const owned = scene.cells.cells.get(cellKey(3, 3));
    expect(owned).toBeDefined();
    if (owned === undefined) throw new Error("the starter field must be on the map");
    // Nothing solid stands on the player's own field, so a click there is a destination.
    expect(movementDestination(owned, scene.cells, () => false)).not.toBeNull();
    // …and refuses the sea, exactly as before.
    const sea = [...scene.cells.cells.values()].find((cell) => cell.terrain === "WATER" && cell.zone === "NONE");
    if (sea === undefined) throw new Error("the island must have open water");
    expect(movementDestination(sea, scene.cells, () => false)).toBeNull();
  });

  it("still offers the same actions on the player's own field", () => {
    const farmland = scene.cells.cells.get(cellKey(3, 3));
    if (farmland === undefined) throw new Error("the starter field must be on the map");
    const actions = getAvailableCellActions(farmland, { canPlant: true, crop: null, tree: null });
    const ids: CellActionId[] = actions.map((action) => action.id);
    expect(ids).toEqual(["MOVE", "PLANT"]);
    expect(selectableCellAt(scene.cells, { worldX: 0, worldZ: 0 })).not.toBeNull();
  });
});
