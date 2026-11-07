import { describe, expect, it } from "vitest";
import {
  AUTO_WALK_SPEED_WORLD_PER_SECOND,
  FARM_MARKET_ANCHOR_TILE,
  FARM_MARKET_BUILDING_KEY,
  FARM_TILE_PITCH_WORLD,
  HOME_WAREHOUSE_ANCHOR_TILE,
  HOME_WAREHOUSE_BUILDING_KEY,
  STARTER_WORLD_PLACEMENTS,
  WORLD_OBJECT_DEFINITIONS,
  classifyTile
} from "@happy-farm/game-data";

/**
 * The two tiles Auto walks to, checked against the island they stand on.
 *
 * A stand tile is only "the place you use the Warehouse" if it is dry land nobody has built on and it
 * is actually next to the building it belongs to. All three are asserted here rather than promised in
 * a comment, because the anchors are derived from the starter layout: move the barn and this test
 * tells you whether its new doorstep is somewhere a character can stand.
 */

const PITCH = FARM_TILE_PITCH_WORLD;

function boundsFor(anchorX: number, anchorY: number, footprintCells: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const startX = Math.floor(anchorX) - Math.floor((footprintCells - 1) / 2);
  const startY = Math.floor(anchorY) - Math.floor((footprintCells - 1) / 2);
  return { minX: startX, maxX: startX + footprintCells - 1, minY: startY, maxY: startY + footprintCells - 1 };
}

function placementFor(key: string) {
  const placement = STARTER_WORLD_PLACEMENTS.find((candidate) => candidate.key === key);
  expect(placement, `starter placement ${key}`).toBeDefined();
  return placement as (typeof STARTER_WORLD_PLACEMENTS)[number];
}

/** Every other starter object, as the rectangle it stands on. */
function otherFootprints(exceptKey: string): readonly { readonly key: string; readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }[] {
  return STARTER_WORLD_PLACEMENTS.filter((placement) => placement.key !== exceptKey).map((placement) => {
    const definition = WORLD_OBJECT_DEFINITIONS.find((candidate) => candidate.id === placement.definitionId);
    const cells = definition?.footprint.widthCells ?? 1;
    return { key: placement.key, ...boundsFor(placement.tile.x, placement.tile.y, cells) };
  });
}

function occupiedBySomethingElse(x: number, y: number, exceptKey: string): boolean {
  return otherFootprints(exceptKey).some((box) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
}

describe("Auto's Warehouse and Market anchors", () => {
  it("stands the Warehouse anchor on clear land beside the barn", () => {
    const stall = placementFor(HOME_WAREHOUSE_BUILDING_KEY);
    const barn = WORLD_OBJECT_DEFINITIONS.find((candidate) => candidate.id === stall.definitionId);
    expect(barn).toBeDefined();
    const barnBox = boundsFor(stall.tile.x, stall.tile.y, barn?.footprint.widthCells ?? 1);
    const anchor = HOME_WAREHOUSE_ANCHOR_TILE;

    // Outside the building's own footprint, on ground a character can walk, and clear of every other
    // starter object: a stand tile inside a barn or under a barrel is not a place anyone can be.
    const insideBuilding =
      anchor.x >= barnBox.minX && anchor.x <= barnBox.maxX && anchor.y >= barnBox.minY && anchor.y <= barnBox.maxY;
    expect(insideBuilding).toBe(false);
    expect(classifyTile(anchor).terrain).toBe("LAND");
    expect(occupiedBySomethingElse(anchor.x, anchor.y, HOME_WAREHOUSE_BUILDING_KEY)).toBe(false);
    // Next to it, not across the island: the walk is a doorstep, not a journey.
    expect(Math.hypot(anchor.x - stall.tile.x, anchor.y - stall.tile.y) * PITCH).toBeLessThan(8);
  });

  it("stands the Market anchor on clear land beside the stall", () => {
    const placement = placementFor(FARM_MARKET_BUILDING_KEY);
    const definition = WORLD_OBJECT_DEFINITIONS.find((candidate) => candidate.id === placement.definitionId);
    const box = boundsFor(placement.tile.x, placement.tile.y, definition?.footprint.widthCells ?? 1);
    const anchor = FARM_MARKET_ANCHOR_TILE;

    const insideBuilding = anchor.x >= box.minX && anchor.x <= box.maxX && anchor.y >= box.minY && anchor.y <= box.maxY;
    expect(insideBuilding).toBe(false);
    expect(classifyTile(anchor).terrain).toBe("LAND");
    expect(occupiedBySomethingElse(anchor.x, anchor.y, FARM_MARKET_BUILDING_KEY)).toBe(false);
    expect(Math.hypot(anchor.x - placement.tile.x, anchor.y - placement.tile.y) * PITCH).toBeLessThan(8);
  });

  it("keeps the server's pace and pitch identical to the client's own walk", () => {
    // The server computes travel time from these two numbers, and the client's character controller
    // walks at its own copy of the speed. If the two ever drift, an Auto walk would either arrive
    // early on screen or stand still waiting for a clock that has not caught up.
    expect(AUTO_WALK_SPEED_WORLD_PER_SECOND).toBe(2.6);
    expect(FARM_TILE_PITCH_WORLD).toBeCloseTo(1.08, 6);
  });
});
