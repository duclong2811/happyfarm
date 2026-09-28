import { describe, expect, it } from "vitest";
import {
  applyTileMutation,
  assertOwnershipInvariant,
  assertValidCoordinate,
  createFarmTile,
  createInitialFarmTiles,
  createOwnedFarm,
  INITIAL_LAND_SIZE,
  MAX_TILE_X,
  parseFarmRole,
  parseTerrainType
} from "@happy-farm/domain";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

describe("Phase 1 domain invariants", () => {
  it("accepts only stable farm roles", () => {
    expect(parseFarmRole("OWNER")).toBe("OWNER");
    expect(() => parseFarmRole("ADMIN")).toThrow("Invalid farm role");
  });

  it("rejects non-integer and out-of-range tile coordinates", () => {
    expect(() => {
      assertValidCoordinate({ x: 0.5, y: 0 });
    }).toThrow();
    expect(() => {
      assertValidCoordinate({ x: MAX_TILE_X + 1, y: 0 });
    }).toThrow();
  });

  it("keeps terrain values constrained", () => {
    expect(parseTerrainType("GRASS")).toBe("GRASS");
    expect(() => parseTerrainType("LAVA")).toThrow("Invalid terrain type");
  });

  it("creates a matching owner membership", () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    expect(() => {
      assertOwnershipInvariant(aggregate.farm, aggregate.ownerMembership);
    }).not.toThrow();
    expect(() => {
      assertOwnershipInvariant(aggregate.farm, { ...aggregate.ownerMembership, playerId: PLAYER_TWO_ID });
    }).toThrow("Farm owner membership is inconsistent");
  });

  it("starts tile versions at one and detects stale mutations", () => {
    const tile = createFarmTile(FARM_ONE_ID, { x: 0, y: 0 }, "GRASS", NOW);
    expect(tile.version).toBe(1);
    expect(applyTileMutation(tile, 1, NOW).version).toBe(2);
    expect(() => applyTileMutation(tile, 2, NOW)).toThrow("Tile version does not match");
  });

  it("creates starter land as SOIL tiles at version one", () => {
    const tiles = createInitialFarmTiles(FARM_ONE_ID, NOW);
    expect(tiles).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(tiles[0]).toMatchObject({
      terrainType: "SOIL",
      state: "IDLE",
      version: 1,
      updatedAt: NOW
    });
    expect(tiles.some((tile) => tile.x === INITIAL_LAND_SIZE - 1 && tile.y === INITIAL_LAND_SIZE - 1)).toBe(true);
    expect(new Set(tiles.map((tile) => `${String(tile.x)}:${String(tile.y)}`)).size).toBe(tiles.length);
    expect(() => createInitialFarmTiles(FARM_ONE_ID, NOW, 0)).toThrow("Initial land size is invalid");
  });
});
