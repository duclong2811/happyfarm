import { describe, expect, it } from "vitest";
import { GetInventory, InventoryService, type Clock, type InventoryRepository } from "@happy-farm/application";
import { parseItemDefinitionId } from "@happy-farm/domain";
import { GameDataItemDefinitions } from "../../workers/api/src/runtime";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

const clock: Clock = { now: () => NOW };

describe("InventoryService", () => {
  it("rejects unknown definitions and zero or negative additions", () => {
    const service = new InventoryService(new GameDataItemDefinitions(), clock);
    expect(() => service.prepareAddition(PLAYER_ONE_ID, "item_unknown", 1)).toThrow();
    expect(() => service.prepareAddition(PLAYER_ONE_ID, "item_carrot", 0)).toThrow();
    expect(() => service.prepareAddition(PLAYER_ONE_ID, "item_carrot", -1)).toThrow();
    expect(service.prepareRemoval(PLAYER_ONE_ID, "item_carrot", 2)).toMatchObject({ kind: "REMOVE", quantity: 2 });
    expect(() => service.prepareRemoval(PLAYER_ONE_ID, "item_carrot", 0)).toThrow();
  });

  it("requires authentication for inventory reads", async () => {
    const repository: InventoryRepository = {
      find: () => Promise.resolve(null),
      listByPlayer: () => Promise.resolve([
        {
          playerId: PLAYER_ONE_ID,
          itemDefinitionId: parseItemDefinitionId("item_carrot"),
          quantity: 2,
          version: 1,
          updatedAt: NOW
        }
      ])
    };
    const query = new GetInventory(repository, new GameDataItemDefinitions());
    await expect(query.execute(null)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(query.execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual([
      {
        itemDefinitionId: "item_carrot",
        displayNameKey: "item.carrot.name",
        category: "CROP",
        quantity: 2
      }
    ]);
  });
});
