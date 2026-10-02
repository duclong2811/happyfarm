import { describe, expect, it } from "vitest";
import {
  classifyTile,
  islandRadiusAt,
  STARTER_WORLD_PLACEMENTS,
  STARTER_WORLD_VERSION,
  tileToWorld,
  WORLD_OBJECT_DEFINITIONS,
  worldObjectDefinition
} from "@happy-farm/game-data";

/**
 * The shared world data, held to the promises seeding depends on.
 *
 * A starter placement that lands in the sea, on the volcano or on the village square would seed an
 * object the player could never have placed and - worse - could never move back. The layout is data,
 * so the checks that matter are data checks, and they run before a single row is written.
 */

describe("the starter arrangement", () => {
  it("is versioned, and every placement names a definition this build ships", () => {
    expect(STARTER_WORLD_VERSION).toBeGreaterThanOrEqual(1);
    expect(STARTER_WORLD_PLACEMENTS.length).toBeGreaterThan(20);
    for (const placement of STARTER_WORLD_PLACEMENTS) {
      expect(worldObjectDefinition(placement.definitionId), placement.key).not.toBeNull();
      expect(placement.rotation).toBeGreaterThanOrEqual(0);
      expect(placement.rotation).toBeLessThanOrEqual(3);
    }
  });

  it("gives every placement a stable key, and no two the same cell", () => {
    const keys = STARTER_WORLD_PLACEMENTS.map((placement) => placement.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(STARTER_WORLD_VERSION).toBe(2);
    // The *authored* arrangement is one object per cell, because those stand on open ground beside
    // each other. The version-2 scatter is the island as it already grows: a wood places its members
    // within a radius of a cluster centre, two of them can share a cell, and the migration has to
    // reproduce that rather than tidy it - see migration 0013, which lets two starter rows nest while
    // still refusing to let a *player* place, move or restore anything on top of them.
    const cells = STARTER_WORLD_PLACEMENTS.filter((placement) => placement.version === 1).map(
      (placement) => `${String(placement.tile.x)},${String(placement.tile.y)}`
    );
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("stands every placement on dry ground inside the island", () => {
    for (const placement of STARTER_WORLD_PLACEMENTS) {
      const classification = classifyTile(placement.tile);
      const world = tileToWorld(placement.tile);
      expect(classification.insideIsland, placement.key).toBe(true);
      expect(classification.terrain, placement.key).not.toBe("WATER");
      // Inside the shore rather than out on the water. A rock may stand on the shingle, so SHORE is
      // ground a placement may use; the *sea* is not. The volcano's own cover is scenery the island
      // grew - the mountain is geography, but the wood on its flank is an object like any other, and
      // a player who moves one of those trees off the slope is doing exactly what this pass allows.
      expect(islandRadiusAt(world.worldX, world.worldZ), placement.key).toBeLessThan(1);
    }
  });

  it("keeps the island's scatter off the beach and the shore out of the field", () => {
    // The two families are held to the rules the *island* was built with: the procedural vegetation
    // keeps a real margin from the waterline, and nothing stands in the cells the plot catalogue
    // sells. Authored buildings and set dressing are not scatter - they are placed, and their own
    // presets decide where.
    for (const placement of STARTER_WORLD_PLACEMENTS) {
      if (!placement.key.startsWith("starter.tree.") && !placement.key.startsWith("starter.pine.") &&
          !placement.key.startsWith("starter.bush.") && !placement.key.startsWith("starter.rock.")) {
        continue;
      }
      const world = tileToWorld(placement.tile);
      expect(islandRadiusAt(world.worldX, world.worldZ), placement.key).toBeLessThan(0.98);
    }
  });

  it("keeps the mill on the upland the island has always put it on, and off the sold land", () => {
    const mill = STARTER_WORLD_PLACEMENTS.find((placement) => placement.definitionId === "world.windmill");
    expect(mill).toBeDefined();
    expect(mill?.tile).toEqual({ x: -16, y: -13 });
    // No starter object stands inside the 36x36 square the plot catalogue sells: those cells are land
    // the player may buy later, and an object in the middle of an unsold plot is an obstacle to the
    // purchase rather than a thing to play with.
    for (const placement of STARTER_WORLD_PLACEMENTS) {
      const insideReservation =
        placement.tile.x >= 0 && placement.tile.x <= 35 && placement.tile.y >= 0 && placement.tile.y <= 35;
      expect(insideReservation, placement.key).toBe(false);
    }
  });
});

describe("the object definitions", () => {
  it("hands every ordinary object the same generous edit policy, whatever its source", () => {
    for (const definition of WORLD_OBJECT_DEFINITIONS) {
      expect(definition.id.startsWith("world."), definition.id).toBe(true);
      // Source does not decide editability: every definition in this set is a player's to change.
      expect(definition.system, definition.id).toBe(false);
      expect(definition.movable, definition.id).toBe(true);
      expect(definition.rotatable, definition.id).toBe(true);
      expect(definition.storable, definition.id).toBe(true);
      expect(definition.removable, definition.id).toBe(true);
      expect(definition.allowedTerrain.length).toBeGreaterThan(0);
      // A refund rate is a share, never a multiplier: the money is `floor(paid x rate)`.
      expect(definition.removalRefundRate).toBeGreaterThanOrEqual(0);
      expect(definition.removalRefundRate).toBeLessThanOrEqual(1);
    }
  });

  it("resolves by id, and answers nothing for an id this build does not ship", () => {
    expect(worldObjectDefinition("world.tree_broad")?.presentation).toEqual({
      form: "MODEL",
      modelId: "tree_broad_2",
      sizeWorld: 3.4
    });
    expect(worldObjectDefinition("world.does_not_exist")).toBeNull();
  });
});
