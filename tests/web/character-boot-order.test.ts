import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The scene must be able to build itself without the character's model library.
 *
 * This is the regression test for the V13.4.1 hotfix, and it is a *source* test on purpose: the bug
 * was a temporal-dead-zone reference inside `createFarmScene` - the character view called
 * `library.load(...)` while the scene was still constructing the character, hundreds of lines before
 * `const library = sharedModelLibrary(...)` runs. Instantiating a scene needs a canvas and a WebGL
 * context, which this suite deliberately does not have, so the ordering itself is what is asserted
 * (the same technique the staging-routing test uses for an import graph).
 *
 * Two properties, and between them they are the whole invariant:
 *
 * 1. the character view is *constructed* before the library exists, so it cannot touch it;
 * 2. the character is only *asked for* after the library exists - and `load` returns nothing, so
 *    nothing in boot can wait on a cosmetic asset.
 */

const SCENE = fileURLToPath(new URL("../../apps/web/src/render/scene.ts", import.meta.url));

describe("scene boot order", () => {
  it("builds the character before the model library, and loads it only afterwards", () => {
    const source = readFileSync(SCENE, "utf8");
    const libraryAt = source.indexOf("const library = sharedModelLibrary(");
    const constructAt = source.indexOf("const characterView = createPlayerCharacterView({");
    const loadAt = source.indexOf("characterView.load({");

    expect(libraryAt, "the scene builds a model library").toBeGreaterThan(-1);
    expect(constructAt, "the scene builds a character view").toBeGreaterThan(-1);
    expect(loadAt, "the scene asks for the character model").toBeGreaterThan(-1);

    // The view is built during the scene's own setup, long before the library is created...
    expect(constructAt).toBeLessThan(libraryAt);
    // ...which is only safe because the construction passes it no way to load anything.
    const construction = source.slice(constructAt, source.indexOf("});", constructAt));
    expect(construction, "construction must not reach for the library").not.toContain("library");
    expect(construction).not.toContain("loadModel");

    // And the load is asked for after the library exists, at the end of setup.
    expect(loadAt).toBeGreaterThan(libraryAt);
  });

  it("asks for the character after the world it belongs to has been built and drawn", () => {
    const source = readFileSync(SCENE, "utf8");
    const applyStateAt = source.lastIndexOf("applyState(state);");
    const loadAt = source.indexOf("characterView.load({");
    // The island is the game; the character is decoration on it. The world is applied first, so a
    // character that never arrives cannot leave an empty scene.
    expect(applyStateAt).toBeGreaterThan(-1);
    expect(applyStateAt).toBeLessThan(loadAt);
  });
});
