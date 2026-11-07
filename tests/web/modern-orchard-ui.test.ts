import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPONENTS = readFileSync(`${ROOT}/apps/web/src/ui/components.ts`, "utf8");
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/ui/warm-harvest.css`, "utf8");
const SHOP_VIEW = readFileSync(`${ROOT}/apps/web/src/build-shop/shop-view.ts`, "utf8");

describe("Warm Harvest construction acceptance experiment", () => {
  it("opts in only the real Construction, HUD and module navigation hosts", () => {
    expect(COMPONENTS).toContain('"ui-warm-harvest-hud"');
    expect(COMPONENTS).toContain('"ui-warm-harvest-construction"');
    expect(MAIN).toContain('import "./ui/warm-harvest.css";');
    expect(COMPONENTS).not.toContain('"ui-v2--construction"');
  });

  it("uses the Warm Harvest material system without old artwork-backed surfaces", () => {
    for (const color of ["#fff7eb", "#f5dfc0", "#3e2b26", "#f28c45", "#a74425", "#e9b54b"]) {
      expect(STYLES.toLowerCase()).toContain(color);
    }
    expect(STYLES).toContain("#build-panel.ui-warm-harvest-construction");
    expect(STYLES).toContain(".module-rail.ui-warm-harvest-hud");
    expect(STYLES).not.toContain("premium-2_5d/");
    expect(STYLES).not.toContain("inventory-premium/");
    expect(STYLES).not.toContain("border-image: var(");
  });

  it("retains the existing catalog, thumbnail and placement owners", () => {
    for (const className of ["shop-rail-item", "shop-card", "shop-inspector", "shop-place", "shop-thumb-image"]) {
      expect(SHOP_VIEW).toContain(className);
    }
    expect(SHOP_VIEW).toContain("handlers.onPlace()");
    expect(MAIN).toContain('renderAssetGrid(element<HTMLElement>("build-rows")');
    expect(MAIN).toContain('renderInspector(element<HTMLElement>("build-inspector")');
  });

  it("defines a dedicated compact composition with touch-sized controls", () => {
    expect(STYLES).toContain("@media (max-width: 700px)");
    expect(STYLES).toContain("flex-direction: column");
    expect(STYLES).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(STYLES).toContain("min-height: var(--touch-target)");
  });
});
