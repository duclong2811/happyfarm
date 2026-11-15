/**
 * A chosen Home Island, as the renderer draws it.
 *
 * The server stores the island's ground (one cell code per farm tile) and this module turns that
 * stored ground - never a browser re-run of the generator - into what the hand-composed island is
 * made of: a sampled coast and elevation (`IslandField`) that the shared terrain functions read, a
 * scatter of scenery that grows where the cells say forest, rock or meadow, the cell map selection and
 * walking use, and the spot a character appears on.
 *
 * Presentation only. Whether ground may be planted, built on or moored over is the server's answer
 * from the same stored cells; this map exists so the client never *offers* what the server refuses.
 */

import type { FarmIslandDTO } from "@happy-farm/contracts";
import { islandCellKindAt, ISLAND_DOCK_CLEARANCE_TILES, type IslandCellKind } from "@happy-farm/game-data";
import { tileToWorld, worldFrame, type FarmLayout, type TileBounds, type TileCoordinate, type WorldFrame } from "./layout";
import { GROUND_SURFACE_Y, terrainHeightAt, type IslandField, type TerrainShape } from "./terrain-height";
import { EMPTY_WORLD, type FarmWorld, type SceneryInstance, type SceneryKind } from "./world";
import {
  cellCapabilitiesFor,
  cellKey,
  productionCapabilityFor,
  type CellOccupancy,
  type CellTerrain,
  type CellZone,
  type WorldCell,
  type WorldCellMap
} from "./world-cell";
import { sceneryOccupiesCell, WATER_MARGIN_CELLS, type WorldCellMapInput } from "./world-cell-map";
import { SEA_SURFACE_Y } from "./world-cell-overlay";

/** A farm's stored island ground, exactly as `GET /farms/:id/island` serves it. */
export type IslandGroundView = FarmIslandDTO;

/**
 * Cells per shore unit. The composed island is about 55 tiles from centre to shore, so a beach band
 * or an "inland enough for a tree" margin means the same distance on either kind of island.
 */
export const ISLAND_SHORE_SCALE_CELLS = 55;
/** The tallest a rock ridge rises, in world metres. Everything else a player can work stays level. */
const ROCK_PEAK_WORLD = 2.1;
/** How many cells a ridge takes to rise from its foot to its full height. */
const ROCK_RISE_CELLS = 5;

/** The ground's own colour per cell kind; water cells colour the sea floor under the surface. */
const GROUND_COLORS: Readonly<Record<IslandCellKind, readonly [number, number, number]>> = {
  DEEP: [40, 92, 128],
  SHALLOW: [196, 178, 128],
  SAND: [231, 213, 154],
  GRASS: [100, 178, 72],
  FOREST: [72, 140, 54],
  ROCK: [150, 142, 132],
  MEADOW: [152, 202, 92],
  FIELD: [196, 164, 104]
};

function isWater(kind: IslandCellKind): boolean {
  return kind === "DEEP" || kind === "SHALLOW";
}

/**
 * Distance from every cell to the nearest cell outside `inside`, in cells (two-pass chamfer, 1 / √2).
 * Cells outside the set are 0; a cell inside touching the boundary is 1.
 */
function distanceToOutside(size: number, inside: (index: number) => boolean): Float32Array {
  const far = size * 4;
  const distance = new Float32Array(size * size);
  for (let index = 0; index < distance.length; index += 1) distance[index] = inside(index) ? far : 0;
  const diagonal = Math.SQRT2;
  const relax = (index: number, neighbour: number, cost: number): void => {
    const candidate = (distance[neighbour] ?? far) + cost;
    if (candidate < (distance[index] ?? far)) distance[index] = candidate;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if ((distance[index] ?? 0) === 0) continue;
      if (x > 0) relax(index, index - 1, 1);
      if (y > 0) {
        relax(index, index - size, 1);
        if (x > 0) relax(index, index - size - 1, diagonal);
        if (x < size - 1) relax(index, index - size + 1, diagonal);
      }
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      const index = y * size + x;
      if ((distance[index] ?? 0) === 0) continue;
      if (x < size - 1) relax(index, index + 1, 1);
      if (y < size - 1) {
        relax(index, index + size, 1);
        if (x < size - 1) relax(index, index + size + 1, diagonal);
        if (x > 0) relax(index, index + size - 1, diagonal);
      }
    }
  }
  return distance;
}

/** A stable 0..1 value per cell and salt, so the same island always grows the same scatter. */
function cellRoll(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function kindAt(ground: IslandGroundView, x: number, y: number): IslandCellKind {
  return islandCellKindAt(ground, { x: x + ground.originX, y: y + ground.originY });
}

/** The island's sampled coast and elevation, on its own cell grid. */
export function islandFieldFor(ground: IslandGroundView, frame: WorldFrame): IslandField {
  const { size } = ground;
  const kinds: IslandCellKind[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) kinds.push(kindAt(ground, x, y));
  const toWater = distanceToOutside(size, (index) => !isWater(kinds[index] ?? "DEEP"));
  const toLand = distanceToOutside(size, (index) => isWater(kinds[index] ?? "DEEP"));
  const toOpenGround = distanceToOutside(size, (index) => kinds[index] === "ROCK");
  const shore = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  const colors = new Float32Array(size * size * 3);
  const water = new Uint8Array(size * size);
  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index] ?? "DEEP";
    const [r, g, b] = GROUND_COLORS[kind];
    const grain = isWater(kind) ? 0 : (cellRoll(index % size, Math.floor(index / size), 11) - 0.5) * 0.06;
    colors[index * 3] = r / 255 + grain;
    colors[index * 3 + 1] = g / 255 + grain;
    colors[index * 3 + 2] = b / 255 + grain;
    water[index] = kind === "DEEP" ? 2 : kind === "SHALLOW" ? 1 : 0;
    // Signed distance to the waterline, which runs half way between a land cell and a water cell.
    const signed = isWater(kind) ? (toLand[index] ?? 0) - 0.5 : -((toWater[index] ?? 0) - 0.5);
    shore[index] = 1 + signed / ISLAND_SHORE_SCALE_CELLS;
    if (kind === "ROCK") {
      const x = index % size;
      const y = Math.floor(index / size);
      const rise = smoothstep(((toOpenGround[index] ?? 1) - 1) / ROCK_RISE_CELLS);
      height[index] = 0.16 + ROCK_PEAK_WORLD * rise * (0.75 + 0.5 * cellRoll(x, y, 7));
    }
  }
  const origin = tileToWorld({ x: ground.originX, y: ground.originY }, frame);
  return {
    originWorldX: origin.worldX,
    originWorldZ: origin.worldZ,
    pitch: frame.pitch,
    size,
    // Rounded by a small kernel so the coast is a curve rather than a staircase of cells. The kernel is
    // centre-weighted, so a one-cell spit of land survives it.
    shore: soften(shore, size, 1),
    height: soften(height, size, 1),
    cellsPerShoreUnit: ISLAND_SHORE_SCALE_CELLS,
    waterlineDrop: GROUND_SURFACE_Y - SEA_SURFACE_Y,
    colors: soften(colors, size, 3),
    water
  };
}

/** One separable [1 4 1] / 6 pass over a per-cell field with `channels` values per cell. */
function soften(values: Float32Array, size: number, channels: number): Float32Array {
  const pass = (source: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(source.length);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const before = horizontal ? Math.max(0, x - 1) + y * size : x + Math.max(0, y - 1) * size;
        const here = x + y * size;
        const after = horizontal ? Math.min(size - 1, x + 1) + y * size : x + Math.min(size - 1, y + 1) * size;
        for (let channel = 0; channel < channels; channel += 1) {
          out[here * channels + channel] =
            ((source[before * channels + channel] ?? 0) + 4 * (source[here * channels + channel] ?? 0) + (source[after * channels + channel] ?? 0)) / 6;
        }
      }
    }
    return out;
  };
  return pass(pass(values, true), false);
}

/** The terrain shape of a chosen island: its field, centred on its own grid. */
export function islandTerrainFor(ground: IslandGroundView, frame: WorldFrame): TerrainShape {
  const field = islandFieldFor(ground, frame);
  const half = (ground.size / 2) * frame.pitch;
  return {
    centerWorldX: field.originWorldX + (ground.size - 1) * 0.5 * frame.pitch,
    centerWorldZ: field.originWorldZ + (ground.size - 1) * 0.5 * frame.pitch,
    halfWidthWorld: half,
    halfDepthWorld: half,
    exponent: 2,
    lobes: [],
    reliefWorld: ROCK_PEAK_WORLD,
    flatAreas: [],
    uplands: [],
    field
  };
}

interface ScatterRule {
  readonly kind: SceneryKind;
  readonly chance: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly detail: boolean;
}

/** The decorative trees a forest cell may hold, thinned so a big forest stays inside the budget. */
const MAX_FOREST_TREES = 650;

function scatterRules(kind: IslandCellKind, forestChance: number, element: string): readonly ScatterRule[] {
  switch (kind) {
    case "FOREST":
      return [
        { kind: element === "MOC" || element === "KIM" ? "pine" : "tree", chance: forestChance * 0.6, scaleMin: 2.6, scaleMax: 4.2, detail: false },
        { kind: element === "MOC" || element === "KIM" ? "tree" : "pine", chance: forestChance * 0.4, scaleMin: 2.4, scaleMax: 3.8, detail: false },
        { kind: "bush", chance: 0.08, scaleMin: 0.7, scaleMax: 1.1, detail: true }
      ];
    case "ROCK":
      return [{ kind: "rock", chance: 0.14, scaleMin: 0.6, scaleMax: 1.5, detail: false }];
    case "GRASS":
      return [
        { kind: "bush", chance: 0.018, scaleMin: 0.7, scaleMax: 1.1, detail: false },
        { kind: "flower", chance: 0.035, scaleMin: 0.4, scaleMax: 0.6, detail: true }
      ];
    case "MEADOW":
      return [
        { kind: "flower", chance: 0.07, scaleMin: 0.4, scaleMax: 0.65, detail: true },
        { kind: "plant", chance: 0.05, scaleMin: 0.45, scaleMax: 0.7, detail: true }
      ];
    case "FIELD":
      return [{ kind: "plant", chance: 0.02, scaleMin: 0.4, scaleMax: 0.6, detail: true }];
    case "SAND":
      return [{ kind: "rock", chance: 0.008, scaleMin: 0.35, scaleMax: 0.6, detail: true }];
    case "DEEP":
    case "SHALLOW":
      return [];
  }
}

/** What grows on a chosen island: deterministic from its stored cells and nothing else. */
export function islandScenery(ground: IslandGroundView, frame: WorldFrame, terrain: TerrainShape): SceneryInstance[] {
  // Keep clear of the island's own working sites: a chopped tree stands on a tree site, a dock and the
  // camp need room, and a decorative trunk on top of either reads as a bug.
  const keepClear = new Set<string>();
  for (const site of ground.sites) {
    const reach = site.kind === "DOCK" ? ISLAND_DOCK_CLEARANCE_TILES : site.kind === "CAMP" ? 3 : 1;
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) keepClear.add(cellKey(site.x + dx, site.y + dy));
  }
  let forestCells = 0;
  for (const code of ground.cells) if (code === "f") forestCells += 1;
  const forestChance = forestCells === 0 ? 0 : Math.min(0.55, MAX_FOREST_TREES / forestCells);

  const scenery: SceneryInstance[] = [];
  for (let y = 0; y < ground.size; y += 1) {
    for (let x = 0; x < ground.size; x += 1) {
      const tile = { x: x + ground.originX, y: y + ground.originY };
      if (keepClear.has(cellKey(tile.x, tile.y))) continue;
      const kind = kindAt(ground, x, y);
      let threshold = 0;
      const roll = cellRoll(x, y, 1);
      for (const rule of scatterRules(kind, forestChance, ground.element)) {
        threshold += rule.chance;
        if (roll >= threshold) continue;
        const centre = tileToWorld(tile, frame);
        const worldX = centre.worldX + (cellRoll(x, y, 2) - 0.5) * 0.5 * frame.pitch;
        const worldZ = centre.worldZ + (cellRoll(x, y, 3) - 0.5) * 0.5 * frame.pitch;
        scenery.push({
          kind: rule.kind,
          worldX,
          worldY: GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, terrain),
          worldZ,
          scale: rule.scaleMin + (rule.scaleMax - rule.scaleMin) * cellRoll(x, y, 4),
          rotationY: cellRoll(x, y, 5) * Math.PI * 2,
          tier: "HERO",
          variantRoll: cellRoll(x, y, 6),
          detail: rule.detail
        });
        break;
      }
    }
  }
  return scenery;
}

/** The FarmWorld of a chosen island: its own ground and scatter, none of the composed island's. */
export function buildIslandFarmWorld(layout: FarmLayout, ground: IslandGroundView): FarmWorld {
  const frame = worldFrame(layout.pitch);
  const terrain = islandTerrainFor(ground, frame);
  const bounds: TileBounds = {
    minX: ground.originX,
    maxX: ground.originX + ground.size - 1,
    minY: ground.originY,
    maxY: ground.originY + ground.size - 1
  };
  const half = (ground.size / 2) * frame.pitch;
  return {
    ...EMPTY_WORLD,
    inner: bounds,
    outer: bounds,
    scenery: islandScenery(ground, frame, terrain),
    islandHalfWidthWorld: half,
    islandHalfDepthWorld: half,
    farmHalfExtentWorld: half * 0.45,
    centerWorldX: terrain.centerWorldX,
    centerWorldZ: terrain.centerWorldZ,
    terrain
  };
}

/** Where a character appears on a chosen island: the camp site, or the island's middle. */
export function islandSpawnWorld(ground: IslandGroundView, frame: WorldFrame = worldFrame()): { readonly worldX: number; readonly worldZ: number } {
  const camp = ground.sites.find((site) => site.kind === "CAMP");
  const tile = camp ?? { x: ground.originX + Math.floor(ground.size / 2), y: ground.originY + Math.floor(ground.size / 2) };
  return tileToWorld(tile, frame);
}

function cellTerrainFor(kind: IslandCellKind): CellTerrain {
  switch (kind) {
    case "DEEP":
    case "SHALLOW":
      return "WATER";
    case "SAND":
      return "SHORE";
    case "ROCK":
      // Rock is the chosen island's mountain: walkable, cut for ore, never farmed or built on - the
      // same answers the composed island's volcano flank gives, so it reuses that vocabulary.
      return "VOLCANO";
    case "GRASS":
    case "FOREST":
    case "MEADOW":
    case "FIELD":
      return "LAND";
  }
}

/**
 * The cell map of a chosen island.
 *
 * The same shape as `buildWorldCellMap`'s, built from the stored cells instead of the composed
 * island's outline, districts and authored buildings - none of which exist here.
 */
export function buildIslandCellMap(input: WorldCellMapInput, ground: IslandGroundView, terrain: TerrainShape): WorldCellMap {
  const frame = worldFrame(input.layout.pitch);
  const planted = new Set(input.plantedTiles.map((tile) => cellKey(tile.x, tile.y)));
  const resources = new Set((input.resourceNodes ?? []).map((tile) => cellKey(tile.x, tile.y)));
  const owned = new Set(input.tiles.map((tile) => cellKey(tile.x, tile.y)));
  const built = new Set<string>();
  for (const construction of input.constructions) {
    for (let y = construction.minY; y <= construction.maxY; y += 1) {
      for (let x = construction.minX; x <= construction.maxX; x += 1) built.add(cellKey(x, y));
    }
  }
  const sceneryByCell = new Map<string, string>();
  for (const entry of input.scenery) {
    if (!sceneryOccupiesCell(entry.kind)) continue;
    const x = Math.floor(entry.worldX / frame.pitch + frame.originTileX + 0.5);
    const z = Math.floor(entry.worldZ / frame.pitch + frame.originTileY + 0.5);
    sceneryByCell.set(cellKey(x, z), entry.kind);
  }
  const docks = ground.sites.filter((site) => site.kind === "DOCK");
  const nearDock = (tile: TileCoordinate): boolean =>
    docks.some((dock) => Math.hypot(dock.x - tile.x, dock.y - tile.y) <= ISLAND_DOCK_CLEARANCE_TILES);

  const bounds: TileBounds = {
    minX: ground.originX,
    maxX: ground.originX + ground.size - 1,
    minY: ground.originY,
    maxY: ground.originY + ground.size - 1
  };
  const cells = new Map<string, WorldCell>();
  const productionCells: Record<Exclude<WorldCell["productionCapability"], "NONE">, TileCoordinate[]> = {
    CROP: [],
    AQUACULTURE: [],
    TIMBER: [],
    MINING: []
  };
  const walkableCells: TileCoordinate[] = [];
  const field = terrain.field;

  for (let z = bounds.minY; z <= bounds.maxY; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const tile = { x, y: z };
      const kind = islandCellKindAt(ground, tile);
      if (field !== undefined) {
        const shore = field.shore[(z - ground.originY) * ground.size + (x - ground.originX)] ?? 2;
        // Open sea past the working margin is not a cell, exactly as on the composed island.
        if (shore > 1 + WATER_MARGIN_CELLS) continue;
      }
      const key = cellKey(x, z);
      const terrainKind = cellTerrainFor(kind);
      const protectedGround = nearDock(tile);
      const zone: CellZone =
        kind === "ROCK" ? "VOLCANO_SLOPE" : kind === "SHALLOW" && !protectedGround ? "AQUACULTURE" : "NONE";
      const builtHere = built.has(key);
      const sceneryKind = sceneryByCell.get(key);
      const occupancy: CellOccupancy = builtHere
        ? "BUILDING"
        : planted.has(key)
          ? "PRODUCTION"
          : resources.has(key)
            ? "RESOURCE"
            : sceneryKind === undefined
              ? "EMPTY"
              : "SCENERY";
      const capabilities = cellCapabilitiesFor(terrainKind, zone);
      const walkable = capabilities.includes("WALK");
      const capability = protectedGround ? "NONE" : productionCapabilityFor(terrainKind, zone);
      const cell: WorldCell = {
        x,
        z,
        terrain: terrainKind,
        zone,
        owned: owned.has(key),
        shallowWater: terrainKind === "WATER" && zone === "AQUACULTURE",
        reserved: protectedGround,
        walkable,
        buildable: capabilities.includes("BUILD") && !protectedGround && occupancy === "EMPTY",
        occupancy,
        productionCapability: capability,
        capabilities,
        road: null,
        legacyFarmTile: owned.has(key) ? { x, y: z } : null
      };
      cells.set(key, cell);
      if (capability !== "NONE") productionCells[capability].push({ x, y: z });
      if (walkable && occupancy !== "BUILDING") walkableCells.push({ x, y: z });
    }
  }
  return { bounds, frame, terrain, cells, productionCells, walkableCells };
}
