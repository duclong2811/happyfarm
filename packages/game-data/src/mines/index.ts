import { islandCellKindAt, type IslandGroundCells } from "../world/island-ground";

/**
 * Island mines: deposits that fill with ore on their own and are emptied in one dig.
 *
 * Definitions only (agreed with the project owner on 2026-11-15): ten levels, each with its output,
 * the player level it needs and what reaching it costs; how many hours of output a mine can hold;
 * which player levels open each mine slot; and the experience a dig pays. A farm's mines - their
 * level and what they have banked - are server state in `farm_mines`.
 */

export const MINE_ORE_ITEM_ID = "item_ore";
export const MINE_WOOD_ITEM_ID = "item_wood";
export const MINE_GOLD_CURRENCY_ID = "currency_gold";

/** A mine holds this many hours of its own output; past that it stops filling until dug. */
export const MINE_ACCUMULATION_HOURS = 4;

/** Experience a dig pays: one point for every this-many ore collected (rounded down). */
export const MINE_ORE_PER_XP = 20;

export interface MineLevelData {
  readonly level: number;
  readonly orePerHour: number;
  /** The player level needed to *reach* this mine level. */
  readonly requiredPlayerLevel: number;
  /** What reaching this level costs; null for level 1, which every mine starts at. */
  readonly upgradeCost: { readonly gold: number; readonly wood: number; readonly ore: number } | null;
}

export const MINE_LEVELS: readonly MineLevelData[] = [
  { level: 1, orePerHour: 60, requiredPlayerLevel: 1, upgradeCost: null },
  { level: 2, orePerHour: 90, requiredPlayerLevel: 8, upgradeCost: { gold: 500, wood: 80, ore: 150 } },
  { level: 3, orePerHour: 130, requiredPlayerLevel: 15, upgradeCost: { gold: 1_000, wood: 160, ore: 300 } },
  { level: 4, orePerHour: 180, requiredPlayerLevel: 25, upgradeCost: { gold: 2_200, wood: 300, ore: 600 } },
  { level: 5, orePerHour: 240, requiredPlayerLevel: 35, upgradeCost: { gold: 4_700, wood: 600, ore: 1_200 } },
  { level: 6, orePerHour: 310, requiredPlayerLevel: 45, upgradeCost: { gold: 10_000, wood: 1_100, ore: 2_400 } },
  { level: 7, orePerHour: 390, requiredPlayerLevel: 55, upgradeCost: { gold: 21_000, wood: 2_200, ore: 4_900 } },
  { level: 8, orePerHour: 480, requiredPlayerLevel: 70, upgradeCost: { gold: 45_000, wood: 4_300, ore: 9_900 } },
  { level: 9, orePerHour: 580, requiredPlayerLevel: 85, upgradeCost: { gold: 95_000, wood: 8_300, ore: 20_000 } },
  { level: 10, orePerHour: 700, requiredPlayerLevel: 100, upgradeCost: { gold: 200_000, wood: 16_000, ore: 40_000 } }
];

/** The player levels that open each mine slot, in slot order. Metal (Kim) islands have six. */
export const MINE_SLOT_LEVELS: readonly number[] = [1, 20, 50];
export const METAL_ISLAND_MINE_SLOT_LEVELS: readonly number[] = [1, 10, 20, 35, 50, 70];

/**
 * Where the hand-composed island's mines stand: slot 1 is the ore ridge players already know, and
 * the other two are on the same volcano slope, each with every neighbouring cell minable.
 */
export const COMPOSED_ISLAND_MINE_POSITIONS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 12, y: -12 },
  { x: 18, y: -14 },
  { x: 6, y: -15 }
];

export function mineLevel(level: number): MineLevelData | null {
  return MINE_LEVELS.find((entry) => entry.level === level) ?? null;
}

/** The slot levels for an island element (`KIM` has more mines), or the default ladder. */
export function mineSlotLevels(element: string | null): readonly number[] {
  return element === "KIM" ? METAL_ISLAND_MINE_SLOT_LEVELS : MINE_SLOT_LEVELS;
}

/** How far apart two mines on a generated island stand, in tiles, when a slot has to be found. */
const ISLAND_MINE_SPACING = 4;
/** How far from the dock and the camp a found slot keeps, so it never crowds the island's front door. */
const ISLAND_MINE_SITE_CLEARANCE = 5;
/** The furthest a found slot is searched from the island's first ore site. */
const ISLAND_MINE_SEARCH_RADIUS = 24;

function solidGround(ground: IslandGroundCells, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const kind = islandCellKindAt(ground, { x: x + dx, y: y + dy });
      if (kind === "DEEP" || kind === "SHALLOW" || kind === "SAND") return false;
    }
  }
  return true;
}

/**
 * Where each mine slot stands on a generated island, in slot order.
 *
 * The island's own ORE sites come first - they were picked on rock (Kim) or open ground, with land
 * all round. An island with fewer ore sites than slots gets the rest from a fixed outward search
 * around its first ore site, on solid ground clear of the dock and the camp and of the mines already
 * placed. The search reads only the stored cells and sites, so the same island always answers the
 * same tiles, on the server and in the browser alike, and no generator change is needed.
 */
export function islandMineTiles(ground: IslandGroundCells, count: number): readonly { readonly x: number; readonly y: number }[] {
  const chosen: { x: number; y: number }[] = ground.sites
    .filter((site) => site.kind === "ORE")
    .slice(0, count)
    .map((site) => ({ x: site.x, y: site.y }));
  const anchor = chosen[0] ?? ground.sites.find((site) => site.kind === "CAMP") ?? null;
  if (anchor === null) return chosen;
  const avoid = ground.sites.filter((site) => site.kind === "DOCK" || site.kind === "CAMP");
  for (let radius = 1; radius <= ISLAND_MINE_SEARCH_RADIUS && chosen.length < count; radius += 1) {
    // One ring at a time, walked in a fixed order, so the answer never depends on iteration quirks.
    for (let dy = -radius; dy <= radius && chosen.length < count; dy += 1) {
      for (let dx = -radius; dx <= radius && chosen.length < count; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (!solidGround(ground, x, y)) continue;
        if (chosen.some((mine) => Math.hypot(mine.x - x, mine.y - y) < ISLAND_MINE_SPACING)) continue;
        if (avoid.some((site) => Math.hypot(site.x - x, site.y - y) < ISLAND_MINE_SITE_CLEARANCE)) continue;
        chosen.push({ x, y });
      }
    }
  }
  return chosen;
}

/**
 * How far a mine's yard reaches from its tile, in tiles (Chebyshev). The yard is the mine's: nothing
 * is planted or built in it, whether the slot is open yet or not, so a slot that opens later is never
 * found under someone's barn. Two tiles covers the widest, level-10 cluster.
 */
export const MINE_FOOTPRINT_RADIUS_TILES = 2;

/** Every tile in the yards of the given mine tiles. */
export function mineFootprintTiles(mines: readonly { readonly x: number; readonly y: number }[]): readonly { readonly x: number; readonly y: number }[] {
  const seen = new Set<string>();
  const tiles: { x: number; y: number }[] = [];
  for (const mine of mines) {
    for (let dy = -MINE_FOOTPRINT_RADIUS_TILES; dy <= MINE_FOOTPRINT_RADIUS_TILES; dy += 1) {
      for (let dx = -MINE_FOOTPRINT_RADIUS_TILES; dx <= MINE_FOOTPRINT_RADIUS_TILES; dx += 1) {
        const tile = { x: mine.x + dx, y: mine.y + dy };
        const key = `${String(tile.x)},${String(tile.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push(tile);
      }
    }
  }
  return tiles;
}

/** Whether a tile is in any mine's yard. */
export function inMineFootprint(mines: readonly { readonly x: number; readonly y: number }[], tile: { readonly x: number; readonly y: number }): boolean {
  return mines.some((mine) => Math.max(Math.abs(mine.x - tile.x), Math.abs(mine.y - tile.y)) <= MINE_FOOTPRINT_RADIUS_TILES);
}
