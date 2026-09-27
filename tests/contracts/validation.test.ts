import { describe, expect, it } from "vitest";
import {
  CreateFarmRequestSchema,
  FarmRoleSchema,
  HarvestCropRequestSchema,
  MAX_TILE_X,
  PlantCropRequestSchema,
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

  it("validates bounded planting request IDs and authoritative fields", () => {
    const valid = {
      requestId: "request_123",
      cropDefinitionId: "crop_carrot",
      x: 0,
      y: 0,
      expectedTileVersion: 1
    };
    expect(PlantCropRequestSchema.safeParse(valid).success).toBe(true);
    expect(PlantCropRequestSchema.safeParse({ ...valid, requestId: "short" }).success).toBe(false);
    expect(PlantCropRequestSchema.safeParse({ ...valid, plantedAt: "2000-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(PlantCropRequestSchema.safeParse({ ...valid, expectedTileVersion: 0 }).success).toBe(false);
  });

  it("rejects client-authored harvest rewards and invalid versions", () => {
    const valid = { requestId: "harvest_123", expectedCropVersion: 1 };
    expect(HarvestCropRequestSchema.safeParse(valid).success).toBe(true);
    expect(HarvestCropRequestSchema.safeParse({ ...valid, expectedCropVersion: 0 }).success).toBe(false);
    expect(HarvestCropRequestSchema.safeParse({ ...valid, quantityAdded: 999 }).success).toBe(false);
    expect(HarvestCropRequestSchema.safeParse({ ...valid, itemDefinitionId: "item_gold" }).success).toBe(false);
  });
});
