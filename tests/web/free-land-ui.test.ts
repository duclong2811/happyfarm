import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * V14.5.2: the natural Home Island is the player's land, and the buying UI is gone.
 *
 * These are source contracts on the two places a removed control would leave a trace: the markup the
 * player sees and the page code that wired it. A dead "Buy land" button, or a stray ownership wash
 * call, is exactly what the pass is meant to remove.
 */

const INDEX_HTML = readFileSync(fileURLToPath(new URL("../../apps/web/index.html", import.meta.url)), "utf8");
const MAIN = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");

describe("land purchase is not in the normal HUD", () => {
  it("has no Buy Land controls, plots list, or land HUD in the markup", () => {
    for (const removed of ["expand-farm", "buy-cell-mode", 'id="plots"', "land-buy-hud", "land-title"]) {
      expect(INDEX_HTML, removed).not.toContain(removed);
    }
  });

  it("has no land-mode code path in the page", () => {
    for (const removed of [
      "setLandBuyMode",
      "renderLandBuyHud",
      "renderPlots",
      "expandFarm",
      "quoteLandCells",
      "buyLandCells",
      "setOwnershipOverlay",
      "setPurchasableOverlay",
      "placementLand",
      "plantLand"
    ]) {
      expect(MAIN, removed).not.toContain(removed);
    }
  });
});
