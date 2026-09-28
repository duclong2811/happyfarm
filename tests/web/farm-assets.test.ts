import { describe, expect, it } from "vitest";
import { crops } from "@happy-farm/game-data";
import { CROP_MODEL_IDS, cropModelId } from "../../apps/web/src/render/assets";

describe("crop model manifest", () => {
  it("has a model for every crop the server can be asked to plant", () => {
    // The client no longer holds a plantable-crop list of its own: the server's crop catalogue is the
    // source, so the model manifest has to cover exactly that catalogue.
    for (const crop of crops) {
      expect(cropModelId(crop.id), crop.id).toBe(crop.id);
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
