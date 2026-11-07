import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closePanel, NO_PANEL, openPanel } from "../../apps/web/src/panels";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX_HTML = readFileSync(`${ROOT}/apps/web/index.html`, "utf8");
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const COMPONENTS = readFileSync(`${ROOT}/apps/web/src/ui/components.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");
const MANIFEST = readFileSync(`${ROOT}/docs/design/HAPPYFARM_UI_ART_LICENSE_MANIFEST.md`, "utf8");
const ART_DIR = `${ROOT}/apps/web/src/assets/ui/kenney`;
const PREMIUM_ART_DIR = `${ROOT}/apps/web/src/assets/ui/inventory-premium`;
const PRODUCTION_ART_DIR = `${ROOT}/apps/web/src/assets/ui/premium-2_5d`;

describe("Inventory licensed art integration", () => {
  it("keeps Inventory open/close behavior on the existing panel state path", () => {
    const inventory = openPanel(NO_PANEL, "inventory");
    expect(inventory).toEqual({ active: "inventory" });
    expect(closePanel(inventory)).toEqual(NO_PANEL);
    expect(INDEX_HTML).toContain('id="inventory-panel"');
    expect(MAIN).toContain("setActivePanel(togglePanel(panels, module.id))");
    expect(MAIN).toContain("setActivePanel(closePanel(panels))");
  });

  it("uses the reusable category renderer and preserves tab semantics", () => {
    expect(MAIN).toContain("renderCategoryTabs(");
    expect(COMPONENTS).toContain('setAttribute("role", "tab")');
    expect(COMPONENTS).toContain('setAttribute("aria-selected", String(active))');
    expect(STYLES).toContain(".ui-category-tab.is-active");
    expect(STYLES).toContain("tab-active.png");
    expect(STYLES).toContain("tab-normal.png");
  });

  it("uses licensed artwork for capacity states without moving server-owned values", () => {
    expect(MAIN).toContain("renderCapacityBar(");
    expect(COMPONENTS).toContain('setAttribute("role", "progressbar")');
    expect(COMPONENTS).toContain('setAttribute("aria-valuenow"');
    expect(STYLES).toContain("ui-capacity-bar-fill");
    expect(STYLES).toContain("background: #68a947");
    expect(STYLES).toContain("background: #b9503d");
    expect(MAIN).toContain('element<HTMLElement>("warehouse-usage").textContent = t("warehouse.usedOf"');
  });

  it("keeps normal, selected and disabled slot states on the shared item renderer", () => {
    expect(MAIN).toContain("renderInventorySlot(");
    expect(COMPONENTS).toContain("slot.classList.add(\"ui-inventory-slot\")");
    expect(STYLES).toContain(".ui-inventory-slot.is-selected");
    expect(STYLES).toContain(".ui-inventory-slot.is-locked");
    expect(STYLES).toContain(".ui-inventory-slot.is-empty");
    expect(STYLES).toContain("premium-2_5d/item-slot.png");
    expect(STYLES).toContain("--ui-art-slot-hover");
    expect(STYLES).toContain("--ui-art-slot-selected");
  });

  it("ships only text-free SVG layers with the source license manifest", () => {
    const files = readdirSync(ART_DIR).filter((file) => file.endsWith(".svg"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const svg = readFileSync(`${ART_DIR}/${file}`, "utf8");
      expect(svg, file).not.toContain("<text");
    }
    expect(readFileSync(`${ART_DIR}/Kenney-License.txt`, "utf8").length).toBeGreaterThan(0);
    expect(MANIFEST).toContain("Creative Commons CC0");
    expect(MANIFEST).toContain("Kenney UI Pack - Adventure");
    expect(MANIFEST).toContain("Current primary artwork");
  });

  it("uses independent premium artwork and keeps the rejected Kenney skin out of primary CSS", () => {
    const files = [
      "panel-frame.png",
      "title-bar.png",
      "parchment-texture.png",
      "tab-normal.png",
      "tab-active.png",
      "leaf-sprig.png"
    ];
    for (const file of files) {
      expect(readFileSync(`${PREMIUM_ART_DIR}/${file}`).length, file).toBeGreaterThan(0);
      expect(STYLES, file).toContain(file);
    }
    for (const file of ["button-primary.png", "button-secondary.png", "button-selected.png", "button-disabled.png", "nav-button-normal.png", "nav-button-active.png", "item-slot.png"]) {
      expect(readFileSync(`${PRODUCTION_ART_DIR}/${file}`).length, file).toBeGreaterThan(0);
      expect(STYLES, file).toContain(`premium-2_5d/${file}`);
    }
    for (const preserved of ["seed-pouch.png", "seed-pouch-carrot.png", "seed-pouch-corn.png"]) {
      expect(readFileSync(`${PREMIUM_ART_DIR}/${preserved}`).length, preserved).toBeGreaterThan(0);
    }
    expect(STYLES).toContain("border-image");
    expect(STYLES).toContain(".ui-inventory-slot:hover");
    expect(STYLES).toContain('data-fallback="SEED"');
    expect(STYLES).toContain('data-fallback="SEED_CARROT"');
    expect(STYLES).toContain('data-fallback="SEED_CORN"');
    expect(STYLES).not.toContain("assets/ui/kenney/panel_brown.svg");
    expect(STYLES).not.toContain("assets/ui/kenney/button_brown.svg");
  });

  it("integrates only the clean V1 candidate layers and rejects labelled slot candidates", () => {
    const candidateFiles = [
      "v1-panel-frame.png",
      "v1-title-bar.png",
      "v1-tab-normal.png",
      "v1-tab-active.png",
      "v1-seed-generic.png",
      "v1-seed-carrot.png",
      "v1-seed-corn.png"
    ];
    for (const file of candidateFiles) {
      expect(readFileSync(`${PREMIUM_ART_DIR}/${file}`).length, file).toBeGreaterThan(0);
      expect(STYLES, file).toContain(file);
    }
    expect(STYLES).toContain("160 82 180 84");
    expect(MANIFEST).toContain("baked state labels");
    expect(MANIFEST).toContain("legacy clean slot assets remain preserved");
  });

  it("extends the same material language to the approved HUD and navigation slice", () => {
    expect(STYLES).toContain("--ui-art-hud-resource");
    expect(STYLES).toContain(".ui-top-hud-bar .hud-stat");
    expect(STYLES).toContain(".module-rail .module-launcher.is-active");
    expect(STYLES).toContain("premium-2_5d/button-secondary.png");
    expect(STYLES).toContain("premium-2_5d/button-primary.png");
    expect(STYLES).toContain("premium-2_5d/item-slot.png");
    expect(STYLES).toContain("leaf-sprig.png");
  });

  it("keeps visible Inventory and HUD text on the correct contrast side of each material", () => {
    expect(STYLES).toContain("--ui-color-text-on-parchment: #4f2e17");
    expect(STYLES).toContain("--ui-color-text-on-green: #fff8df");
    expect(STYLES).toContain(".ui-top-hud-bar .hud-stat .big");
    expect(STYLES).toContain(".ui-category-tab.is-active");
    expect(STYLES).toContain("color: var(--ui-color-text-on-parchment)");
    expect(STYLES).toContain("text-shadow: none");
  });

  it("keeps the approved color, typography and Inventory hierarchy tokens shared", () => {
    expect(STYLES).toContain("--ui-color-wood: #965021");
    expect(STYLES).toContain("--ui-color-parchment: #f7e9c8");
    expect(STYLES).toContain("--ui-color-leaf: #27833b");
    expect(STYLES).toContain("--ui-color-gold: #f2be48");
    expect(STYLES).toContain('--ui-font-display: "Baloo 2 Variable"');
    expect(STYLES).toContain('--ui-font-body: "Nunito Variable"');
    expect(STYLES).toContain("#inventory-panel.ui-inventory-shell #warehouse-upgrade");
    expect(STYLES).toContain("var(--ui-art-button-normal)");
    expect(STYLES).toContain("min-height: 2rem");
    expect(STYLES).toContain("gap: .66rem");
  });
});
