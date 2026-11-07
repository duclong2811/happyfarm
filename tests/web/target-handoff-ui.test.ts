import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX_HTML = readFileSync(`${ROOT}/apps/web/index.html`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");
const TARGET_DIR = `${ROOT}/apps/web/src/assets/ui/target-handoff`;
const PRODUCTION_DIR = `${ROOT}/apps/web/src/assets/ui/premium-2_5d`;
const PIPELINE = readFileSync(`${ROOT}/tools/ui-art/generate_premium_ui.py`, "utf8");

describe("planting HUD target handoff presentation", () => {
  it("ships independent dimensional action artwork for the existing modules", () => {
    const files = [
      "nav-inventory-bag.png",
      "nav-market-map.png",
      "nav-build-hammer.png",
      "nav-work-area.png",
      "nav-workers.png",
      "hud-gold-coin.png",
      "hud-level-star.png"
    ];
    const shipped = readdirSync(TARGET_DIR);
    for (const file of files) {
      expect(shipped, file).toContain(file);
      expect(readFileSync(`${TARGET_DIR}/${file}`).length, file).toBeGreaterThan(0);
      expect(STYLES, file).toContain(file);
    }
  });

  it("keeps the real planting picker and module controls as the owners of behavior", () => {
    expect(INDEX_HTML).toContain('id="plant-picker"');
    expect(INDEX_HTML).toContain('id="plant"');
    expect(INDEX_HTML).toContain('id="module-rail"');
    expect(INDEX_HTML).toContain('id="wallet"');
    expect(INDEX_HTML).toContain('id="progression"');
    expect(STYLES).toContain(".action-dock .item-picker");
    expect(STYLES).toContain("overflow-x: auto");
    expect(STYLES).toContain(".module-rail .module-launcher.is-active");
  });

  it("provides responsive target sizing without turning the reference into an overlay", () => {
    expect(STYLES).toContain("width: min(54rem, calc(100% - 2.5rem))");
    expect(STYLES).toContain("@media (max-width: 600px)");
    expect(STYLES).toContain("min-height: var(--touch-target)");
    expect(STYLES).not.toContain("HAPPYFARM_PLANTING_HUD_TARGET.png");
  });

  it("keeps the production material family reproducible and independent from the references", () => {
    for (const file of [
      "button-primary.png",
      "button-secondary.png",
      "button-selected.png",
      "button-disabled.png",
      "nav-button-normal.png",
      "nav-button-active.png",
      "item-slot.png"
    ]) {
      expect(readFileSync(`${PRODUCTION_DIR}/${file}`).length, file).toBeGreaterThan(0);
      expect(STYLES, file).toContain(`premium-2_5d/${file}`);
    }
    expect(PIPELINE).toContain("ImageFilter.GaussianBlur");
    expect(PIPELINE).toContain("Image.Resampling.BICUBIC");
    expect(PIPELINE).not.toContain("HAPPYFARM_FINAL_STYLE.png");
    expect(PIPELINE).not.toContain("HAPPYFARM_PLANTING_HUD_TARGET.png");
  });
});
