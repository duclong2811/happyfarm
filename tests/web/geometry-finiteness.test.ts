import { describe, expect, it } from "vitest";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import {
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  type BufferAttribute,
} from "three";
import { createSharedAssets } from "../../apps/web/src/render/materials";
import { layoutFarmTiles } from "../../apps/web/src/render/layout";
import { buildLockedPlotOverlay, buildTerrain } from "../../apps/web/src/render/terrain";
import { buildScenery } from "../../apps/web/src/render/scenery";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";

function starterWorld() {
  const tiles = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  const plots = [1, 2, 3, 4, 5, 6, 7, 8].map((plotIndex) => ({
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 500,
    requiredLevel: 1,
    unlocked: plotIndex === 1
  }));
  const frame = landFrame(tiles, plots);
  const layout = layoutFarmTiles(tiles, frame === null ? {} : { frame });
  return { layout, world: buildFarmWorld({ layout, tiles, plots }) };
}

function assertFiniteGeometry(
  geometry: BufferGeometry,
  label: string
): void {
  const position = geometry.getAttribute("position") as BufferAttribute;
  expect(position, `${label} has a position attribute`).toBeDefined();
  for (let index = 0; index < position.count * position.itemSize; index += 1) {
    expect(Number.isFinite(position.array[index]), `${label} position[${String(index)}]`).toBe(true);
  }
  geometry.computeBoundingSphere();
  expect(geometry.boundingSphere, `${label} has a bounding sphere`).not.toBeNull();
  expect(Number.isFinite(geometry.boundingSphere?.radius), `${label} bounding radius`).toBe(true);
}

function assertFiniteScene(root: Group): void {
  root.traverse((node) => {
    if (node instanceof Mesh && node.geometry instanceof BufferGeometry) {
      assertFiniteGeometry(node.geometry as BufferGeometry, node.name || node.type);
    }
    if (node instanceof InstancedMesh) {
      for (const value of node.instanceMatrix.array) {
        expect(Number.isFinite(value), `${node.name || node.type} instance matrix`).toBe(true);
      }
      node.computeBoundingSphere();
      expect(Number.isFinite(node.boundingSphere?.radius), `${node.name || node.type} bounding radius`).toBe(true);
    }
  });
}

describe("procedural world geometry", () => {
  it("does not build terrain geometry for the empty pre-farm world", () => {
    const layout = layoutFarmTiles([]);
    const world = buildFarmWorld({ layout, tiles: [], plots: [] });
    const group = new Group();
    buildTerrain(group, createSharedAssets(), world, layout);

    expect(group.children).toHaveLength(0);
    assertFiniteScene(group);
  });

  it("keeps starter terrain, scenery, and overlay positions and bounds finite", () => {
    const { layout, world } = starterWorld();
    const assets = createSharedAssets();
    const staticGroup = new Group();
    buildTerrain(staticGroup, assets, world, layout);
    buildScenery(staticGroup, assets, world.scenery, () => undefined, false);
    buildLockedPlotOverlay(staticGroup, assets, world, layout);

    assertFiniteScene(staticGroup);
  }, 10_000);
});
