import { describe, expect, it } from "vitest";
import type { PlotDTO } from "@happy-farm/contracts";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { STARTER_WORLD_PLACEMENTS_V2 } from "@happy-farm/game-data";
import { layoutFarmTiles, worldFrame } from "../../apps/web/src/render/layout";
import { environmentModelFor } from "../../apps/web/src/render/scenery";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";

/**
 * The committed V2 arrangement still matches the island the renderer grows.
 *
 * `packages/game-data/src/world/starter-v2.ts` is *generated* from the deterministic world model, but
 * the renderer is the authority on where the island's trees stand. This test rebuilds the world and
 * recomputes the promoted set, so the two cannot drift: change the scatter and this fails, which is
 * the signal to regenerate the table rather than ship an island that draws one forest and seeds
 * another. It is also the guard the migration depends on - the rows a farm is given are exactly the
 * objects the client no longer draws for itself, and any disagreement would be a missing or doubled
 * tree on every farm.
 */

const DEFINITION_BY_KIND: Readonly<Record<string, string>> = {
  tree: "world.tree_broad",
  pine: "world.tree_pine",
  bush: "world.bush",
  rock: "world.rock"
};

function plot(plotIndex: number, unlocked: boolean): PlotDTO {
  return {
    plotId: `plot_${String(plotIndex)}`,
    plotIndex,
    currencyId: "currency_gold",
    currencyDisplayNameKey: "currency.gold.name",
    price: 100,
    requiredLevel: 1,
    unlocked
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

describe("the generated starter arrangement", () => {
  it("matches the island the renderer grows", () => {
    const tiles = [];
    for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
      for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
    }
    const catalogue = [1, 2, 3, 4, 5].map((index) => plot(index, false));
    const land = landFrame(tiles, catalogue);
    const layout = layoutFarmTiles(tiles, land === null ? {} : { frame: land });
    const world = buildFarmWorld({ layout, tiles, plots: catalogue });
    const frame = worldFrame(layout.pitch);

    interface Expected {
      definitionId: string;
      tile: { x: number; y: number };
      modelId?: string;
      sizeWorld?: number;
    }

    const expected = new Map<string, Expected>();
    const counters = new Map<string, number>();
    for (const instance of world.scenery) {
      if (instance.detail) continue;
      const definitionId = DEFINITION_BY_KIND[instance.kind];
      if (definitionId === undefined) continue;
      const count = (counters.get(instance.kind) ?? 0) + 1;
      counters.set(instance.kind, count);
      const entry =
        instance.modelId === undefined
          ? environmentModelFor(instance.kind, instance.tier, instance.variantRoll)
          : undefined;
      const modelId = instance.modelId ?? entry?.id;
      if (modelId === undefined) continue;
      expected.set(`starter.${instance.kind}.${String(count).padStart(3, "0")}`, {
        definitionId,
        tile: {
          x: round(instance.worldX / frame.pitch + frame.originTileX),
          y: round(instance.worldZ / frame.pitch + frame.originTileY)
        },
        modelId,
        sizeWorld: round(instance.scale * (entry?.unitScale ?? 1))
      });
    }

    // Every procedural object the island grows is in the arrangement ...
    const committed = new Map(STARTER_WORLD_PLACEMENTS_V2.map((placement) => [placement.key, placement]));
    for (const [key, value] of expected) {
      const placement = committed.get(key);
      expect(placement, `${key} is grown but not seeded`).toBeDefined();
      expect(placement?.definitionId, key).toBe(value.definitionId);
      expect(placement?.tile, key).toEqual(value.tile);
      expect(placement?.modelId, key).toBe(value.modelId);
      expect(placement?.sizeWorld, key).toBe(value.sizeWorld);
    }
    // ... and the arrangement holds nothing the island no longer grows: a promoted object with no
    // generator instance behind it would be a tree the player sees that is not where the forest is.
    for (const key of committed.keys()) {
      if (!key.startsWith("starter.tree.") && !key.startsWith("starter.pine.") &&
          !key.startsWith("starter.bush.") && !key.startsWith("starter.rock.")) {
        continue;
      }
      expect(expected.has(key), `${key} is seeded but not grown`).toBe(true);
    }
  });

  it("carries the authored buildings and the set dressing exactly once each", () => {
    const keys = STARTER_WORLD_PLACEMENTS_V2.map((placement) => placement.key);
    expect(new Set(keys).size).toBe(keys.length);
    const buildings = STARTER_WORLD_PLACEMENTS_V2.filter((placement) => placement.key.startsWith("starter.building."));
    expect(buildings.map((placement) => placement.definitionId).sort()).toEqual([
      "world.barn",
      "world.coop",
      "world.farmhouse",
      "world.harbor",
      "world.market_stall",
      "world.open_barn",
      "world.silo",
      "world.storage_shed",
      "world.well"
    ]);
    // The village and the quay keep the facing the island authored them with, so a migration turns
    // nothing.
    for (const placement of STARTER_WORLD_PLACEMENTS_V2) {
      if (placement.baseYaw === undefined) continue;
      expect(Number.isFinite(placement.baseYaw), placement.key).toBe(true);
    }
  });

  it("covers every visible object the config used to draw, so nothing stands un-promoted", () => {
    // The other half of "no duplicate rendering": every building and every prop the renderer used to
    // draw from its config now has a row, so *stopping* those draws loses nothing. A landmark with no
    // placement would vanish from the island the moment the config stopped drawing it.
    const tiles = [];
    for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
      for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
    }
    const catalogue = [1, 2, 3, 4, 5].map((index) => plot(index, false));
    const land = landFrame(tiles, catalogue);
    const layout = layoutFarmTiles(tiles, land === null ? {} : { frame: land });
    const world = buildFarmWorld({ layout, tiles, plots: catalogue });
    const committed = new Map(STARTER_WORLD_PLACEMENTS_V2.map((placement) => [placement.key, placement]));

    for (const landmark of world.landmarks) {
      expect(committed.has(`starter.building.${landmark.id}`), landmark.id).toBe(true);
    }
    expect(committed.has("starter.building.barn")).toBe(true);
    // One placement per authored prop: the set dressing is the same list of barrels and crates, now
    // owned by rows rather than by the preset that authored it.
    const props = [...committed.keys()].filter((key) => key.startsWith("starter.prop."));
    expect(props).toHaveLength(world.compositions.props.length);
  });
});
