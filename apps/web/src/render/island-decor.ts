import { ISLAND_DOCK_CLEARANCE_TILES, islandCellKindAt, type IslandCellKind } from "@happy-farm/game-data";
import type { FarmIslandDTO } from "@happy-farm/contracts";

/**
 * Set dressing for a chosen island: a pier and a moored boat at the dock, and a small village around
 * the camp (a well, a windmill, a barn, a silo, carts, crates, lanterns).
 *
 * Presentation only, and never in the way:
 * - nothing here is a server object, has collision, or blocks a placement;
 * - the pier, the boat and the dock's own crates stay inside the dock's protected radius, where
 *   nothing can be built;
 * - a village piece stands on open land, clear of the camp's spawn, the mines, the trees and the
 *   dock, and it *yields*: wherever the player builds, plants or places something, the piece over
 *   those cells is not drawn (`visibleIslandDecor`).
 *
 * Pure and deterministic: the same stored island always gets the same village.
 */

export interface DecorPlacement {
  readonly id: string;
  /** A model library id (a prop or a building model). */
  readonly modelId: string;
  /** Farm tile coordinates, fractional. */
  readonly x: number;
  readonly y: number;
  /** Radians about Y; the model's front (+Z) turned toward the camp. */
  readonly rotationY: number;
  /** World metres across the model's largest dimension (every model is normalised to one unit). */
  readonly sizeWorld: number;
  /** The cells it covers, as a radius in tiles: a build there hides it. */
  readonly radiusTiles: number;
}

export interface PierPlan {
  /** Where the pier starts, on the beach, in farm tiles. */
  readonly x: number;
  readonly y: number;
  /** Its heading in tile space: +x is east, +y is south. */
  readonly dirX: number;
  readonly dirY: number;
  readonly lengthTiles: number;
}

export interface BoatPlan {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
}

export interface IslandDecorPlan {
  readonly pier: PierPlan | null;
  readonly boat: BoatPlan | null;
  readonly props: readonly DecorPlacement[];
}

type Ground = Pick<FarmIslandDTO, "size" | "originX" | "originY" | "cells" | "sites" | "seed">;

const VILLAGE_LAND: ReadonlySet<IslandCellKind> = new Set(["GRASS", "MEADOW", "FIELD"]);
const DOCK_LAND: ReadonlySet<IslandCellKind> = new Set(["SAND", "GRASS", "MEADOW", "FIELD"]);

/** A small deterministic generator (mulberry32), so a seed is the same village everywhere. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kindAt(ground: Ground, x: number, y: number): IslandCellKind {
  return islandCellKindAt(ground, { x: Math.round(x), y: Math.round(y) });
}

function covers(x: number, y: number, radius: number, test: (cx: number, cy: number) => boolean): boolean {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (Math.hypot(dx, dy) > radius + 0.25) continue;
      if (!test(Math.round(x) + dx, Math.round(y) + dy)) return false;
    }
  }
  return true;
}

function planPier(ground: Ground): { pier: PierPlan | null; boat: BoatPlan | null; dockProps: DecorPlacement[] } {
  const dock = ground.sites.find((site) => site.kind === "DOCK");
  if (dock === undefined) return { pier: null, boat: null, dockProps: [] };
  // Head for the nearest deep water: that is where a boat comes in. On a wide shelf (Thủy) the deep
  // can be far off, so failing that, head the way the water lies around the dock.
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -12; dy <= 12; dy += 1) {
    for (let dx = -12; dx <= 12; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d === 0 || d > 12) continue;
      if (islandCellKindAt(ground, { x: dock.x + dx, y: dock.y + dy }) !== "DEEP") continue;
      if (best === null || d < best.d) best = { x: dx, y: dy, d };
    }
  }
  if (best === null) {
    let sumX = 0;
    let sumY = 0;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const kind = islandCellKindAt(ground, { x: dock.x + dx, y: dock.y + dy });
        if (kind === "SHALLOW" || kind === "DEEP") {
          sumX += dx;
          sumY += dy;
        }
      }
    }
    const d = Math.hypot(sumX, sumY);
    if (d === 0) return { pier: null, boat: null, dockProps: [] };
    best = { x: (sumX / d) * 6, y: (sumY / d) * 6, d: 6 };
  }
  const dirX = best.x / best.d;
  const dirY = best.y / best.d;
  // From a step up the beach, out over the shallows, staying inside the dock's protected radius.
  const startX = dock.x - dirX * 0.6;
  const startY = dock.y - dirY * 0.6;
  const lengthTiles = Math.max(1.8, Math.min(ISLAND_DOCK_CLEARANCE_TILES + 0.4, best.d + 0.2));
  const endX = startX + dirX * lengthTiles;
  const endY = startY + dirY * lengthTiles;
  const pier: PierPlan = { x: startX, y: startY, dirX, dirY, lengthTiles };
  const boat: BoatPlan = { x: endX - dirX * 0.7 - dirY * 1.05, y: endY - dirY * 0.7 + dirX * 1.05, dirX, dirY };
  // A few crates, barrels and a coil of rope at the foot of the pier, on dry ground.
  const dockProps: DecorPlacement[] = [];
  const pieces: readonly [string, number, number, number][] = [
    ["prop_barrel", -1.3, 1.1, 0.95],
    ["prop_barrel", -1.7, 1.6, 0.95],
    ["prop_crate_wooden", -1.4, -1.2, 0.7],
    ["prop_crate", -2.0, -1.0, 0.75],
    ["prop_rope", -0.9, -1.5, 0.5]
  ];
  pieces.forEach(([modelId, along, across, sizeWorld], index) => {
    const x = dock.x + dirX * along - dirY * across;
    const y = dock.y + dirY * along + dirX * across;
    if (Math.hypot(x - dock.x, y - dock.y) > ISLAND_DOCK_CLEARANCE_TILES - 0.2) return;
    if (!DOCK_LAND.has(kindAt(ground, x, y))) return;
    dockProps.push({ id: `dock.${String(index)}`, modelId, x, y, rotationY: Math.atan2(dirX, dirY) + index * 0.7, sizeWorld, radiusTiles: 0.4 });
  });
  return { pier, boat, dockProps };
}

interface VillageSlot {
  readonly modelId: string;
  readonly radius: number;
  readonly angle: number;
  readonly sizeWorld: number;
  readonly clearance: number;
}

/** The village, as slots around the camp: distance in tiles, angle from the island's own heading. */
const VILLAGE: readonly VillageSlot[] = [
  { modelId: "civic.well.t1", radius: 3.4, angle: 0, sizeWorld: 2.1, clearance: 1.1 },
  { modelId: "farm.windmill.t2", radius: 7.5, angle: 1.9, sizeWorld: 7, clearance: 2 },
  { modelId: "farm.openbarn.t1", radius: 7, angle: 3.5, sizeWorld: 5.2, clearance: 2.4 },
  { modelId: "farm.silo.t1", radius: 7.6, angle: 4.4, sizeWorld: 3.6, clearance: 1.3 },
  { modelId: "farm.coop.t1", radius: 5.6, angle: 5.3, sizeWorld: 1.6, clearance: 0.9 },
  { modelId: "prop_wagon", radius: 5, angle: 2.7, sizeWorld: 2.2, clearance: 1.1 },
  { modelId: "prop_stall_cart", radius: 4.8, angle: 0.95, sizeWorld: 2.9, clearance: 1.3 },
  { modelId: "prop_bench", radius: 3.4, angle: 0.62, sizeWorld: 1.5, clearance: 0.7 },
  { modelId: "prop_lantern", radius: 2.8, angle: 1.4, sizeWorld: 0.55, clearance: 0.3 },
  { modelId: "prop_lantern", radius: 2.8, angle: 3.5, sizeWorld: 0.55, clearance: 0.3 },
  { modelId: "prop_lantern", radius: 2.8, angle: 5.6, sizeWorld: 0.55, clearance: 0.3 },
  { modelId: "prop_barrel_apples", radius: 5.2, angle: 3.15, sizeWorld: 0.95, clearance: 0.45 },
  { modelId: "prop_crate_produce", radius: 5.5, angle: 3.85, sizeWorld: 0.68, clearance: 0.4 },
  { modelId: "prop_sack", radius: 5.9, angle: 3.55, sizeWorld: 0.8, clearance: 0.4 },
  { modelId: "prop_crate_carrot", radius: 4.4, angle: 5.0, sizeWorld: 0.68, clearance: 0.4 },
  { modelId: "prop_planter", radius: 3.9, angle: 2.2, sizeWorld: 0.75, clearance: 0.4 }
];

function planVillage(ground: Ground, dock: { x: number; y: number } | null): DecorPlacement[] {
  const camp = ground.sites.find((site) => site.kind === "CAMP");
  if (camp === undefined) return [];
  const roll = random(ground.seed ^ 0x51ed27);
  const heading = roll() * Math.PI * 2;
  const ores = ground.sites.filter((site) => site.kind === "ORE");
  const trees = ground.sites.filter((site) => site.kind === "TREE");
  const placed: DecorPlacement[] = [];
  const fits = (x: number, y: number, clearance: number): boolean => {
    if (Math.hypot(x - camp.x, y - camp.y) < 2.2 + clearance) return false;
    if (dock !== null && Math.hypot(x - dock.x, y - dock.y) < ISLAND_DOCK_CLEARANCE_TILES + 0.5 + clearance) return false;
    if (ores.some((ore) => Math.hypot(x - ore.x, y - ore.y) < 3.5 + clearance)) return false;
    if (trees.some((tree) => Math.hypot(x - tree.x, y - tree.y) < 1 + clearance)) return false;
    if (placed.some((other) => Math.hypot(x - other.x, y - other.y) < other.radiusTiles + clearance + 0.3)) return false;
    return covers(x, y, clearance, (cx, cy) => VILLAGE_LAND.has(islandCellKindAt(ground, { x: cx, y: cy })));
  };
  VILLAGE.forEach((slot, index) => {
    // Try the slot's own place first, then turn around the camp (and a little further out) until it fits.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const turn = (attempt % 2 === 0 ? 1 : -1) * Math.ceil(attempt / 2) * 0.28;
      const radius = slot.radius + Math.floor(attempt / 8) * 0.8;
      const angle = heading + slot.angle + turn;
      const x = camp.x + Math.cos(angle) * radius;
      const y = camp.y + Math.sin(angle) * radius;
      if (!fits(x, y, slot.clearance)) continue;
      placed.push({
        id: `village.${String(index)}`,
        modelId: slot.modelId,
        x,
        y,
        rotationY: Math.atan2(camp.x - x, camp.y - y) + (roll() - 0.5) * 0.3,
        sizeWorld: slot.sizeWorld,
        radiusTiles: slot.clearance
      });
      break;
    }
  });
  return placed;
}

export function islandDecorPlan(ground: Ground): IslandDecorPlan {
  const { pier, boat, dockProps } = planPier(ground);
  const dock = ground.sites.find((site) => site.kind === "DOCK") ?? null;
  return { pier, boat, props: [...dockProps, ...planVillage(ground, dock)] };
}

/**
 * The pieces still drawn: one over a cell the player has built on, planted or placed something on
 * gives way, so the village never sits inside a player's barn.
 */
export function visibleIslandDecor(props: readonly DecorPlacement[], occupied: (x: number, y: number) => boolean): readonly DecorPlacement[] {
  return props.filter((prop) => covers(prop.x, prop.y, prop.radiusTiles, (x, y) => !occupied(x, y)));
}
