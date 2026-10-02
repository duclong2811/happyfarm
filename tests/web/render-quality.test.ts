import { describe, expect, it } from "vitest";
import {
  RENDER_QUALITY_PRESETS,
  deviceQualityProfile,
  detailSceneryScale,
  renderQualityPreset,
  resolveRenderQuality
} from "../../apps/web/src/render/render-quality";

/**
 * The development quality switch, held to the two promises that make it safe to have.
 *
 * It must never be entered by accident - an ordinary session, a typo, and a missing parameter all
 * mean NORMAL - and it must only ever change presentation, which is what the preset shape asserts:
 * there is no field here a game rule could read.
 */

describe("render quality", () => {
  it("is normal unless low quality was asked for by name", () => {
    expect(resolveRenderQuality("low")).toBe("LOW");
    expect(resolveRenderQuality("LOW")).toBe("LOW");
    expect(resolveRenderQuality(" low ")).toBe("LOW");
    expect(resolveRenderQuality("normal")).toBe("NORMAL");
    expect(resolveRenderQuality("high")).toBe("NORMAL");
    expect(resolveRenderQuality("")).toBe("NORMAL");
    expect(resolveRenderQuality(null)).toBe("NORMAL");
    expect(resolveRenderQuality(undefined)).toBe("NORMAL");
  });

  it("caps the pixel ratio below what a high-DPI display would ask for", () => {
    for (const preset of Object.values(RENDER_QUALITY_PRESETS)) {
      expect(preset.pixelRatioCap).toBeGreaterThanOrEqual(1);
      expect(preset.pixelRatioCap).toBeLessThanOrEqual(2);
    }
    expect(RENDER_QUALITY_PRESETS.LOW.pixelRatioCap).toBeLessThan(
      RENDER_QUALITY_PRESETS.NORMAL.pixelRatioCap
    );
  });

  it("makes the low level cheaper on every axis it can, and never more expensive", () => {
    const low = RENDER_QUALITY_PRESETS.LOW;
    const normal = RENDER_QUALITY_PRESETS.NORMAL;
    expect(low.shadows).toBe(false);
    expect(normal.shadows).toBe(true);
    expect(low.shadowMapSize).toBeLessThan(normal.shadowMapSize);
    expect(low.detailScenery).toBe(false);
    expect(normal.detailScenery).toBe(true);
    expect(detailSceneryScale("LOW")).toBe(0);
    expect(detailSceneryScale("NORMAL")).toBe(1);
  });

  it("describes presentation only: no preset names a gameplay quantity", () => {
    // A guard against the switch growing a field a rule could read. Field names are the contract.
    expect(Object.keys(RENDER_QUALITY_PRESETS.NORMAL).sort()).toEqual([
      "antialias",
      "detailScenery",
      "name",
      "pixelRatioCap",
      "shadowMapSize",
      "shadows"
    ]);
    expect(renderQualityPreset("LOW").name).toBe("LOW");
  });

  it("gives a coarse-pointer touch device the conservative mobile profile", () => {
    // V13.5: the profile is chosen by *capability*, and it is still only presentation - the same
    // fields, the same meaning, a cheaper frame.
    expect(deviceQualityProfile("NORMAL", { coarse: true, touch: true })).toBe("MOBILE");
    expect(deviceQualityProfile("NORMAL", { coarse: false, touch: true })).toBe("NORMAL");
    expect(deviceQualityProfile("NORMAL", { coarse: true, touch: false })).toBe("NORMAL");
    expect(deviceQualityProfile("NORMAL", { coarse: false, touch: false })).toBe("NORMAL");
    // A developer who asked for LOW by name still gets LOW, on any device.
    expect(deviceQualityProfile("LOW", { coarse: true, touch: true })).toBe("LOW");
  });

  it("makes the mobile profile cheaper than normal on every axis, and never more expensive", () => {
    const mobile = RENDER_QUALITY_PRESETS.MOBILE;
    const normal = RENDER_QUALITY_PRESETS.NORMAL;
    // A 3x phone display must not be drawn at 3x: the cap is the single largest saving.
    expect(mobile.pixelRatioCap).toBeLessThan(normal.pixelRatioCap);
    expect(mobile.pixelRatioCap).toBeGreaterThanOrEqual(1.25);
    expect(mobile.pixelRatioCap).toBeLessThanOrEqual(1.5);
    // Shadows stay (the character and the buildings read better with them) but smaller.
    expect(mobile.shadows).toBe(true);
    expect(mobile.shadowMapSize).toBeLessThan(normal.shadowMapSize);
    // The micro-scenery - the highest draw-call count for the least information - goes.
    expect(mobile.detailScenery).toBe(false);
    expect(detailSceneryScale("MOBILE")).toBe(0);
    // And the low level is still the cheapest of all three.
    expect(RENDER_QUALITY_PRESETS.LOW.pixelRatioCap).toBeLessThanOrEqual(mobile.pixelRatioCap);
  });
});
