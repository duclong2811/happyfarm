import { describe, expect, it } from "vitest";
import type { ConstructionDTO } from "@happy-farm/contracts";
import { createPlayerCollisionWorld } from "../../apps/web/src/player/collision";
import { PLAYER_RADIUS } from "../../apps/web/src/player/controller";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { objectObstacles } from "../../apps/web/src/world-objects";

/**
 * Collision follows the object, not a compiled-in list.
 *
 * V13.3 makes the windmill and the barn movable, storable and removable, which means their collision
 * circle cannot be part of the static world config any more: a circle that stayed put while the barn
 * walked away would block empty grass and let a walker through the barn. These tests pin the two
 * halves of that - the circle is built from the row, and it disappears with it.
 */

const frame = worldFrame();
const PITCH = frame.pitch;

function worldAt(x: number, y: number): { readonly worldX: number; readonly worldZ: number } {
  return tileToWorld({ x, y }, frame);
}

function construction(overrides: Partial<ConstructionDTO> = {}): ConstructionDTO {
  return {
    constructionId: "construct_11111111-1111-4111-8111-111111111111",
    farmId: "farm_11111111-1111-4111-8111-111111111111",
    entryId: "world.windmill",
    category: "WORLD_OBJECT",
    anchorX: -16,
    anchorY: -13,
    rotation: 0,
    footprint: { widthCells: 3, depthCells: 3 },
    state: "ACTIVE",
    source: "STARTER",
    placementKey: "starter.windmill.01",
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: "currency_gold",
    createdAt: "2026-10-01T00:00:00.000Z",
    storedAt: null,
    version: 1,
    ...overrides
  };
}

/**
 * The walker's signed depth at a point once the farm's own objects are in the world.
 *
 * `depth` is a max over every source, not a sum, so "is this solid?" is the sign of the value: a
 * point is walkable when it is zero or colder, and blocked when it is warm. The island's own shore
 * is in here too, which is why the assertions below pick points well inland.
 */
function depth(rows: readonly ConstructionDTO[], point: { readonly worldX: number; readonly worldZ: number }): number {
  return createPlayerCollisionWorld([], objectObstacles(rows, frame)).depth(point.worldX, point.worldZ);
}

describe("collision follows the objects that make it", () => {
  it("blocks the cell an active building stands on", () => {
    expect(depth([construction()], worldAt(-16, -13))).toBeGreaterThan(0);
  });

  it("carries the circle to the new anchor after a move and clears the old one", () => {
    const before = worldAt(-16, -13);
    const after = worldAt(-10, -8);
    const moved = [construction({ anchorX: -10, anchorY: -8 })];
    // The same object at a new anchor: solid where it now stands, open ground where it used to be.
    expect(depth(moved, after)).toBeGreaterThan(0);
    expect(depth(moved, before)).toBeLessThanOrEqual(0);
    // And the other way round for the row before the move - the circle is the row's, not the world's.
    expect(depth([construction()], before)).toBeGreaterThan(0);
    expect(depth([construction()], after)).toBeLessThanOrEqual(0);
  });

  it("releases the ground when an object is stored", () => {
    const stored = construction({ state: "STORED", storedAt: "2026-10-02T00:00:00.000Z" });
    expect(objectObstacles([stored], frame)).toHaveLength(0);
    expect(depth([stored], worldAt(-16, -13))).toBeLessThanOrEqual(0);
  });

  it("leaves nothing behind when an object is removed", () => {
    // Removal deletes the row, so an island with no row has no circle - there is no second list that
    // could keep blocking the ground the object stood on.
    expect(objectObstacles([], frame)).toHaveLength(0);
    expect(depth([], worldAt(-16, -13))).toBeLessThanOrEqual(0);
  });

  it("sizes the circle from the footprint, so a big object is solid without being a wall", () => {
    const point = worldAt(-16, -13);
    const small = construction({ footprint: { widthCells: 1, depthCells: 1 } });
    const large = construction({ footprint: { widthCells: 3, depthCells: 3 } });
    expect(depth([large], point)).toBeGreaterThan(depth([small], point));
    // One tile blocks its own tile plus a small margin; a step beyond the circle is open ground again.
    const radius = 0.5 * PITCH + 0.18;
    expect(depth([small], { worldX: point.worldX + radius, worldZ: point.worldZ })).toBeGreaterThan(0);
    expect(
      depth([small], { worldX: point.worldX + radius + PLAYER_RADIUS + 0.01, worldZ: point.worldZ })
    ).toBeLessThanOrEqual(0);
  });

  it("names each circle after its row, so a lookup can follow the object", () => {
    const circle = objectObstacles([construction({ constructionId: "construct_abcd" })], frame)[0];
    expect(circle?.id).toBe("construct_abcd");
  });
});
