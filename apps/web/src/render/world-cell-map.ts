import { worldFrame, type FarmLayout, type TileBounds, type TileCoordinate, type WorldFrame } from "./layout";
import { islandRadiusAt, volcanoZoneAt } from "./terrain-height";
import type { TerrainShape } from "./terrain-height";
import {
  COMPOSITION_PRESETS,
  DISTRICTS,
  FARM_FIELD_BOUNDS,
  FARMSTEAD,
  HARBOUR,
  LANDMARKS_WORLD,
  isWaterTile,
  TERRAIN_SHAPE,
  type DistrictKind
} from "./world-config";
import { RESERVED_BUILDINGS } from "./buildings";
import {
  cellCapabilitiesFor,
  cellKey,
  productionCapabilityFor,
  type CellOccupancy,
  type CellCapability,
  type CellTerrain,
  type CellZone,
  type WorldCell,
  type WorldCellMap
} from "./world-cell";

/**
 * The island, cell by cell.
 *
 * One pass classifies every cell on the island: what the ground is, what it is for, what is standing
 * on it, whether a character may walk into it, whether anything may be built on it, and what it could
 * one day produce. Everything downstream - selection, movement destinations, the action resolver,
 * building placement, the debug overlay - reads this map rather than asking its own question about
 * the world.
 *
 * Two rules keep it honest:
 *
 * * **The coast is the coast.** Terrain is classified with the same `islandRadiusAt` the terrain mesh,
 *   the beach, and the player's collision use, so a cell cannot be called land and be drawn in the
 *   sea. A rectangular bound is never evidence of land.
 * * **The map is a projection, not a second world.** It is derived from the world config, the server's
 *   land, the built scenery and the road network. Nothing here is authored twice, and nothing here is
 *   authority: the server still decides what may be planted, and this decides what the client may
 *   *ask* about.
 */

/** How far past the shoreline the map still generates cells: enough for a beach and a mooring. */
export const WATER_MARGIN_CELLS = 0.16;
/** How far inland from the waterline the beach band reaches, in shore units. */
const SHORE_BAND = 0.955;
/**
 * How far offshore a cell still counts as shallow water, in shore units.
 *
 * A fish cage needs shallows it can be moored in and worked from, so "the sea may carry aquaculture"
 * is a fact about depth rather than a rectangle somebody drew around one bay. The band is about three
 * tiles wide on this island: enough to be a real shelf, narrow enough that the open sea stays open.
 */
const SHALLOW_WATER_BAND = 0.06;
/**
 * How much water around the harbour is kept clear of anything a player places, in tiles.
 *
 * The pier, the moorings and the approach to them are navigation, not farmland: a fish cage moored
 * across the quay would block the one piece of the island that exists to be sailed into. This is the
 * spatial rule the brief asks for, and it is a *rule* rather than a picture - the cell map simply
 * declines to offer aquaculture capability inside it.
 */
const HARBOUR_CLEARANCE_TILES = 9;
/** How close a scenery instance must be to a cell's centre to count as standing on it, in cells. */
const SCENERY_OCCUPANCY_RADIUS_CELLS = 0.5;

/** Whether a cell is inside the harbour's own water, which nothing may be placed in. */
function insideHarbourWater(tile: TileCoordinate): boolean {
  return (
    Math.hypot(tile.x - HARBOUR.root.x, tile.y - HARBOUR.root.y) < HARBOUR_CLEARANCE_TILES ||
    Math.hypot(tile.x - HARBOUR.yard.x, tile.y - HARBOUR.yard.y) < HARBOUR_CLEARANCE_TILES
  );
}

/**
 * The zone a place the island owns maps to.
 *
 * Exactly one of the two produces anything: the village is civic ground, which is why a crop cannot
 * grow on the square. The harbour's coast is zone `NONE` - it is protected by water and shore rules,
 * not by a land-use zone. Everything else on the island is ordinary `NONE` land whose capability
 * comes from the ground, and there is no district left anywhere that could claim otherwise.
 */
const ZONE_BY_DISTRICT: Readonly<Record<DistrictKind, CellZone>> = {
  SETTLEMENT: "CIVIC",
  COAST: "NONE"
};

export interface CellScenerySource {
  readonly kind: string;
  readonly worldX: number;
  readonly worldZ: number;
}

export interface WorldCellMapInput {
  readonly layout: FarmLayout;
  /** The land the server says the farm owns. */
  readonly tiles: readonly TileCoordinate[];
  /** Cells the farm's own rows occupy: a crop or a tree standing on an owned tile. */
  readonly plantedTiles: readonly TileCoordinate[];
  readonly scenery: readonly CellScenerySource[];
  /** The road network's samples, as the renderer draws them. */
  readonly roads: readonly {
    readonly id: string;
    readonly widthWorld: number;
    readonly samples: readonly { readonly worldX: number; readonly worldZ: number }[];
  }[];
}

/** Whether a scenery kind is big enough to count as standing on a cell. A flower is not. */
export function sceneryOccupiesCell(kind: string): boolean {
  return kind === "tree" || kind === "pine" || kind === "rock" || kind === "prop";
}

/** The district whose blob owns a cell, or null on open landscape. Pure, for tests. */
function zoneAt(tile: TileCoordinate): CellZone {
  let best: CellZone | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const district of DISTRICTS) {
    const dx = tile.x - district.center.x;
    const dy = tile.y - district.center.y;
    const cos = Math.cos(-district.rotationY);
    const sin = Math.sin(-district.rotationY);
    const localX = (dx * cos - dy * sin) / district.radiusX;
    const localZ = (dx * sin + dy * cos) / district.radiusY;
    const distance = Math.hypot(localX, localZ);
    if (distance <= 1 && distance < bestDistance) {
      best = ZONE_BY_DISTRICT[district.kind];
      bestDistance = distance;
    }
  }
  return best ?? "NONE";
}

/**
 * The terrain of one cell, from the island's own outline.
 *
 * `islandRadiusAt` is the authority: below the shore band is land, the band itself is beach, and past
 * the waterline is water. The lake is water too, and a building's footprint is blocked ground.
 *
 * Water is decided *before* the volcano, and the order matters: the volcano's northern flank runs
 * into the sea, and a rule that asked "is this inside the mountain?" first would call open water
 * mountain and make it walkable. The mountain stops at the shoreline like everything else.
 */
export function classifyTerrain(
  tile: TileCoordinate,
  frame: WorldFrame,
  position: { readonly worldX: number; readonly worldZ: number },
  buildingCells: ReadonlySet<string>,
  island: TerrainShape = TERRAIN_SHAPE
): CellTerrain {
  if (buildingCells.has(cellKey(tile.x, tile.y))) return "BLOCKED";
  if (isWaterTile(tile)) return "WATER";
  const radius = islandRadiusAt(position.worldX, position.worldZ, island);
  if (radius > 1) return "WATER";
  const volcano = island.volcano;
  if (volcano !== undefined && volcanoZoneAt(position.worldX, position.worldZ, volcano) !== null) {
    return "VOLCANO";
  }
  if (radius > SHORE_BAND) return "SHORE";
  return "LAND";
}

/**
 * Every cell a building stands on.
 *
 * Derived from the buildings the world config declares - their tile, their footprint and their
 * rotation - rather than maintained as a second hand-written map. A cell whose centre falls inside a
 * footprint is occupied; the town's square and the roads between them stay open.
 */
export function buildingCells(frame: WorldFrame): { readonly occupied: Set<string>; readonly reserved: Set<string> } {
  const occupied = new Set<string>();
  const reserved = new Set<string>();

  function mark(target: Set<string>, tile: TileCoordinate, halfWidthWorld: number, halfDepthWorld: number, rotationY: number): void {
    const spanX = Math.ceil((Math.abs(halfWidthWorld * Math.cos(rotationY)) + Math.abs(halfDepthWorld * Math.sin(rotationY))) / frame.pitch) + 1;
    const spanZ = Math.ceil((Math.abs(halfWidthWorld * Math.sin(rotationY)) + Math.abs(halfDepthWorld * Math.cos(rotationY))) / frame.pitch) + 1;
    for (let dz = -spanZ; dz <= spanZ; dz += 1) {
      for (let dx = -spanX; dx <= spanX; dx += 1) {
        const cell = { x: tile.x + dx, y: tile.y + dz };
        const world = { worldX: (cell.x - frame.originTileX) * frame.pitch, worldZ: (cell.y - frame.originTileY) * frame.pitch };
        const local = { x: world.worldX - (tile.x - frame.originTileX) * frame.pitch, z: world.worldZ - (tile.y - frame.originTileY) * frame.pitch };
        const cos = Math.cos(-rotationY);
        const sin = Math.sin(-rotationY);
        const rotatedX = local.x * cos - local.z * sin;
        const rotatedZ = local.x * sin + local.z * cos;
        if (Math.abs(rotatedX) <= halfWidthWorld && Math.abs(rotatedZ) <= halfDepthWorld) {
          target.add(cellKey(cell.x, cell.y));
        }
      }
    }
  }

  for (const landmark of LANDMARKS_WORLD) {
    // A landmark's own collision circle is the ground it takes: a little wider than its walls, which
    // is exactly the margin a walker needs to go around it.
    mark(occupied, landmark.tile, landmark.blockingRadiusWorld, landmark.blockingRadiusWorld, landmark.rotationY);
  }
  // The barn is the one structure that is not a landmark: the world draws it from `FARMSTEAD`, and it
  // is as solid as anything the landmark list holds.
  mark(occupied, FARMSTEAD.center, 2.2, 2.2, FARMSTEAD.rotationY);
  // Reserved ground is *held*, not built: it is not walkable-blocked (there is nothing there yet)
  // but nothing else may be placed on it either. Marking it separately is what lets the map say both.
  for (const plot of RESERVED_BUILDINGS) {
    mark(reserved, plot.tile, plot.footprint.halfWidthWorld, plot.footprint.halfDepthWorld, plot.rotationY);
  }
  return { occupied, reserved };
}

/**
 * Builds the island's cell map.
 *
 * Pure and deterministic: the same inputs produce the same map, cell for cell. Cells beyond the
 * shoreline margin are not generated at all, so "off the island" is an absent cell rather than a
 * cell with a hopeful classification.
 */
export function buildWorldCellMap(input: WorldCellMapInput, island: TerrainShape): WorldCellMap {
  const frame = worldFrame(input.layout.pitch);
  const buildings = buildingCells(frame);
  const planted = new Set(input.plantedTiles.map((tile) => cellKey(tile.x, tile.y)));
  const compositionClearings = COMPOSITION_PRESETS.map((preset) => ({
    x: preset.anchor.x,
    y: preset.anchor.y,
    r: preset.clearanceTiles
  }));

  // The road cells: the cell each sample falls in, which is what "this cell carries a road" means.
  const roadByCell = new Map<string, string>();
  for (const road of input.roads) {
    for (const sample of road.samples) {
      const cell = {
        x: Math.floor(sample.worldX / frame.pitch + frame.originTileX + 0.5),
        z: Math.floor(sample.worldZ / frame.pitch + frame.originTileY + 0.5)
      };
      roadByCell.set(cellKey(cell.x, cell.z), road.id);
    }
  }

  // Scenery that stands on a cell, bucketed once so the per-cell pass is a lookup rather than a scan.
  const sceneryByCell = new Map<string, string>();
  for (const entry of input.scenery) {
    if (!sceneryOccupiesCell(entry.kind)) continue;
    const cell = {
      x: Math.floor(entry.worldX / frame.pitch + frame.originTileX + 0.5),
      z: Math.floor(entry.worldZ / frame.pitch + frame.originTileY + 0.5)
    };
    const centre = {
      worldX: (cell.x - frame.originTileX) * frame.pitch,
      worldZ: (cell.z - frame.originTileY) * frame.pitch
    };
    const distance = Math.hypot(entry.worldX - centre.worldX, entry.worldZ - centre.worldZ) / frame.pitch;
    if (distance <= SCENERY_OCCUPANCY_RADIUS_CELLS) sceneryByCell.set(cellKey(cell.x, cell.z), entry.kind);
  }

  const halfExtentTiles = Math.ceil(island.halfWidthWorld / frame.pitch) + 3;
  const centerTileX = Math.round(island.centerWorldX / frame.pitch + frame.originTileX);
  const centerTileZ = Math.round(island.centerWorldZ / frame.pitch + frame.originTileY);
  const bounds: TileBounds = {
    minX: centerTileX - halfExtentTiles,
    maxX: centerTileX + halfExtentTiles,
    minY: centerTileZ - halfExtentTiles,
    maxY: centerTileZ + halfExtentTiles
  };

  const cells = new Map<string, WorldCell>();
  const productionCells: Record<Exclude<WorldCell["productionCapability"], "NONE">, TileCoordinate[]> = {
    CROP: [],
    AQUACULTURE: [],
    TIMBER: [],
    MINING: []
  };
  const walkableCells: TileCoordinate[] = [];

  for (let z = bounds.minY; z <= bounds.maxY; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const position = {
        worldX: (x - frame.originTileX) * frame.pitch,
        worldZ: (z - frame.originTileY) * frame.pitch
      };
      const radius = islandRadiusAt(position.worldX, position.worldZ, island);
      // Off the island and past the margin: the cell does not exist. Selecting the open sea is
      // therefore a rejection rather than a cell with a hopeful terrain.
      if (radius > 1 + WATER_MARGIN_CELLS) continue;

      const tile = { x, y: z };
      const terrain = classifyTerrain(tile, frame, position, buildings.occupied, island);
      const baseZone = zoneAt(tile);
      const key = cellKey(x, z);
      const inReserve =
        x >= FARM_FIELD_BOUNDS.minX && x <= FARM_FIELD_BOUNDS.maxX && z >= FARM_FIELD_BOUNDS.minY && z <= FARM_FIELD_BOUNDS.maxY;

      // Land use, most specific first. Three things the *island* decides, and nothing else: which band
      // of the volcano a cell is in, whether a water cell is shallow enough to be worked, and the
      // village square. There is no authored production area left - no crop blob, no orchard, no
      // pasture, no planned fishery - because those were the island deciding what the player would
      // build.
      let zone: CellZone = baseZone;
      const volcanoZone =
        island.volcano === undefined || terrain !== "VOLCANO"
          ? null
          : volcanoZoneAt(position.worldX, position.worldZ, island.volcano);
      if (volcanoZone !== null) {
        zone =
          volcanoZone === "CORE"
            ? "VOLCANO_CORE"
            : volcanoZone === "SLOPE"
              ? "VOLCANO_SLOPE"
              : "VOLCANO_FOOTHILL";
      } else if (
        terrain === "WATER" &&
        radius > 1 &&
        radius <= 1 + SHALLOW_WATER_BAND &&
        !insideHarbourWater(tile)
      ) {
        // The shelf just outside the waterline: the water a cage can actually be moored in. Deeper
        // water keeps its own answer, which is that nothing may be built there - and the harbour's own
        // water is excluded, because a fish cage moored across the pier is a cage nobody can sail past.
        zone = "AQUACULTURE";
      }

      const road = roadByCell.get(key) ?? null;
      const reserved = buildings.reserved.has(key);
      const plantedHere = planted.has(key);
      const sceneryKind = sceneryByCell.get(key);
      const occupancy: CellOccupancy =
        terrain === "BLOCKED" ? "BUILDING" : plantedHere ? "PRODUCTION" : sceneryKind === undefined ? "EMPTY" : "SCENERY";

      // What the ground may be used for, which is a question about the ground and not about the
      // district drawn over it, the reservation, or what happens to stand there now. A cell blocked by
      // a building answers for itself inside `cellCapabilitiesFor`.
      const capabilities: readonly CellCapability[] = cellCapabilitiesFor(terrain, zone);
      // A cell is walkable when the ground itself says so. Buildings and the lake do not, nor does a
      // crater; a beach and the volcano's flanks do. Scenery never blocks, because a flower or a bush
      // must not make walking annoying - and a tree's trunk is already a collision circle.
      const walkable = capabilities.includes("WALK");
      // The capability the land-use rule allows, narrowed to the land the server can actually grant:
      // advertising a crop on ground the plot catalogue cannot sell would be a lie the client tells
      // the player and the server then refuses.
      const allowed = productionCapabilityFor(terrain, zone);
      const capability: WorldCell["productionCapability"] =
        allowed === "CROP" && !inReserve ? "NONE" : allowed;
      const buildable =
        capabilities.includes("BUILD") &&
        !reserved &&
        occupancy === "EMPTY" &&
        road === null &&
        !compositionClearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.y) < clearing.r);

      const cell: WorldCell = {
        x,
        z,
        terrain,
        zone,
        walkable,
        buildable,
        occupancy,
        productionCapability: capability,
        capabilities,
        road,
        legacyFarmTile: inReserve ? { x, y: z } : null
      };
      cells.set(key, cell);

      if (capability !== "NONE") productionCells[capability].push({ x, y: z });
      if (walkable && occupancy !== "BUILDING") walkableCells.push({ x, y: z });
    }
  }

  return {
    bounds,
    frame,
    terrain: island,
    cells,
    productionCells,
    walkableCells
  };
}
