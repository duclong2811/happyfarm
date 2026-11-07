import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX_HTML = readFileSync(`${ROOT}/apps/web/index.html`, "utf8");
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");

describe("shared premium game UI presentation", () => {
  it("skins the existing return summary without changing its owned DOM path", () => {
    expect(INDEX_HTML).toContain('id="return-popup"');
    expect(INDEX_HTML).toContain('id="return-popup-items"');
    expect(INDEX_HTML).toContain('id="return-popup-close"');
    expect(MAIN).toContain("showReturnPopupOnce");
    expect(MAIN).toContain('element<HTMLButtonElement>("return-popup-close")');
    expect(STYLES).toContain(".return-popup");
    expect(STYLES).toContain("var(--ui-art-panel-frame)");
    expect(STYLES).toContain("var(--ui-art-title-bar)");
    expect(STYLES).toContain(".return-popup button.primary");
  });

  it("keeps planting controls as the existing scrollable picker with shared states", () => {
    expect(INDEX_HTML).toContain('id="plant-controls"');
    expect(INDEX_HTML).toContain('id="plant-picker"');
    expect(STYLES).toContain(".action-dock .item-picker");
    expect(STYLES).toContain(".action-dock .item-picker .item-card.is-selected");
    expect(STYLES).toContain(".action-dock .item-picker .item-card:disabled");
    expect(STYLES).toContain("var(--ui-art-slot-hover)");
    expect(STYLES).toContain("var(--ui-art-slot-disabled)");
    expect(STYLES).toContain("overflow-x: auto");
  });

  it("keeps HUD and navigation on the existing action and data nodes", () => {
    expect(INDEX_HTML).toContain('id="wallet"');
    expect(INDEX_HTML).toContain('id="progression"');
    expect(INDEX_HTML).toContain('id="module-rail"');
    expect(STYLES).toContain(".ui-top-hud-bar .hud-stat");
    expect(STYLES).toContain(".module-rail .module-launcher.is-active");
    expect(STYLES).toContain("var(--ui-art-hud-resource)");
    expect(STYLES).toContain("var(--ui-art-nav-active)");
  });
});
