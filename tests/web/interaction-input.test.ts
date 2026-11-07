import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interactionKeyRequested } from "../../apps/web/src/interaction/selection";
import { groundTapOpensContext } from "../../apps/web/src/render/precision-action";

/**
 * The two input methods, and the promises they share.
 *
 * Desktop and touch must run the *same* intent, the keyboard must not steal a keystroke from a text
 * field, and neither surface may rotate the camera or select the ground. Where a rule is pure it is
 * asserted directly; where it is a layout fact that needs a browser to observe, it is asserted against
 * the markup and the source - the technique the repository already uses for boot order and import
 * graphs. The performance contract is here too, because "no new loop, no network while scanning" is a
 * property of the source rather than of any one function's output.
 */

const INDEX_HTML = fileURLToPath(new URL("../../apps/web/index.html", import.meta.url));
const STYLES_CSS = fileURLToPath(new URL("../../apps/web/src/styles.css", import.meta.url));
const INTERACTION_DIR = fileURLToPath(new URL("../../apps/web/src/interaction", import.meta.url));

describe("the interaction key", () => {
  const base = {
    key: "e",
    typing: false,
    repeat: false,
    cameraMode: "CHARACTER" as const,
    hasCandidate: true,
    uiOpen: false
  };

  it("is E, when something is in reach in character view", () => {
    expect(interactionKeyRequested(base)).toBe(true);
    expect(interactionKeyRequested({ ...base, key: "E" })).toBe(true);
  });

  it("leaves every other key alone", () => {
    for (const key of ["w", "q", "f", "r", "Enter", "Escape", " "]) {
      expect(interactionKeyRequested({ ...base, key }), key).toBe(false);
    }
  });

  it("never fires while the player is typing", () => {
    expect(interactionKeyRequested({ ...base, typing: true })).toBe(false);
  });

  it("ignores a held key repeating, so one press is one command", () => {
    // Holding E must not machine-gun the server: the harvest is one press, one request, and the crop
    // that has just been settled must not be asked for again by a key that has not been let go.
    expect(interactionKeyRequested({ ...base, repeat: true })).toBe(false);
  });
  it("never fires with nothing in reach, so the camera keeps the key", () => {
    // E is the character camera's orbit-right key, and it stays that key until something is in reach.
    expect(interactionKeyRequested({ ...base, hasCandidate: false })).toBe(false);
  });

  it("never fires in estate view, or while a panel or a placement owns the input", () => {
    expect(interactionKeyRequested({ ...base, cameraMode: "ESTATE" })).toBe(false);
    expect(interactionKeyRequested({ ...base, uiOpen: true })).toBe(false);
  });
});

describe("interaction input isolation", () => {
  const html = readFileSync(INDEX_HTML, "utf8");

  it("puts the touch button inside the controls, not on the world", () => {
    // A button inside `#touch-controls` belongs to the DOM, so its tap cannot reach the canvas
    // gesture handler: the camera cannot rotate from it and the ground cannot be selected from it.
    const controls = html.indexOf('id="touch-controls"');
    const button = html.indexOf('id="interact-button"');
    const run = html.indexOf('id="run-button"');
    expect(controls).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(controls);
    expect(button).toBeLessThan(run);
  });

  it("shows both surfaces hidden until there is a candidate", () => {
    expect(html).toMatch(/id="interaction-prompt"[^>]*hidden/);
    expect(html).toMatch(/id="interact-button"[^>]*hidden/);
  });
});

describe("aquaculture runtime wiring", () => {
  const main = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");
  const html = readFileSync(INDEX_HTML, "utf8");

  it("routes a picked construction through the panel path before keyboard activation", () => {
    expect(main).toMatch(/onObjectSelected: \(constructionId(?:, traceId)?\)/);
    expect(main).toContain("onObjectSelectedForCharacter(constructionId, effectiveTraceId)");
    expect(main).toContain('isAquacultureConstruction(construction)');
    expect(main).toContain('make("section", "aquaculture-panel")');
    expect(main).toContain('element<HTMLElement>("aquaculture-panel")');
    expect(main).toMatch(/function renderAquaculturePanel\(traceId/);
    expect(main).toContain("renderAquaculturePanel();");
    expect(main).toContain('t("aquaculture.stock")');
    expect(main).toContain('t("aquaculture.harvest")');
    expect(main).toContain("if (requested) void run(runInteraction)");
    expect(main).toContain('case "STOCK_AQUACULTURE":');
    expect(main).toContain('case "HARVEST_AQUACULTURE":');
  });

  it("keeps cage job actions out of the asset-management panel", () => {
    expect(html).toContain('id="aquaculture-panel"');
    const objectPanelStart = main.indexOf("function renderObjectPanel()");
    const objectPanelEnd = main.indexOf("function roadPreviewYaw(", objectPanelStart);
    const objectPanel = main.slice(objectPanelStart, objectPanelEnd);
    expect(objectPanel).toContain('if (actions.move) actionRow.appendChild');
    expect(objectPanel).toContain('if (actions.rotate)');
    expect(objectPanel).toContain('if (actions.store)');
    expect(main).toContain('element<HTMLElement>("aquaculture-panel")');
    expect(main).not.toContain('state.cameraMode === "CHARACTER") {\r\n    node.hidden = true');
    const aquaculturePanel = main.slice(main.indexOf("function renderAquaculturePanel("), main.indexOf("function renderObjectPanel()"));
    expect(aquaculturePanel).toContain('await stockAquaculturePond(pond.pondId, pond.version,');
    expect(aquaculturePanel).toContain('await harvestAquaculturePond(pond.pondId, pond.version,');
    expect(aquaculturePanel).toContain('cohort.readyAt');
    expect(aquaculturePanel).toContain('aquaculture.withdrawRule');
    expect(aquaculturePanel).toContain('aquaculture.full');
    expect(main).toContain('aquacultureCountdownTimer');
    expect(aquaculturePanel).not.toContain('objectPending || interactionPending');
    // The two surfaces must be siblings: the object panel owns Move/Rotate/Store/Delete, while the
    // dedicated aquaculture panel owns Stock/Harvest in both camera modes. A nested second copy was
    // the source of mode-dependent clicks and duplicate DOM/network work.
    expect(objectPanel).not.toContain('aquaculture-panel');
    expect(objectPanel).not.toContain('stockAquaculturePond');
    expect(objectPanel).not.toContain('harvestAquaculturePond');
  });

  it("keeps EMPTY/GROWING/READY commands on their own endpoints and labels", () => {
    const aquaculturePanel = main.slice(main.indexOf("function renderAquaculturePanel("), main.indexOf("function renderObjectPanel()"));
    const stockFunction = main.slice(main.indexOf("async function stockAquaculturePond"), main.indexOf("async function harvestAquaculturePond"));
    const harvestFunction = main.slice(main.indexOf("async function harvestAquaculturePond"), main.indexOf("async function withdrawAquaculturePond"));
    const withdrawFunction = main.slice(main.indexOf("async function withdrawAquaculturePond"), main.indexOf("async function startFishing"));
    expect(aquaculturePanel).toContain('t("aquaculture.stockButton"');
    expect(aquaculturePanel).toContain('t("aquaculture.withdrawButton"');
    expect(aquaculturePanel).toContain('t("aquaculture.harvestButton"');
    expect(aquaculturePanel).toContain("const primaryLimit = view.action");
    expect(aquaculturePanel).toContain("selectedQuantityValue = primaryLimit");
    expect(aquaculturePanel).toContain("panel.insertBefore(primary, firstAction)");
    expect(aquaculturePanel).not.toContain('quantity.type = "number"');
    expect(stockFunction).toContain("api().stockAquaculturePond");
    expect(stockFunction).not.toContain("harvestAquaculturePond");
    expect(harvestFunction).toContain("api().harvestAquaculturePond");
    expect(harvestFunction).not.toContain("stockAquaculturePond");
    expect(withdrawFunction).toContain("api().withdrawAquaculturePond");
    expect(withdrawFunction).not.toContain("stockAquaculturePond");
    expect(readFileSync(fileURLToPath(new URL("../../apps/web/src/i18n.ts", import.meta.url)), "utf8")).toContain('"aquaculture.harvestButton": "Thu hoạch {count} cá rô phi"');
    expect(readFileSync(fileURLToPath(new URL("../../apps/web/src/i18n.ts", import.meta.url)), "utf8")).toContain('"aquaculture.stockButton": "Thả {count} cá giống"');
    expect(readFileSync(fileURLToPath(new URL("../../apps/web/src/i18n.ts", import.meta.url)), "utf8")).toContain('"aquaculture.withdrawButton": "Rút {count} cá giống"');
  });

  it("keeps both selected-cage panels visible and independently hit-testable", () => {
    const styles = readFileSync(STYLES_CSS, "utf8");
    const stackStart = html.indexOf('id="selection-panels"');
    const objectPanelAt = html.indexOf('id="object-panel"', stackStart);
    const aquaculturePanelAt = html.indexOf('id="aquaculture-panel"', stackStart);
    expect(stackStart).toBeGreaterThan(-1);
    expect(objectPanelAt).toBeGreaterThan(stackStart);
    expect(aquaculturePanelAt).toBeGreaterThan(objectPanelAt);
    expect(styles).toMatch(/body:not\(\.is-placing\) \.selection-panels\s*\{[\s\S]*display: flex;/);
    expect(styles).toContain("gap: var(--space-2);");
    expect(styles).toMatch(/\.selection-panels > \.object-panel\s*\{[\s\S]*pointer-events: auto;/);
    expect(styles).not.toMatch(/body:not\(\.is-placing\) \.object-panel\s*\{/);
  });
});

describe("the interaction performance contract", () => {
  const sources = readdirSync(INTERACTION_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(`${INTERACTION_DIR}/${name}`, "utf8") }));

  it("has sources to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("never reaches the network, the clock or the frame loop", () => {
    // Discovery and choice are pure decisions over rows the page already holds. A clock is passed in
    // (so a crop's countdown is testable), a scan cannot call an API, and nothing here may start an
    // animation loop of its own.
    for (const source of sources) {
      for (const forbidden of ["fetch(", "XMLHttpRequest", "requestAnimationFrame", "setInterval", "Date.now", "performance."]) {
        expect(source.text.includes(forbidden), `${source.name} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("keeps the scan bounded by the neighbourhood rather than the island", () => {
    const registry = sources.find((source) => source.name === "registry.ts");
    expect(registry).toBeDefined();
    // The index is a map of cells and the query walks a radius around the player: there is no
    // `for (const target of targets)` over every row anywhere in the selection path.
    const selection = sources.find((source) => source.name === "selection.ts");
    expect(registry?.text).toContain("buckets");
    expect(selection?.text).not.toContain("index.targets");
  });
});

describe("mode switching and the interaction surfaces", () => {
  const main = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");

  it("re-decides the candidate whenever the view changes", () => {
    // One call site inside `setCameraMode`, so leaving character view clears the prompt and entering
    // it decides what is in reach from where the character actually is.
    const setCameraModeAt = main.indexOf("function setCameraMode(");
    const nextFunctionAt = main.indexOf("function recenterCamera(", setCameraModeAt);
    const body = main.slice(setCameraModeAt, nextFunctionAt);
    expect(body).toContain("refreshInteractionCandidate()");
  });

  it("recomputes on the pose stream rather than per frame", () => {
    // The candidate follows the character's own pose events, which only happen while they move; there
    // is no timer and no separate loop for interaction.
    expect(main).toMatch(/onPose:[\s\S]{0,400}refreshInteractionCandidate\(\)/);
  });
});

describe("world tap intent", () => {
  it("keeps character taps contextual while estate taps can select any cell", () => {
    expect(groundTapOpensContext({ mode: "CHARACTER", hasContextAction: true })).toBe(true);
    expect(groundTapOpensContext({ mode: "CHARACTER", hasContextAction: false })).toBe(false);
    expect(groundTapOpensContext({ mode: "ESTATE", hasContextAction: false })).toBe(true);
  });
});
