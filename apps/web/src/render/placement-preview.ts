import { cellKey, type CellCapability, type WorldCellMap } from "./world-cell";
import type { TileCoordinate } from "./layout";

/**
 * Whether a catalogue entry could go on a cell, as a rule rather than as a renderer.
 *
 * The build shop asks one question before it draws anything: *would the server allow this here?* The
 * answer is not the server's yet - the placement command does not exist - but it must be the same
 * answer the command will give, or the preview teaches the player something false. So the rule is
 * written once, over the WorldCell map, and covers exactly what the cell already knows: the ground,
 * the capability, what stands there, and whether the footprint fits on the island at all.
 *
 * Pure: no three, no DOM, no clock - so every reason a spot is refused can be asserted in a test.
 */

export type PreviewRejection =
  | "NO_CELL"
  | "OUTSIDE_ISLAND"
  | "NOT_WALKABLE_GROUND"
  | "NEEDS_CAPABILITY"
  | "OCCUPIED"
  | "RESERVED";

export interface PreviewRequirement {
  /** What the cell has to be able to do. */
  readonly capability: CellCapability;
  readonly footprint: { readonly widthCells: number; readonly depthCells: number };
  /** True for a catalogue entry that is itself a road: a road lies on cells a building may not use. */
  readonly isRoad: boolean;
  /** True when the entry may only go on land the player owns. */
  readonly requiresOwnership: boolean;
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

/** Why this entry could not go on this cell, or null when it could. */
export function previewRejection(
  cells: WorldCellMap,
  origin: TileCoordinate | null,
  requirement: PreviewRequirement
): PreviewRejection | null {
  if (origin === null) return "NO_CELL";
  for (const cell of footprintCells(origin, requirement.footprint)) {
    const world = cells.cells.get(cellKey(cell.x, cell.y));
    if (world === undefined) return "OUTSIDE_ISLAND";
    if (world.terrain === "BLOCKED" || world.occupancy === "BUILDING") return "OCCUPIED";
    if (world.terrain === "WATER" || world.terrain === "VOLCANO") {
      // A cage may sit in water; nothing else may leave dry land.
      if (!(requirement.capability === "AQUACULTURE" && world.terrain === "WATER")) {
        return "NOT_WALKABLE_GROUND";
      }
    }
    if (!world.capabilities.includes(requirement.capability)) return "NEEDS_CAPABILITY";
    // A road lies on ground a building may not: it is the one thing that *changes* the cell it is on.
    if (!requirement.isRoad && !world.buildable) {
      return world.road !== null ? "RESERVED" : "NEEDS_CAPABILITY";
    }
    if (requirement.requiresOwnership && world.legacyFarmTile === null) return "RESERVED";
  }
  return null;
}

/** A short human-readable reason, for the preview's status line. */
export function rejectionMessageKey(rejection: PreviewRejection): string {
  switch (rejection) {
    case "NO_CELL":
      return "build.reason.noCell";
    case "OUTSIDE_ISLAND":
      return "build.reason.outsideIsland";
    case "NOT_WALKABLE_GROUND":
      return "build.reason.wrongGround";
    case "NEEDS_CAPABILITY":
      return "build.reason.unsuitable";
    case "OCCUPIED":
      return "build.reason.occupied";
    case "RESERVED":
      return "build.reason.reserved";
  }
}
