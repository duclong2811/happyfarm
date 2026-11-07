import { cellKey, type WorldCellMap } from "./world-cell";
import type { TileCoordinate } from "./layout";

/**
 * Whether a catalogue entry could go on a cell, as a rule rather than as a renderer.
 *
 * The build shop asks one question before it draws anything: *would the server allow this here?* The
 * answer is not the server's yet - the placement command does not exist - but it must be the same
 * answer the command will give, or the preview teaches the player something false. So the rule is
 * written once, over the WorldCell map, and covers exactly what the cell already knows: the ground,
 * whose it is, what stands there, and whether the footprint fits on the island at all.
 *
 * Pure: no three, no DOM, no clock - so every reason a spot is refused can be asserted in a test.
 *
 * **Land use is not consulted.** There is no FARM, FORESTRY, BUILD or DECORATION requirement here any
 * more: a normal owned cell takes a normal asset, and the only ground question is the *physical* one
 * the asset itself declares - dry land, beach, the shallows. That is the whole of the freeform rule,
 * and it is the same rule the server applies.
 */

/** The ground an entry may stand on, as the catalogue declares it. */
export type PreviewGround = "LAND" | "SHORE" | "SHALLOW_WATER" | "WATER";

/**
 * Why a spot was refused, in the vocabulary a player is shown.
 *
 * Deliberately smaller than the server's list: a preview only has to explain itself, and each of
 * these maps to one translated sentence. The internal codes stay on the server, where they are useful.
 */
export type PreviewRejection =
  | "NO_CELL"
  | "OUT_OF_WORLD"
  | "BLOCKED"
  | "OCCUPIED"
  | "INVALID_TERRAIN";

export interface PreviewRequirement {
  /** The ground the entry may stand on. */
  readonly allowedTerrain: readonly PreviewGround[];
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  /** True for a catalogue entry that is itself a road: a road lies on cells a building may not use. */
  readonly isRoad: boolean;
  /**
   * Cells the check should treat as free, whatever stands on them.
   *
   * A move re-checks the ground around the object it is moving, and the object is not an obstacle to
   * itself; without this the preview would refuse every spot a building already covers, including the
   * one it is standing on. Every *other* occupant still counts.
   */
  readonly ignore?: readonly TileCoordinate[];
}

/**
 * The cells a footprint covers, centred on the selection.
 *
 * An odd footprint has a true centre; an even one cannot, so it is anchored with the *extra* cell on
 * the +x/+z side - the same choice the world's own tile mapping makes when it rounds to the nearest
 * centre, which keeps the preview and the eventual placement talking about the same cells.
 */
export function footprintCells(
  origin: TileCoordinate,
  footprint: { readonly widthCells: number; readonly depthCells: number }
): readonly TileCoordinate[] {
  const cells: TileCoordinate[] = [];
  const startX = origin.x - Math.floor((footprint.widthCells - 1) / 2);
  const startY = origin.y - Math.floor((footprint.depthCells - 1) / 2);
  for (let y = 0; y < footprint.depthCells; y += 1) {
    for (let x = 0; x < footprint.widthCells; x += 1) {
      cells.push({ x: startX + x, y: startY + y });
    }
  }
  return cells;
}

/**
 * Why this entry could not go on this cell, or null when it could.
 *
 * The order is the server's order, because the *reason* is part of the answer: ground the island
 * keeps, then what stands there, then the asset's own terrain. Ownership is deliberately absent
 * (V14.5.2): the natural Home Island is already the player's to develop, so it is never the reason.
 */
export function previewRejection(
  cells: WorldCellMap,
  origin: TileCoordinate | null,
  requirement: PreviewRequirement
): PreviewRejection | null {
  if (origin === null) return "NO_CELL";
  const ignored = new Set((requirement.ignore ?? []).map((cell) => cellKey(cell.x, cell.y)));
  for (const cell of footprintCells(origin, requirement.footprint)) {
    const world = cells.cells.get(cellKey(cell.x, cell.y));
    const self = ignored.has(cellKey(cell.x, cell.y));
    if (world === undefined) return "OUT_OF_WORLD";
    // Ground the island keeps, a building already standing there, or the island's authored road: all
    // three are "not yours to change", which is what BLOCKED means.
    if (world.reserved || world.terrain === "BLOCKED" || world.terrain === "VOLCANO") return "BLOCKED";
    if (!self && !requirement.isRoad && world.road !== null) return "BLOCKED";
    if (!self && world.occupancy !== "EMPTY") return "OCCUPIED";
    if (!terrainAllows(requirement.allowedTerrain, world)) return "INVALID_TERRAIN";
  }
  return null;
}

/** Whether an asset that asks for these grounds may stand on this cell. */
function terrainAllows(
  allowed: readonly PreviewGround[],
  cell: { readonly terrain: string; readonly shallowWater: boolean }
): boolean {
  switch (cell.terrain) {
    case "LAND":
      return allowed.includes("LAND");
    case "SHORE":
      return allowed.includes("SHORE");
    case "WATER":
      // A moored asset needs shallows it can be worked from; open water carries nothing today.
      return cell.shallowWater ? allowed.includes("SHALLOW_WATER") : allowed.includes("WATER");
    default:
      return false;
  }
}

/** A short human-readable reason, for the preview's status line. */
export function rejectionMessageKey(rejection: PreviewRejection): string {
  switch (rejection) {
    case "NO_CELL":
      return "build.reason.noCell";
    case "OUT_OF_WORLD":
      return "build.reason.outsideIsland";
    case "BLOCKED":
      return "build.reason.blocked";
    case "OCCUPIED":
      return "build.reason.occupied";
    case "INVALID_TERRAIN":
      return "build.reason.wrongGround";
  }
}
