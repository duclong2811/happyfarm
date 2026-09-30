import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFarmTile,
  createInitialFarmTiles,
  createOwnedFarm,
  INITIAL_LAND_SIZE,
  PLOT_TILE_COUNT,
  plotTileCoordinates
} from "@happy-farm/domain";
import type { PlotDTO } from "@happy-farm/contracts";
import { layoutFarmTiles } from "../../apps/web/src/render/layout";
import { buildFarmWorld, landFrame } from "../../apps/web/src/render/world";
import { FARM_FIELD_BOUNDS, VISUAL_BOUNDS } from "../../apps/web/src/render/world-config";
import { D1FarmRepository, D1FarmTileRepository } from "../../workers/api/src/d1-repositories";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, NOW, PLAYER_ONE_ID } from "../support/fixtures";

/**
 * How big the world may get without the database growing with it.
 *
 * The farm is now the size of a real field and the island around it is bigger still, but none of that
 * is stored. A tile row *is* unlocked land, so the only things that ever insert one are the farm
 * being created and a plot being bought - and the rendered world, which is the largest of the three,
 * cannot insert anything at all.
 */
const MIGRATIONS = readFileSync(
  fileURLToPath(new URL("../../database/migrations/0001_phase_1_foundation.sql", import.meta.url)),
  "utf8"
);

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

const CATALOGUE = [plot(1, false), plot(2, false), plot(3, false), plot(4, false), plot(5, false)];

function tileCount(db: NodeD1Database): number {
  const row = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles").get() as { count: number };
  return row.count;
}

describe("the world does not cost a row per tile it draws", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Player One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  it("creates rows for the starter square and nothing else", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(
      aggregate.farm,
      aggregate.ownerMembership,
      createInitialFarmTiles(FARM_ONE_ID, NOW)
    );

    expect(INITIAL_LAND_SIZE).toBe(12);
    expect(tileCount(db)).toBe(INITIAL_LAND_SIZE * INITIAL_LAND_SIZE);
    expect(tileCount(db)).toBe(144);
  });

  it("adds a plot's rows only when the plot is bought", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(
      aggregate.farm,
      aggregate.ownerMembership,
      createInitialFarmTiles(FARM_ONE_ID, NOW)
    );
    const tiles = new D1FarmTileRepository(db);

    // Land the renderer draws but the farm has not bought is not land, so it is not a row: creating
    // the farm writes the starter square and stops.
    expect(tileCount(db)).toBe(144);

    const plotTiles = plotTileCoordinates(1).map((coordinate) =>
      createFarmTile(FARM_ONE_ID, coordinate, "SOIL", NOW)
    );
    for (const tile of plotTiles) await tiles.insert(tile);

    expect(plotTiles).toHaveLength(PLOT_TILE_COUNT);
    expect(tileCount(db)).toBe(144 + PLOT_TILE_COUNT);
  });

  it("draws a world many times larger than the rows it needs, and draws it without writing", async () => {
    const aggregate = createOwnedFarm(FARM_ONE_ID, PLAYER_ONE_ID, "Starter Farm", NOW);
    await new D1FarmRepository(db).createWithOwner(
      aggregate.farm,
      aggregate.ownerMembership,
      createInitialFarmTiles(FARM_ONE_ID, NOW)
    );
    const rowsBefore = tileCount(db);

    const starter: { x: number; y: number }[] = [];
    for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
      for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) starter.push({ x, y });
    }
    const frame = landFrame(starter, CATALOGUE);
    const layout = layoutFarmTiles(starter, frame === null ? {} : { frame });
    const world = buildFarmWorld({ layout, tiles: starter, plots: CATALOGUE });

    const reservedTiles =
      (FARM_FIELD_BOUNDS.maxX - FARM_FIELD_BOUNDS.minX + 1) *
      (FARM_FIELD_BOUNDS.maxY - FARM_FIELD_BOUNDS.minY + 1);
    const islandTiles =
      (VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX + 1) * (VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY + 1);

    // The reserve is nine times the starter square and the island is more than twenty times it, but
    // the world model is a value: it has no rows, no repository, and no way to ask for one.
    expect(reservedTiles).toBe(9 * starter.length);
    expect(islandTiles).toBeGreaterThan(20 * starter.length);
    expect(Object.keys(world)).not.toContain("tiles");
    expect(world.lockedPlots.length).toBeGreaterThan(0);
    expect(world.scenery.length).toBeGreaterThan(80);
    // …and after all of that, the farm still owns exactly its starter square: building the world
    // wrote nothing at all.
    expect(rowsBefore).toBe(144);
    expect(tileCount(db)).toBe(rowsBefore);
  });
});
