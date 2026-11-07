import { describe, expect, it } from "vitest";
import {
  NO_UI_V2_ART,
  bundledUiV2AssetUrl,
  uiV2RequiredAssets,
  uiV2ThemeActivationFor,
  type UiV2ArtAssetId,
  type UiV2ArtPackage,
  type UiV2Artwork
} from "../../apps/web/src/ui/art-v2";

function artwork(id: UiV2ArtAssetId): UiV2Artwork {
  return {
    id,
    kind: "nine-slice",
    src: bundledUiV2AssetUrl(`/assets/${id}.png`),
    density: 2,
    capInsets: { top: 12, right: 12, bottom: 12, left: 12 },
    provenance: { sourceFile: `source/${id}.blend`, license: "project-owned" }
  };
}

function approvedPackageFor(scope: "construction" | "market" | "inventory" | "hud"): UiV2ArtPackage {
  const assets: Partial<Record<UiV2ArtAssetId, UiV2Artwork>> = {};
  for (const id of uiV2RequiredAssets(scope)) assets[id] = artwork(id);
  return { id: `approved-${scope}`, approval: "approved", assets };
}

describe("V2 art-to-UI integration gate", () => {
  it("does not mistake the no-art registry for a production V2 skin", () => {
    const activation = uiV2ThemeActivationFor("construction", NO_UI_V2_ART);

    expect(activation.readiness.ready).toBe(false);
    expect(activation.classNames).toEqual([]);
    expect(activation.readiness.missing).toEqual(uiV2RequiredAssets("construction"));
  });

  it("keeps candidate artwork on the current skin even when every required asset is present", () => {
    const candidate = { ...approvedPackageFor("construction"), approval: "candidate" as const };

    expect(uiV2ThemeActivationFor("construction", candidate).classNames).toEqual([]);
  });

  it("requires all approved assets before a screen receives its own V2 namespace", () => {
    const approved = approvedPackageFor("construction");
    const activation = uiV2ThemeActivationFor("construction", approved);

    expect(activation.readiness).toMatchObject({ ready: true, missing: [], invalid: [] });
    expect(activation.classNames).toEqual(["ui-v2", "ui-v2--construction"]);
  });

  it("rejects incomplete provenance and never falls back to an arbitrary asset path", () => {
    const approved = approvedPackageFor("construction");
    const primary = approved.assets["button.primary.normal"];
    if (primary === undefined || primary.kind !== "nine-slice") throw new Error("test fixture is incomplete");
    const invalid: UiV2ArtPackage = {
      ...approved,
      assets: {
        ...approved.assets,
        "button.primary.normal": { ...primary, provenance: { sourceFile: "", license: "project-owned" } }
      }
    };

    const activation = uiV2ThemeActivationFor("construction", invalid);
    expect(activation.readiness.ready).toBe(false);
    expect(activation.readiness.invalid).toContain("button.primary.normal");
    expect(activation.classNames).toEqual([]);
  });
});
