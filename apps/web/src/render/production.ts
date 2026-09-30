import type { TileBounds, TileCoordinate } from "./layout";
import { DISTRICTS, FARM_FIELD_BOUNDS, type DistrictKind } from "./world-config";

/**
 * The land a production district offers, as cells.
 *
 * The island's districts say what a piece of ground is *for*; this says what can be worked on it.
 * They are different questions, and keeping them apart is what stops the game from having one
 * universal square grid: a crop cell is an authoritative farm tile, an orchard cell is a planting
 * position on a row, and an aquaculture cell is a basin in the fishery - three shapes, three rules,
 * one vocabulary.
 *
 * Nothing here is gameplay. No cell is planted, harvested, bought, or persisted; a cell is a place a
 * future system *may* use, and the world model already knows where those places are. The reason to
 * write it down now is that the alternative - every production system inventing its own coordinates
 * later - is how a world ends up with three overlapping ideas of where the orchard is.
 */

export type ProductionCellType = "CROP" | "ORCHARD" | "AQUACULTURE";

/** A cell type that has a district reserved for it but no system yet. */
export type FutureProductionCellType = "LIVESTOCK" | "FORESTRY" | "PROCESSING";

/**
 * A zone of usable production land: the cells of one type inside one district.
 *
 * `origin` and `pitch` are in tile coordinates because two of the three cell types are laid out on the
 * ground the server already talks about; a cell's own square is `pitch` tiles across, which is what
 * makes a crop cell *exactly* an authoritative tile rather than something near it.
 */
export interface ProductionZone {
  readonly id: string;
  readonly district: DistrictKind;
  readonly cellType: ProductionCellType | FutureProductionCellType;
  readonly pitch: number;
  readonly cells: readonly TileCoordinate[];
}

/** The district each cell type is allowed to live in. A cell outside its own district is a bug. */
const DISTRICT_BY_CELL: Readonly<Record<ProductionCellType, DistrictKind>> = {
  CROP: "CROPLAND",
  ORCHARD: "ORCHARD",
  AQUACULTURE: "COAST"
};

export interface ProductionInput {
  /** The land the farm actually owns, from the server. Crop cells may only be drawn on it. */
  readonly ownedTiles: readonly TileCoordinate[];
  /** The tile area the catalogue can sell, which bounds every crop cell the island will ever have. */
  readonly fieldBounds?: TileBounds;
}

/**
 * The island's production zones.
 *
 * Deterministic and pure: the same farm state produces the same cells, in the same order, so a cell
 * can be referred to by index without a test having to pin a coordinate that art direction will
 * later move.
 */
export function buildProductionZones(input: ProductionInput): readonly ProductionZone[] {
  const bounds = input.fieldBounds ?? FARM_FIELD_BOUNDS;

  // Crop cells are the authoritative tiles themselves, and only the ones the farm owns: the game
  // already knows a tile is plantable, and this layer must not invent a second opinion about it.
  const crop: TileCoordinate[] = [];
  for (const tile of input.ownedTiles) {
    if (tile.x < bounds.minX || tile.x > bounds.maxX) continue;
    if (tile.y < bounds.minY || tile.y > bounds.maxY) continue;
    crop.push({ x: tile.x, y: tile.y });
  }
  crop.sort((left, right) => left.y - right.y || left.x - right.x);

  // Orchard cells are planting positions on the orchard's own lattice: the rows the world model
  // already draws trees on, so a future orchard system places its trees where the trees already look
  // like they belong.
  const orchard: TileCoordinate[] = [];
  const orchardDistrict = districtOfKind("ORCHARD");
  if (orchardDistrict !== null) {
    // The lattice is the district's *own*: its row spacing, its radii, its rotation. A second, hand-
    // written lattice here is how a future orchard system ends up planting somewhere the orchard is
    // not - which is exactly what the first version of this did when the orchard was re-laid.
    const spacing = orchardDistrict.rowSpacingTiles ?? 4;
    const columnSpacing = spacing * 0.42;
    for (let row = -orchardDistrict.radiusY; row <= orchardDistrict.radiusY; row += spacing) {
      for (let column = -orchardDistrict.radiusX; column <= orchardDistrict.radiusX; column += columnSpacing) {
        // The lattice is clipped to the district's own outline, so a row can never run out of the
        // orchard and into the field beside it.
        const normalised = Math.hypot(column / orchardDistrict.radiusX, row / orchardDistrict.radiusY);
        if (normalised > 0.88) continue;
        const cos = Math.cos(orchardDistrict.rotationY);
        const sin = Math.sin(orchardDistrict.rotationY);
        orchard.push({
          x: orchardDistrict.center.x + column * cos - row * sin,
          y: orchardDistrict.center.y + column * sin + row * cos
        });
      }
    }
  }

  // Aquaculture cells are basins along the fishery's coast, on a coarser lattice than a field: a pen
  // is a structure, not a tile.
  const aquaculture: TileCoordinate[] = [];
  const coast = districtOfKind("COAST");
  if (coast !== null) {
    for (let row = -4; row <= 4; row += 5) {
      for (let column = -6; column <= 6; column += 5) {
        const normalised = Math.hypot(column / coast.radiusX, row / coast.radiusY);
        if (normalised > 0.85) continue;
        aquaculture.push({ x: coast.center.x + column, y: coast.center.y + row });
      }
    }
  }

  return [
    { id: "cropland.cells", district: "CROPLAND", cellType: "CROP", pitch: 1, cells: crop },
    { id: "orchard.rows", district: "ORCHARD", cellType: "ORCHARD", pitch: 4.2, cells: orchard },
    { id: "fishery.basins", district: "COAST", cellType: "AQUACULTURE", pitch: 5, cells: aquaculture }
  ];
}

/** The district each zone claims, so a caller can check a cell belongs where it says it does. */
export function districtForCellType(cellType: ProductionCellType): DistrictKind {
  return DISTRICT_BY_CELL[cellType];
}

/** The district of a kind, read from the plan rather than repeated here as a coordinate. */
function districtOfKind(kind: DistrictKind): (typeof DISTRICTS)[number] | null {
  return DISTRICTS.find((district) => district.kind === kind) ?? null;
}
