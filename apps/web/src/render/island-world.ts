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
import { distanceToOutside, islandRelief, RELIEF_BASE_WORLD, RELIEF_TAG, RELIEF_WALKABLE_MAX_WORLD } from "./island-relief";
import { islandDecorPlan, type IslandDecorPlan } from "./island-decor";
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
/** The tallest the relief rises, in world metres, for the terrain shape's bookkeeping. */
const ROCK_PEAK_WORLD = 10;
/** Mountain surfaces (sRGB): snow on Kim's peaks, the volcano's basalt and its crater's lava. */
const SNOW_COLOR = [0.93, 0.95, 0.98] as const;
const BASALT_COLOR = [0.3, 0.25, 0.23] as const;
const LAVA_COLOR = [1, 0.42, 0.12] as const;
const HIGH_ROCK_COLOR = [0.64, 0.62, 0.6] as const;

/** The ground's own colour per cell kind; water cells colour the sea floor under the surface. */
const GROUND_COLORS: Readonly<Record<IslandCellKind, readonly [number, number, number]>> = {
  DEEP: [26, 66, 98],
  SHALLOW: [214, 198, 148],
  SAND: [236, 214, 150],
  GRASS: [84, 168, 58],
  FOREST: [52, 124, 42],
  ROCK: [146, 138, 128],
  MEADOW: [138, 196, 70],
  FIELD: [196, 156, 92]
};

function isWater(kind: IslandCellKind): boolean {
  return kind === "DEEP" || kind === "SHALLOW";
}


/** A stable 0..1 value per cell and salt, so the same island always grows the same scatter. */
function cellRoll(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}


function kindAt(ground: IslandGroundView, x: number, y: number): IslandCellKind {
  return islandCellKindAt(ground, { x: x + ground.originX, y: y + ground.originY });
}

/** Water surface colours, by depth: turquoise over the shelf with a foam line, blue past its edge. */
const FOAM = [0.82, 0.95, 0.93] as const;
const SHALLOW_NEAR = [0.22, 0.8, 0.78] as const;
const SHALLOW_FAR = [0.13, 0.62, 0.74] as const;
const DEEP_NEAR = [0.13, 0.45, 0.66] as const;
const DEEP_FAR = [0.07, 0.25, 0.44] as const;

/**
 * sRGB to linear, per channel. Three.js reads vertex colours as linear and converts on output, so a
 * palette written in sRGB (as every colour here is) must be linearised first - otherwise every colour
 * is shown lifted and washed out, which is how the chosen islands looked before this.
 */
function srgbToLinear(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearised(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) out[index] = srgbToLinear(values[index] ?? 0);
  return out;
}

function mixInto(out: Float32Array, at: number, a: readonly number[], b: readonly number[], t: number): void {
  const k = Math.min(1, Math.max(0, t));
  for (let channel = 0; channel < 3; channel += 1) out[at + channel] = (a[channel] ?? 0) + ((b[channel] ?? 0) - (a[channel] ?? 0)) * k;
}

/** The island's sampled coast and elevation, on its own cell grid. */
export function islandFieldFor(ground: IslandGroundView, frame: WorldFrame): IslandField {
  const { size } = ground;
  const kinds: IslandCellKind[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) kinds.push(kindAt(ground, x, y));
  const toWater = distanceToOutside(size, (index) => !isWater(kinds[index] ?? "DEEP"));
  const toLand = distanceToOutside(size, (index) => isWater(kinds[index] ?? "DEEP"));
  // Mountains rise from the rock alone (see island-relief.ts); every mine keeps a level yard and a pass.
  const relief = islandRelief({
    size,
    element: ground.element,
    seed: ground.seed,
    isRock: (index) => kinds[index] === "ROCK",
    ore: ground.sites.filter((site) => site.kind === "ORE").map((site) => ({ x: site.x - ground.originX, y: site.y - ground.originY }))
  });
  // The walker's edge is deep water, not the beach: shallows are wadeable.
  const toDeep = distanceToOutside(size, (index) => kinds[index] !== "DEEP");
  const toWalkable = distanceToOutside(size, (index) => kinds[index] === "DEEP");
  const walk = new Float32Array(size * size);
  const waterColors = new Float32Array(size * size * 3);
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
    const walkSigned = kind === "DEEP" ? (toWalkable[index] ?? 0) - 0.5 : -((toDeep[index] ?? 0) - 0.5);
    walk[index] = 1 + walkSigned / ISLAND_SHORE_SCALE_CELLS;
    if (kind === "SHALLOW") {
      const fromLand = toLand[index] ?? 0;
      mixInto(waterColors, index * 3, SHALLOW_NEAR, SHALLOW_FAR, (fromLand - 1) / 6);
      if (fromLand <= 1.01) mixInto(waterColors, index * 3, [waterColors[index * 3] ?? 0, waterColors[index * 3 + 1] ?? 0, waterColors[index * 3 + 2] ?? 0], FOAM, 0.3);
    } else if (kind === "DEEP") {
      mixInto(waterColors, index * 3, DEEP_NEAR, DEEP_FAR, ((toWalkable[index] ?? 0) - 1) / 8);
      if ((toLand[index] ?? 9) <= 1.01) mixInto(waterColors, index * 3, [waterColors[index * 3] ?? 0, waterColors[index * 3 + 1] ?? 0, waterColors[index * 3 + 2] ?? 0], FOAM, 0.4);
    } else {
      mixInto(waterColors, index * 3, FOAM, FOAM, 0);
    }
    // Signed distance to the waterline, which runs half way between a land cell and a water cell.
    const signed = isWater(kind) ? (toLand[index] ?? 0) - 0.5 : -((toWater[index] ?? 0) - 0.5);
    shore[index] = 1 + signed / ISLAND_SHORE_SCALE_CELLS;
    if (kind === "ROCK") {
      const rise = relief.height[index] ?? RELIEF_BASE_WORLD;
      height[index] = rise;
      const tagged = relief.tag[index] ?? RELIEF_TAG.NONE;
      const tint = tagged === RELIEF_TAG.SNOW
        ? SNOW_COLOR
        : tagged === RELIEF_TAG.LAVA
          ? LAVA_COLOR
          : tagged === RELIEF_TAG.BASALT
            ? BASALT_COLOR
            : null;
      if (tint !== null) {
        mixInto(colors, index * 3, tint, tint, 0);
        for (let channel = 0; channel < 3; channel += 1) colors[index * 3 + channel] = (colors[index * 3 + channel] ?? 0) + grain;
      } else if (rise > RELIEF_BASE_WORLD + 1) {
        // Bare rock pales as it climbs, so a range reads as stone rather than as a grey carpet.
        const own = [colors[index * 3] ?? 0, colors[index * 3 + 1] ?? 0, colors[index * 3 + 2] ?? 0];
        mixInto(colors, index * 3, own, HIGH_ROCK_COLOR, (rise - RELIEF_BASE_WORLD - 1) / 7);
      }
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
    colors: linearised(soften(colors, size, 3)),
    water,
    walk: soften(walk, size, 1),
    waterColors: linearised(soften(waterColors, size, 3)),
    ...(relief.volcano === null
      ? {}
      : {
          volcano: {
            worldX: origin.worldX + relief.volcano.x * frame.pitch,
            worldZ: origin.worldZ + relief.volcano.y * frame.pitch,
            craterRadiusWorld: relief.volcano.craterRadius * frame.pitch
          }
        })
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
      // Shore props: a scatter of beach stones and the odd tuft, so the beach reads as a place.
      return [
        { kind: "rock", chance: 0.022, scaleMin: 0.3, scaleMax: 0.7, detail: true },
        { kind: "plant", chance: 0.02, scaleMin: 0.35, scaleMax: 0.55, detail: true }
      ];
    case "DEEP":
    case "SHALLOW":
      return [];
  }
}

/** What grows on a chosen island: deterministic from its stored cells and nothing else. */
export function islandScenery(ground: IslandGroundView, frame: WorldFrame, terrain: TerrainShape, decor: IslandDecorPlan = islandDecorPlan(ground)): SceneryInstance[] {
  // Keep clear of the island's own working sites: a chopped tree stands on a tree site, a dock and the
  // camp need room, and a decorative trunk on top of either reads as a bug. The village's pieces get
  // the same courtesy, so a bush never grows through the well.
  const keepClear = new Set<string>();
  for (const site of ground.sites) {
    const reach = site.kind === "DOCK" ? ISLAND_DOCK_CLEARANCE_TILES : site.kind === "CAMP" ? 3 : 1;
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) keepClear.add(cellKey(site.x + dx, site.y + dy));
  }
  for (const piece of decor.props) {
    const reach = Math.ceil(piece.radiusTiles + 0.5);
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) keepClear.add(cellKey(Math.round(piece.x) + dx, Math.round(piece.y) + dy));
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
  const islandDecor = islandDecorPlan(ground);
  return {
    ...EMPTY_WORLD,
    inner: bounds,
    outer: bounds,
    scenery: islandScenery(ground, frame, terrain, islandDecor),
    islandDecor,
    islandGround: ground,
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
      // The shelf is wadeable on a chosen island: a walker may cross it, nothing may be built on it.
      // A mountainside is not: rock that has risen past a step is left to the slope (island-relief.ts).
      const risen = kind === "ROCK" && (terrain.field?.height[(z - ground.originY) * ground.size + (x - ground.originX)] ?? 0) > RELIEF_WALKABLE_MAX_WORLD;
      const walkable = (capabilities.includes("WALK") || kind === "SHALLOW") && !risen;
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
