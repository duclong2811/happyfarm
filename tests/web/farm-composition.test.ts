import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { layoutFarmTiles } from "../../apps/web/src/render/layout";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";
import { COMPOSITION_PRESETS, FARM_FIELD_BOUNDS, districtAt } from "../../apps/web/src/render/world-config";

/**
 * The invariants of the island's set dressing.
 *
 * The composition layer is decoration, and decoration is exactly the kind of thing that quietly
 * breaks a rule: a barrel inside a plantable tile is a barrel the player cannot plant on, a preset
 * anchored in the wrong district is a market in a wood, and a prop id with no model is a hole in a
 * yard that no test would otherwise see. These are the questions a person would ask of it.
 */

const MODEL_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models/props", import.meta.url));

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
  return buildFarmWorld({ layout, tiles, plots });
}

describe("composition presets", () => {
  it("anchors every preset in the district it claims, and names a real district", () => {
    for (const preset of COMPOSITION_PRESETS) {
      const owner = districtAt(preset.anchor);
      expect(owner?.kind, `${preset.id} stands in ${owner?.kind ?? "no district"}`).toBe(preset.district);
    }
  });

  it("uses unique preset ids and a non-empty cast", () => {
    const ids = COMPOSITION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Four places the island furnishes: the farmyard, the market square, the well, and the quay. The
    // orchard yard and the timber yard went with the production districts they belonged to.
    expect(COMPOSITION_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of COMPOSITION_PRESETS) {
      expect(preset.props.length, preset.id).toBeGreaterThan(2);
      expect(preset.clearanceTiles, preset.id).toBeGreaterThan(0);
    }
  });

  it("names a prop for every placement, and every prop id has a model on disk", () => {
    for (const preset of COMPOSITION_PRESETS) {
      for (const prop of preset.props) {
        // The id is the contract between the world config and the manifest; the file is what the
        // bundle serves. Both have to exist, and neither may be inferred from the other.
        expect(existsSync(`${MODEL_ROOT}/${prop.assetId}.glb`), prop.assetId).toBe(true);
        expect(prop.scale, `${preset.id}/${prop.assetId}`).toBeGreaterThan(0);
        expect(Math.hypot(prop.offsetX, prop.offsetY), `${preset.id}/${prop.assetId}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every dressed prop off the land the catalogue can sell", () => {
    const world = starterWorld();
    for (const prop of world.compositions.props) {
      const tile = { x: prop.worldX / 1.08 + 5.5, y: prop.worldZ / 1.08 + 5.5 };
      const onReserve =
        tile.x >= FARM_FIELD_BOUNDS.minX &&
        tile.x <= FARM_FIELD_BOUNDS.maxX &&
        tile.y >= FARM_FIELD_BOUNDS.minY &&
        tile.y <= FARM_FIELD_BOUNDS.maxY;
      // A barrel standing on a plantable tile is a tile the player cannot plant: decoration may sit
      // beside the reserve, never on it.
      expect(onReserve, `${prop.presetId}/${prop.assetId} at ${tile.x.toFixed(1)},${tile.y.toFixed(1)}`).toBe(false);
    }
  });

  it("stands every prop on the ground rather than above or below it", () => {
    const world = starterWorld();
    for (const prop of world.compositions.props) {
      // `worldY` is the terrain height plus the same ground offset every other placement uses, so a
      // prop in a yard on a slope is flush with the slope.
      expect(prop.worldY).toBeGreaterThanOrEqual(-0.05);
      // The island's relief reaches about eight metres, so a yard on a shoulder sits a few metres
      // above the plateau. Anything past that is a prop floating over the island rather than on it.
      expect(prop.worldY).toBeLessThanOrEqual(9);
      expect(prop.sizeWorld).toBeGreaterThan(0);
    }
  });

  it("keeps scenery out of every furnished place", () => {
    const world = starterWorld();
    expect(world.compositions.clearings.length).toBe(COMPOSITION_PRESETS.length);
    for (const entry of world.scenery) {
      for (const clearing of world.compositions.clearings) {
        const distance = Math.hypot(entry.worldX - clearing.worldX, entry.worldZ - clearing.worldZ);
        expect(distance, `${entry.kind} inside ${clearing.id}`).toBeGreaterThanOrEqual(clearing.radiusWorld);
      }
    }
  });

  it("is deterministic: the same presets dress the same island every time", () => {
    const first = starterWorld();
    const second = starterWorld();
    expect(first.compositions.props).toEqual(second.compositions.props);
    expect(first.compositions.clearings).toEqual(second.compositions.clearings);
  });
});
