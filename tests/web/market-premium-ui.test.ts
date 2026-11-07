import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX_HTML = readFileSync(`${ROOT}/apps/web/index.html`, "utf8");
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const COMPONENTS = readFileSync(`${ROOT}/apps/web/src/ui/components.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");

describe("premium Farm Market presentation", () => {
  it("keeps the real market panel, mode controls, shelf and trade surface", () => {
    for (const id of [
      "market-panel",
      "market-close",
      "market-tab-buy",
      "market-tab-sell",
      "market-grid",
      "market-trade"
    ]) {
      expect(INDEX_HTML, id).toContain(`id="${id}"`);
    }
    expect(MAIN).toContain("renderMarketTabs");
    expect(MAIN).toContain("marketCardNode");
    expect(MAIN).toContain("renderMarketTrade");
    expect(MAIN).toContain("itemThumbnails.apply(card.visual.request");
    expect(MAIN).toContain('submit.disabled = !economicStateReady() || !canSubmit || marketTradePending;');
  });

  it("decorates the existing market shell and states with shared independent artwork", () => {
    expect(COMPONENTS).toContain('market?.classList.add("ui-market-shell", "ui-market-vibrant")');
    for (const selector of [
      "#market-panel.ui-market-shell",
      ".market-tab.is-active",
      "#market-grid .item-card.is-selected",
      ".market-submit:disabled",
      ".market-trade-thumb"
    ]) {
      expect(STYLES, selector).toContain(selector);
    }
    for (const artwork of [
      "var(--ui-art-panel-frame)",
      "var(--ui-art-title-bar)",
      "var(--ui-art-button-primary)",
      "var(--ui-art-button-disabled)",
      "var(--ui-art-slot-normal)"
    ]) {
      expect(STYLES, artwork).toContain(artwork);
    }
    expect(STYLES).not.toContain("HAPPYFARM_FINAL_STYLE.png");
  });

  it("contains the Vibrant Cozy Farm 3D acceptance namespace without altering market ownership", () => {
    expect(STYLES).toContain("#market-panel.ui-market-shell.ui-market-vibrant");
    for (const artwork of [
      "--vibrant-market-header",
      "--vibrant-market-primary",
      "--vibrant-market-secondary",
      "--vibrant-market-selected",
      "--vibrant-market-price"
    ]) {
      expect(STYLES).toContain(artwork);
    }
    expect(MAIN).toContain("itemThumbnails.apply(card.visual.request");
    expect(MAIN).toContain('submit.disabled = !economicStateReady() || !canSubmit || marketTradePending;');
    expect(MAIN).toContain('node.classList.add("market-vibrant-product-card")');
    expect(MAIN).toContain("node.insertBefore(frame, node.firstChild)");
    expect(COMPONENTS).toContain('frame.className = "market-vibrant-frame"');
  });

  it("keeps the contextual object controls clear of the planting dock without hiding placement controls", () => {
    expect(STYLES).toContain("body.is-placing .action-dock { display: none; }");
    expect(STYLES).toContain("body:not(.is-placing) .object-panel");
    expect(STYLES).toContain("@media (max-width: 560px)");
    expect(STYLES).toContain("min-height: var(--touch-target)");
  });
});
