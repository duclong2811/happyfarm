import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interactionKeyRequested } from "../../apps/web/src/interaction/selection";

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
