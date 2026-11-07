import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");
const PIPELINE = readFileSync(`${ROOT}/tools/ui-art/generate_premium_ui.py`, "utf8");
const ART_DIR = `${ROOT}/apps/web/src/assets/ui/premium-2_5d`;

describe("shared premium material refinement", () => {
  it("ships the saturated, reproducible 2.5D material family", () => {
    for (const file of [
      "button-primary.png",
      "button-secondary.png",
      "button-selected.png",
      "button-disabled.png",
      "nav-button-normal.png",
      "nav-button-active.png",
      "item-slot.png"
    ]) {
      expect(readdirSync(ART_DIR), file).toContain(file);
      expect(readFileSync(`${ART_DIR}/${file}`).length, file).toBeGreaterThan(0);
    }
    expect(PIPELINE).toContain("(255, 214, 58, 255)");
    expect(PIPELINE).toContain("(198, 76, 7, 255)");
    expect(PIPELINE).toContain("ImageFilter.GaussianBlur");
    expect(PIPELINE).toContain("Image.Resampling.BICUBIC");
  });

  it("applies one material hierarchy across the requested premium surfaces", () => {
    for (const selector of [
      "#build-panel",
      "#market-panel.ui-market-shell",
      "#work-areas-panel",
      "#workers-panel",
      "#return-popup",
      ".ui-top-hud-bar .hud-stat",
      ".module-rail .module-launcher"
    ]) {
      expect(STYLES, selector).toContain(selector);
    }
    for (const token of [
      "--premium-contact-shadow",
      "--premium-panel-shadow",
      "--premium-card-shadow",
      "--premium-inner-highlight"
    ]) {
      expect(STYLES, token).toContain(token);
    }
  });

  it("keeps honey-gold for primary actions and leaf green for selected states", () => {
    expect(STYLES).toContain("All primary actions use the rendered honey-gold material");
    expect(STYLES).toContain("border-image-source: var(--ui-art-button-primary)");
    expect(STYLES).toContain("border-image-source: var(--ui-art-button-selected)");
    expect(STYLES).toContain(".object-action.is-danger");
    expect(STYLES).not.toContain("HAPPYFARM_FINAL_STYLE.png");
  });
});
