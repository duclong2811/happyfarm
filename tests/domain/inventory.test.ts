import { describe, expect, it } from "vitest";
import {
  createInventoryAddition,
  MAX_INVENTORY_QUANTITY,
  parseItemDefinitionId
} from "@happy-farm/domain";
import { PLAYER_ONE_ID } from "../support/fixtures";

const definition = {
  id: parseItemDefinitionId("item_carrot"),
  displayNameKey: "item.carrot.name",
  category: "CROP" as const,
  stackable: true as const,
  maxStack: MAX_INVENTORY_QUANTITY
};

describe("inventory mutation rules", () => {
  it("creates a bounded positive addition", () => {
    expect(createInventoryAddition(PLAYER_ONE_ID, definition, 2, "2026-01-01T00:00:00.000Z")).toMatchObject({
      itemDefinitionId: definition.id,
      quantity: 2
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(() => createInventoryAddition(PLAYER_ONE_ID, definition, quantity, "2026-01-01T00:00:00.000Z")).toThrow();
    }
  );

  it("rejects additions beyond the item maximum", () => {
    expect(() =>
      createInventoryAddition(PLAYER_ONE_ID, { ...definition, maxStack: 1 }, 2, "2026-01-01T00:00:00.000Z")
    ).toThrow();
  });
});
