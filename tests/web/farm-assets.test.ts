import { describe, expect, it } from "vitest";
import { PLANTABLE_CROPS } from "../../apps/web/src/labels";
import { CROP_MODEL_IDS, cropModelId } from "../../apps/web/src/render/assets";

describe("crop model manifest", () => {
  it("has a model for every crop the client can plant", () => {
    for (const definitionId of PLANTABLE_CROPS) {
      expect(cropModelId(definitionId), definitionId).toBe(definitionId);
    }
  });

  it("declares ids that satisfy the contract's crop definition pattern", () => {
    for (const id of CROP_MODEL_IDS) {
      expect(id).toMatch(/^crop_[a-z0-9]+(?:_[a-z0-9]+)*$/);
    }
  });

  it("declares no duplicates", () => {
    expect(new Set(CROP_MODEL_IDS).size).toBe(CROP_MODEL_IDS.length);
  });

  it("resolves an unknown crop to no model instead of a guess", () => {
    expect(cropModelId("crop_pumpkin")).toBeNull();
    expect(cropModelId("item_carrot")).toBeNull();
    expect(cropModelId("")).toBeNull();
  });

  it("resolves a known crop to its own id, so a file name cannot drift from a definition id", () => {
    expect(CROP_MODEL_IDS.map((id) => cropModelId(id))).toEqual([...CROP_MODEL_IDS]);
  });
});