/**
 * A chosen Home Island's ground, as the server stores it and every placement rule reads it.
 *
 * A player picks an element, an outline and a seed once, when the farm is created. The server runs
 * the generator *once*, then stores the result - one character per cell, plus the sites - so the
 * island a player builds on never moves under them: not when the generator is tuned, and not because
 * two JavaScript engines round a sine differently. The browser draws the stored ground it is sent,
 * never its own re-run, which is what keeps the drawn island and the checked one identical.
 *
 * Farms created before island choice keep the hand-composed island in `geography.ts`; this module is
 * only ever asked about a farm that has a stored island.
 */

import {
  type GeneratedIsland,
  type IslandCellKind,
  type IslandElement,
  type IslandOutline,
  type IslandSiteKind
} from "./island-generator";
import { generateIslandV2 } from "./island-generator-v2";
import type { TileClassification, WorkAreaGroundCapability } from "./geography";
import type { TileCoordinate } from "./tiles";

/**
 * The generator new farms are built with. Bumped whenever the generator would produce a different island
 * for the same template. v1 (`generateIsland`) stays in the code, frozen, so its output is still
 * reproducible; stored v1 islands never need it, because the ground is stored.
 */
export const ISLAND_GENERATOR_VERSION = 2;

/**
 * The current generator: what a new farm is built with, and what the picker previews - the same
 * function on both sides, so the island chosen is the island stored.
 */
export function generateHomeIsland(element: IslandElement, seed: number, size: number, outline: IslandOutline): GeneratedIsland {
  return generateIslandV2(element, seed, size, outline);
}

/** Cells along one side of a generated Home Island. One cell is one farm tile. */
export const HOME_ISLAND_GRID_SIZE = 96;

/**
 * The farm tile that generated cell `(0, 0)` sits on.
 *
 * Centres the grid on the centre of the old island's visual bounds (tile 18,18), so the camera, the
 * sea and the neighbour islands keep their places whichever island a farm has.
 */
export const HOME_ISLAND_GRID_ORIGIN = { x: -30, y: -30 } as const;

/** Tiles around the dock that stay clear, so the pier is never built over or moored across. */
export const ISLAND_DOCK_CLEARANCE_TILES = 3;

/** The largest seed a template may carry; the generator reads it as an unsigned 32-bit value. */
export const ISLAND_SEED_MAX = 2_147_483_647;

const CELL_CODES: Readonly<Record<IslandCellKind, string>> = {
  DEEP: "d",
  SHALLOW: "w",
  SAND: "s",
  GRASS: "g",
  FOREST: "f",
  ROCK: "r",
  MEADOW: "m",
  FIELD: "l"
};

const CODE_KINDS: Readonly<Record<string, IslandCellKind>> = Object.fromEntries(
  Object.entries(CELL_CODES).map(([kind, code]) => [code, kind as IslandCellKind])
);

/** What a player chose. Everything else about the island follows from it. */
export interface IslandTemplate {
  readonly element: IslandElement;
  readonly outline: IslandOutline;
  readonly seed: number;
}

/** A site in farm tile coordinates. */
export interface IslandGroundSite {
  readonly kind: IslandSiteKind;
  readonly x: number;
  readonly y: number;
}

/** The part of a stored island the ground rules read: the grid and the sites, nothing else. */
export interface IslandGroundCells {
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
  readonly cells: string;
  readonly sites: readonly { readonly kind: string; readonly x: number; readonly y: number }[];
}

/** The stored island: the template it came from and the ground it produced. */
export interface IslandGround extends IslandTemplate {
  readonly generatorVersion: number;
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
  /** Row-major, one code per cell (see `islandCellCode`). */
  readonly cells: string;
  readonly sites: readonly IslandGroundSite[];
  /** Bumped when the ground itself changes, e.g. by future sea reclamation. */
  readonly revision: number;
}

export function islandCellCode(kind: IslandCellKind): string {
  return CELL_CODES[kind];
}

export function isIslandCellCode(code: string): boolean {
  return code.length === 1 && CODE_KINDS[code] !== undefined;
}

/** Whether a stored cell string is well formed for a grid of `size`. */
export function isValidIslandCells(cells: string, size: number): boolean {
  if (cells.length !== size * size) return false;
  for (const code of cells) if (CODE_KINDS[code] === undefined) return false;
  return true;
}

/** Generates a template's island and lays it on the farm's tiles. The one way a ground is made. */
export function buildIslandGround(template: IslandTemplate): IslandGround {
  const island = generateHomeIsland(template.element, template.seed, HOME_ISLAND_GRID_SIZE, template.outline);
  return {
    element: template.element,
    outline: template.outline,
    seed: template.seed,
    generatorVersion: ISLAND_GENERATOR_VERSION,
    size: island.size,
    originX: HOME_ISLAND_GRID_ORIGIN.x,
    originY: HOME_ISLAND_GRID_ORIGIN.y,
    cells: island.cells.map(islandCellCode).join(""),
    sites: island.sites.map((site) => ({
      kind: site.kind,
      x: site.x + HOME_ISLAND_GRID_ORIGIN.x,
      y: site.y + HOME_ISLAND_GRID_ORIGIN.y
    })),
    revision: 1
  };
}

/** The cell kind under a farm tile. Anything off the grid is open sea. */
export function islandCellKindAt(ground: Pick<IslandGroundCells, "size" | "originX" | "originY" | "cells">, tile: TileCoordinate): IslandCellKind {
  const x = tile.x - ground.originX;
  const y = tile.y - ground.originY;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= ground.size || y >= ground.size) return "DEEP";
  return CODE_KINDS[ground.cells.charAt(y * ground.size + x)] ?? "DEEP";
}

function nearDock(ground: Pick<IslandGroundCells, "sites">, tile: TileCoordinate): boolean {
  return ground.sites.some(
    (site) => site.kind === "DOCK" && Math.hypot(site.x - tile.x, site.y - tile.y) <= ISLAND_DOCK_CLEARANCE_TILES
  );
}

/**
 * What a tile physically is on a generated island, in the vocabulary `classifyTile` speaks.
 *
 * Sand is the beach, shallows are the workable shelf, open sea is water, and rock is ground nobody
 * builds or plants on (`BLOCKED`) - it is where ore is cut. The water and beach around the dock are
 * protected, like the old harbour's approach.
 */
export function classifyIslandTile(ground: IslandGroundCells, tile: TileCoordinate): TileClassification {
  const kind = islandCellKindAt(ground, tile);
  const protectedGround = nearDock(ground, tile);
  switch (kind) {
    case "DEEP":
      return { terrain: "WATER", shallowWater: false, protectedGround, insideIsland: false };
    case "SHALLOW":
      return { terrain: "WATER", shallowWater: !protectedGround, protectedGround, insideIsland: false };
    case "SAND":
      return { terrain: "SHORE", shallowWater: false, protectedGround, insideIsland: true };
    case "ROCK":
      return { terrain: "BLOCKED", shallowWater: false, protectedGround, insideIsland: true };
    case "GRASS":
    case "FOREST":
    case "MEADOW":
    case "FIELD":
      return { terrain: "LAND", shallowWater: false, protectedGround, insideIsland: true };
  }
}

/** What a tile of a generated island can be worked for. Mirrors `groundCapabilities`. */
export function islandGroundCapabilities(ground: IslandGroundCells, tile: TileCoordinate): readonly WorkAreaGroundCapability[] {
  const classification = classifyIslandTile(ground, tile);
  if (classification.protectedGround) return classification.terrain === "WATER" ? ["FISHERY"] : [];
  switch (islandCellKindAt(ground, tile)) {
    case "ROCK":
      return ["MINING"];
    case "FOREST":
      return ["FORESTRY"];
    case "GRASS":
    case "MEADOW":
    case "FIELD":
      return ["FARM", "FORESTRY", "LIVESTOCK"];
    case "SHALLOW":
      return ["FISHERY", "AQUACULTURE"];
    case "DEEP":
      return ["FISHERY"];
    case "SAND":
      return [];
  }
}
