import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import type { FarmTileDTO, PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildFarmSceneInput } from "../../apps/web/src/render/view-model";
import {
  CONSTRUCTION_ID_KEY,
  constructionIdFromHits,
  constructionIdFromNode,
  tapTargetFor
} from "../../apps/web/src/render/object-picking";
import {
  editableActions,
  ownedBounds,
  ownedCells,
  refundPreview,
  selectedRow
} from "../../apps/web/src/object-editing";

/**
 * The interaction layer, held to the promises the live game makes.
 *
 * V13.2 shipped this layer with no tests of its own, and the first real browser session found two
 * failures in it: the player could not see which land was theirs, and clicking a built thing did not
 * open the editor. Both were *interaction* problems, and this file is the missing net: real three
 * objects and a real raycaster for the picking half, and pure decisions for everything the panel and
 * the ghost do.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function tile(x: number, y: number): FarmTileDTO {
  return {
    farmId: "farm_editing",
    x,
    y,
    terrainType: "SOIL",
    state: "IDLE",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 500,
    requiredLevel: 1,
    unlocked
  };
}

/** The starter farm: twelve by twelve, exactly as the server creates it. */
function starterCells() {
  const tiles: FarmTileDTO[] = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push(tile(x, y));
  }
  return buildFarmSceneInput({
    tiles,
    crops: [],
    trees: [],
    plots: [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => plot(plotIndex, plotIndex === 1)),
    selected: null
  }).cells;
}

/**
 * A rendered construction: a root that carries the id, a wrapper, and the leaf mesh a raycaster
 * actually hits - the shape a cloned GLTF has, and the shape that broke the first implementation's
 * assumption that the intersection is the node with the id on it.
 */
function renderedConstruction(id: string, worldX: number, worldZ: number): Group {
  const root = new Group();
  root.userData[CONSTRUCTION_ID_KEY] = id;
  const wrapper = new Group();
  const leaf = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  wrapper.add(leaf);
  root.add(wrapper);
  root.position.set(worldX, 0, worldZ);
  return root;
}

describe("picking a built thing out of a raycast", () => {
  it("resolves an id from a leaf mesh several levels below the root", () => {
    const root = renderedConstruction("construct_11111111-1111-4111-8111-111111111111", 0, 0);
    const leaf = root.children[0]?.children[0];
    expect(leaf).toBeDefined();
    // The hit is the leaf, and only the root knows what it is: this is the walk the live game needs.
    expect(constructionIdFromNode(leaf as Mesh)).toBe("construct_11111111-1111-4111-8111-111111111111");
  });

  it("finds the first hit that belongs to a construction, skipping the world's own scenery", () => {
    const scenery = new Group();
    scenery.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    const player = renderedConstruction("construct_22222222-2222-4222-8222-222222222222", 0, 0);
    const leaf = player.children[0]?.children[0] as Mesh;
    const hit = { object: leaf };
    const other = { object: scenery.children[0] as Mesh };
    // A tree in front of the barn does not end the search: the world is full of things that are not
    // the player's, and the first *construction* on the ray is the one they pointed at.
    expect(constructionIdFromHits([other, hit])).toBe("construct_22222222-2222-4222-8222-222222222222");
    expect(constructionIdFromHits([other])).toBeNull();
    expect(constructionIdFromHits([])).toBeNull();
  });

  it("hits a rendered construction with a real raycaster, and not the empty ground beside it", () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 10, 0);
    camera.lookAt(new Vector3(0, 0, 0));
    camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    const root = renderedConstruction("construct_33333333-3333-4333-8333-333333333333", 0, 0);
    root.updateMatrixWorld(true);

    raycaster.setFromCamera(new Vector2(0, 0), camera);
    expect(constructionIdFromHits(raycaster.intersectObjects([root], true))).toBe(
      "construct_33333333-3333-4333-8333-333333333333"
    );

    // A ray aimed away from the object finds nothing, which is what makes an empty click a ground
    // click rather than a selection.
    raycaster.setFromCamera(new Vector2(0.95, 0.95), camera);
    expect(constructionIdFromHits(raycaster.intersectObjects([root], true))).toBeNull();
  });

  it("gives a construction click priority over the ground, and only then", () => {
    const id = "construct_44444444-4444-4444-8444-444444444444";
    expect(tapTargetFor({ objectPickingEnabled: true, constructionId: id })).toBe("OBJECT");
    // Empty ground: the click belongs to the cell, which is what keeps click-to-move working.
    expect(tapTargetFor({ objectPickingEnabled: true, constructionId: null })).toBe("GROUND");
    // While something is in hand, a click is a placement click even if it lands on a building.
    expect(tapTargetFor({ objectPickingEnabled: false, constructionId: id })).toBe("GROUND");
  });
});

describe("what the editor offers", () => {
  it("offers only the actions the asset's own policy allows", () => {
    expect(editableActions({ movable: true, rotatable: true, removable: true })).toEqual({
      move: true,
      rotate: true,
      remove: true
    });
    // A silo: it does not turn.
    expect(editableActions({ movable: true, rotatable: false, removable: true })).toEqual({
      move: true,
      rotate: false,
      remove: true
    });
    expect(editableActions({ movable: false, rotatable: false, removable: false })).toEqual({
      move: false,
      rotate: false,
      remove: false
    });
    // A row whose catalogue entry the client does not have: no guessed actions, and no fake buttons.
    expect(editableActions(null)).toEqual({ move: false, rotate: false, remove: false });
  });

  it("previews a refund the way the server computes it, and never invents one", () => {
    expect(refundPreview(900, 0.5)).toBe(450);
    expect(refundPreview(40, 0)).toBe(0);
    expect(refundPreview(41, 0.25)).toBe(10);
    // A rate that tried to be a money press is clamped, exactly as the domain clamps it.
    expect(refundPreview(900, 4)).toBe(900);
  });

  it("keeps the selection by id across a refresh that replaced every row", () => {
    const before = [{ constructionId: "construct_a", version: 1 }];
    const after = [{ constructionId: "construct_a", version: 2 }];
    expect(selectedRow(before, "construct_a")?.version).toBe(1);
    // The row the panel shows is the *server's current* row, not the copy the panel was opened with:
    // a stale copy is a stale `expectedVersion`, which the server refuses.
    expect(selectedRow(after, "construct_a")?.version).toBe(2);
    expect(selectedRow(after, "construct_b")).toBeNull();
    expect(selectedRow(after, null)).toBeNull();
  });
});

describe("the developer's own-land diagnostic", () => {
  it("reads exactly the cells the server says the farm owns", () => {
    const cells = starterCells();
    const owned = ownedCells(cells);
    expect(owned).toHaveLength(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    const bounds = ownedBounds(owned);
    // The starter parcel, where the player can actually see it: the twelve-tile square around the
    // world origin, which is the field the estate camera frames and the fence surrounds.
    expect(bounds).toEqual({ minX: 0, maxX: 11, minY: 0, maxY: 11, count: 144 });
    // Everything marked is owned, and nothing unowned is marked.
    for (const cell of owned) {
      expect(cells.cells.get(`${String(cell.x)},${String(cell.y)}`)?.owned).toBe(true);
    }
    expect(owned.some((cell) => cell.x > 11 || cell.y > 11)).toBe(false);
  });
});

describe("one placement command, two ways to send it", () => {
  it("sends the placement from Enter and from the confirm button through the same function", () => {
    const source = readFileSync(`${REPO_ROOT}apps/web/src/main.ts`, "utf8");
    // The brief's rule: Enter and the button must not be two code paths. There is exactly one call to
    // the command, and both routes reach it.
    const calls = source.match(/api\(\)\.placeConstruction\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // Two *invocations* and no more: the keyboard branch and the button's click handler. (The
    // function's own declaration is not an invocation, which is why the search is for the statement.)
    expect(source.match(/void confirmPlacement\(\);/g) ?? []).toHaveLength(2);
    const enter = /event\.key === "Enter"[\s\S]{0,80}confirmPlacement\(\)/.test(source);
    const button = /make\("button", "placement-confirm"\)[\s\S]{0,400}confirmPlacement\(\)/.test(source);
    expect(enter).toBe(true);
    expect(button).toBe(true);
  });
});
