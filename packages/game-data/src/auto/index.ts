/**
 * The constants and the two interaction anchors online Auto needs.
 *
 * Auto must walk somewhere real: the Home Warehouse to load and unload, and the Farm Market to buy.
 * The island already has both buildings, so this module does not invent a place - it names the tiles
 * the actor stands on, *derived* from the starter layout's own placements so a moved barn moves its
 * anchor rather than leaving a stale constant behind.
 *
 * The walk speed and the tile pitch are here rather than in the client's renderer because the server
 * needs them too: travel time is `distance / speed`, and the server is the authority on when a walk
 * ends. `apps/web/src/player/controller.ts` and `apps/web/src/render/layout.ts` hold the same numbers
 * for the client's own simulation, and a test pins the two together so neither can drift silently.
 */

import { STARTER_WORLD_PLACEMENTS } from "../world/starter";

/** How fast the Main Character walks, in world metres per second. Mirrors the client's `PLAYER_SPEED`. */
export const AUTO_WALK_SPEED_WORLD_PER_SECOND = 2.6;

/** The world distance between two adjacent tile centres. Mirrors `tileSize + tileGap`. */
export const FARM_TILE_PITCH_WORLD = 1.08;

/** The starter placement whose building the Home Warehouse lives in. */
export const HOME_WAREHOUSE_BUILDING_KEY = "starter.building.barn";
/** The starter placement whose building the Farm Market lives in. */
export const FARM_MARKET_BUILDING_KEY = "starter.building.market_stall";

/**
 * Where the actor stands to use each building: the clear tile just outside its footprint.
 *
 * An offset rather than an absolute coordinate, so the anchor follows the building it belongs to. The
 * tiles are checked against every starter footprint and against the island's own ground in
 * `tests/game-data/auto-anchors.test.ts`.
 */
const WAREHOUSE_STAND_OFFSET = { x: 0, y: 4 };
const MARKET_STAND_OFFSET = { x: 0, y: 2 };

function buildingTile(key: string): { readonly x: number; readonly y: number } {
  const placement = STARTER_WORLD_PLACEMENTS.find((candidate) => candidate.key === key);
  if (placement === undefined) {
    // Game data is a module constant; a missing building is a broken deployment, not a player's fault.
    throw new Error(`Starter placement ${key} is missing`);
  }
  return { x: placement.tile.x, y: placement.tile.y };
}

function standTile(
  key: string,
  offset: { readonly x: number; readonly y: number }
): { readonly x: number; readonly y: number } {
  const building = buildingTile(key);
  return { x: Math.floor(building.x) + offset.x, y: Math.floor(building.y) + offset.y };
}

/** The tile the Main Character stands on to load from, or unload into, the Home Warehouse. */
export const HOME_WAREHOUSE_ANCHOR_TILE = standTile(HOME_WAREHOUSE_BUILDING_KEY, WAREHOUSE_STAND_OFFSET);

/** The tile the Main Character stands on to buy supplies at the Farm Market. */
export const FARM_MARKET_ANCHOR_TILE = standTile(FARM_MARKET_BUILDING_KEY, MARKET_STAND_OFFSET);
