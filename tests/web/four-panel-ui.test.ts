import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX_HTML = readFileSync(`${ROOT}/apps/web/index.html`, "utf8");
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");
const SHOP_STYLES = readFileSync(`${ROOT}/apps/web/src/build-shop/shop.css`, "utf8");

describe("remaining panel premium presentation", () => {
  it("keeps all four real panel roots and their existing render paths", () => {
    for (const id of ["return-popup", "build-panel", "work-areas-panel", "workers-panel"]) {
      expect(INDEX_HTML, id).toContain(`id="${id}"`);
    }
    expect(MAIN).toContain("showReturnPopupOnce");
    expect(MAIN).toContain("renderBuildPanel");
    expect(MAIN).toContain("renderWorkAreas");
    expect(MAIN).toContain("renderWorkers");
    expect(MAIN).toContain('element<HTMLButtonElement>("work-area-create")');
    expect(MAIN).toContain('element<HTMLButtonElement>("workers-assign")');
  });

  it("uses the shared independent frame, title, button and slot artwork", () => {
    for (const selector of ["#return-popup", "#build-panel", "#work-areas-panel", "#workers-panel"]) {
      expect(STYLES, selector).toContain(selector);
    }
    for (const asset of [
      "var(--ui-art-panel-frame)",
      "var(--ui-art-title-bar)",
      "var(--ui-art-button-primary)",
      "var(--ui-art-button-disabled)",
      "var(--ui-art-slot-normal)",
      "var(--ui-art-slot-selected)"
    ]) {
      expect(STYLES, asset).toContain(asset);
    }
    expect(STYLES).toContain("border-image");
    expect(STYLES).toContain("background-image: var(--ui-art-paper)");
    expect(SHOP_STYLES).not.toContain("HAPPYFARM_FINAL_STYLE.png");
  });

  it("preserves touch-safe responsive layouts and dynamic content ownership", () => {
    expect(STYLES).toContain("@media (max-width: 560px)");
    expect(STYLES).toContain("min-height: var(--touch-target)");
    expect(STYLES).toContain("#build-panel .shop-grid { grid-template-columns: repeat(2");
    expect(STYLES).toContain("#work-areas-panel .work-area-actions");
    expect(STYLES).toContain("#workers-panel .auto-card");
    expect(MAIN).toContain('element<HTMLElement>("return-popup-items")');
    expect(MAIN).toContain('element<HTMLElement>("build-gold")');
    expect(MAIN).toContain('element<HTMLButtonElement>("workers-auto-toggle")');
  });
});
