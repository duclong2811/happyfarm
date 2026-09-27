import { describe, expect, it } from "vitest";
import {
  CreateFarmRequestSchema,
  FarmRoleSchema,
  MAX_TILE_X,
  TileCoordinateSchema
} from "@happy-farm/contracts";

describe("Phase 1 runtime validation", () => {
  it("rejects client-selected ownership fields", () => {
    expect(CreateFarmRequestSchema.safeParse({ name: "Farm", playerId: "player-controlled" }).success).toBe(false);
  });

  it("rejects arbitrary role values", () => {
    expect(FarmRoleSchema.safeParse("ADMIN").success).toBe(false);
  });

  it("rejects non-integer and extreme tile coordinates", () => {
    expect(TileCoordinateSchema.safeParse({ x: 1.5, y: 0 }).success).toBe(false);
    expect(TileCoordinateSchema.safeParse({ x: MAX_TILE_X + 1, y: 0 }).success).toBe(false);
  });
});
