import { describe, expect, it } from "vitest";
import { plantingHintCells } from "../../apps/web/src/render/interaction-grid";
import type { SceneTile } from "../../apps/web/src/render/view-model";

/**
 * The planting hint is one cell, not the whole parcel.
 *
 * V14.5.1 showed a lattice over every plantable tile, which painted the owned 12x12 square as a grid
 * during Plant mode and taught the wrong rule. V14.5.1B outlines only the cell the player is
 * considering, so the island reads as somewhere a player may develop rather than a fenced yard.
 */

function tile(x: number, y: number, plantable: boolean): SceneTile {
  return {
    tileX: x,
    tileY: y,
    worldX: x,
    worldZ: y,
    terrainType: "SOIL",
    plantable,
    selected: false,
    crop: null,
    tree: null
  };
}

describe("the planting hint", () => {
  it("outlines only the selected cell, however many cells are plantable", () => {
    const tiles = Array.from({ length: 144 }, (_, index) =>
      tile(index % 12, Math.floor(index / 12), true)
    );
    const hint = plantingHintCells(tiles, { x: 5, y: 5 });
    expect(hint).toHaveLength(1);
    expect(hint[0]).toMatchObject({ tileX: 5, tileY: 5 });
  });

  it("draws nothing when the selected cell is not plantable or nothing is selected", () => {
    const tiles = [tile(1, 1, false), tile(2, 2, true)];
    expect(plantingHintCells(tiles, { x: 1, y: 1 })).toEqual([]);
    expect(plantingHintCells(tiles, null)).toEqual([]);
  });
});
