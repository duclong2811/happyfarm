import { describe, expect, it } from "vitest";
import { validateDefinitions } from "@happy-farm/game-data";

describe("game-data validation", () => {
  it("accepts stable semantic IDs and rejects malformed definitions", () => {
    expect(validateDefinitions([{ id: "crop_carrot", displayName: "Carrot" }])).toHaveLength(1);
    expect(() => validateDefinitions([{ id: "Carrot", displayName: "Carrot" }])).toThrow();
  });
});
