import { describe, expect, it } from "vitest";
import {
  CreateFarmRequestSchema,
  BuyItemRequestSchema,
  CropDefinitionDTOSchema,
  FarmRoleSchema,
  GetCropDefinitionsResponseSchema,
  GetShopResponseSchema,
  GetWalletResponseSchema,
  HarvestCropRequestSchema,
  MAX_TILE_X,
  PlantCropRequestSchema,
  ShopEntryDTOSchema,
  SellItemRequestSchema,
  TileCoordinateSchema,
  WalletDTOSchema
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

  it.each([BuyItemRequestSchema, SellItemRequestSchema])(
    "validates shop intent without accepting an authoritative price",
    (schema) => {
      const valid = { requestId: "economy_123", shopEntryId: "shop_carrot", quantity: 2 };
      expect(schema.safeParse(valid).success).toBe(true);
      for (const injected of ["price", "unitPrice", "total", "currencyId", "currencyDelta", "reward", "balance", "playerId"]) {
        expect(schema.safeParse({ ...valid, [injected]: 1 }).success).toBe(false);
      }
      expect(schema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
      expect(schema.safeParse({ ...valid, quantity: -1 }).success).toBe(false);
      expect(schema.safeParse({ ...valid, quantity: 1.5 }).success).toBe(false);
      expect(schema.safeParse({ ...valid, quantity: Number.MAX_SAFE_INTEGER }).success).toBe(false);
      expect(schema.safeParse({ ...valid, quantity: 1_000_000 }).success).toBe(true);
    }
  );

  it("validates presentation-safe shop and wallet read DTOs", () => {
    const entry = {
      shopEntryId: "shop_carrot",
      itemDefinitionId: "item_carrot",
      currencyId: "currency_gold",
      buyPrice: 4,
      sellPrice: 2,
      maxQuantityPerRequest: 1_000
    };
    expect(ShopEntryDTOSchema.safeParse(entry).success).toBe(true);
    expect(GetShopResponseSchema.safeParse({ entries: [entry] }).success).toBe(true);
    expect(GetShopResponseSchema.safeParse({ entries: [] }).success).toBe(true);
    for (const injected of [
      { id: "shop_carrot" }, { version: 1 }, { registry: {} }, { itemRegistry: "item_carrot" },
      { shopEntryId: "carrot" }, { buyPrice: 0 }, { buyPrice: 1.5 },
      { sellPrice: -1 }, { maxQuantityPerRequest: 0 }, { maxQuantityPerRequest: 1_000_001 }
    ]) {
      expect(ShopEntryDTOSchema.safeParse({ ...entry, ...injected }).success, JSON.stringify(injected)).toBe(false);
    }
    expect(GetShopResponseSchema.safeParse({ entries: [entry], wallet: [] }).success).toBe(false);

    expect(WalletDTOSchema.safeParse({ currencyId: "currency_gold", balance: 0 }).success).toBe(true);
    expect(GetWalletResponseSchema.safeParse({ wallets: [] }).success).toBe(true);
    expect(GetWalletResponseSchema.safeParse({ wallets: [{ currencyId: "currency_gold", balance: 92 }] }).success).toBe(true);
    for (const injected of [
      { balance: -1 }, { balance: 1.5 }, { currencyId: "gold" },
      { playerId: "player_11111111-1111-4111-8111-111111111111" },
      { version: 1 }, { updatedAt: "2026-09-27T00:00:00.000Z" }
    ]) {
      expect(WalletDTOSchema.safeParse({ currencyId: "currency_gold", balance: 1, ...injected }).success, JSON.stringify(injected)).toBe(false);
    }
    expect(GetWalletResponseSchema.safeParse({ wallets: [{ balance: 1 }] }).success).toBe(false);
    expect(GetWalletResponseSchema.safeParse({ wallets: [{ currencyId: "currency_gold", balance: 1 }], items: [] }).success).toBe(false);
  });

  it("validates the crop catalogue and rejects any field the server does not own", () => {
    const definition = {
      cropDefinitionId: "crop_wheat",
      growthDurationSeconds: 900,
      harvestItemDefinitionId: "item_wheat",
      baseQuantity: 3,
      harvestXp: 12,
      requiredLevel: 2
    };
    expect(CropDefinitionDTOSchema.safeParse(definition).success).toBe(true);
    expect(GetCropDefinitionsResponseSchema.safeParse({ definitions: [definition] }).success).toBe(true);
    expect(GetCropDefinitionsResponseSchema.safeParse({ definitions: [] }).success).toBe(true);
    for (const injected of [
      { requiredLevel: 0 },
      { requiredLevel: 1.5 },
      { cropDefinitionId: "wheat" },
      { growthDurationSeconds: 0 },
      { baseQuantity: 0 },
      { harvestXp: 0 },
      { harvestItemDefinitionId: "wheat" },
      { displayNameKey: "crop.wheat.name" },
      { growthStages: 5 },
      { harvest: { baseQuantity: 3 } },
      { playerId: "player_11111111-1111-4111-8111-111111111111" },
      { level: 1 }
    ]) {
      expect(CropDefinitionDTOSchema.safeParse({ ...definition, ...injected }).success, JSON.stringify(injected)).toBe(false);
    }
    expect(GetCropDefinitionsResponseSchema.safeParse({ definitions: [definition], level: 2 }).success).toBe(false);
  });
});
