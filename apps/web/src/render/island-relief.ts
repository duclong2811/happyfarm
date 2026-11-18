import { fbm } from "@happy-farm/game-data";

/**
 * Mountains on a chosen island, drawn from its stored cells.
 *
 * Relief only ever rises on ROCK - the one kind of land nothing is built or planted on - so a field,
 * a building or a crop always stands on level ground. What the rock becomes depends on the element:
 * - Kim: mountain ranges, ridged and snow-capped where they are high;
 * - Hỏa: its largest rock mass is a volcano with a crater, the rest are low hills;
 * - anything else with rock: low hills.
 * An island with no rock has no mountains, which is how some islands stay open and flat.
 *
 * A mine stands on its ORE site, often inside the rock. Its yard stays level, and a pass three cells
 * wide is cut through the rock to the nearest open ground, so a miner can always walk to it. Steep
 * rock is not walkable (the walker's slope limit and the cell map both say so), and the ring of
 * shallows around every island means a mountain can always be walked around.
 *
 * Pure: the same cells and sites give the same heights, in the browser and in the picker preview.
 */

/** Level ground's own height on a chosen island, in world metres. */
export const RELIEF_BASE_WORLD = 0.16;
/** Rock above this is too steep or high to walk on: the cell map marks it unwalkable. */
export const RELIEF_WALKABLE_MAX_WORLD = 0.9;

const KIM_PEAK_WORLD = 6.5;
const KIM_RISE_CELLS = 3.5;
const KIM_SNOW_WORLD = 7.4;
const HILL_PEAK_WORLD = 2.1;
const HILL_RISE_CELLS = 5;
const MINE_YARD_RADIUS_CELLS = 2.5;

export type ReliefTag = 0 | 1 | 2 | 3;
/** Per-cell surface tags for colouring. */
export const RELIEF_TAG = { NONE: 0, SNOW: 1, BASALT: 2, LAVA: 3 } as const;

export interface IslandRelief {
  /** World metres per cell (before the field's softening). */
  readonly height: Float32Array;
  /** `RELIEF_TAG` per cell. */
  readonly tag: Uint8Array;
  /** The volcano's crater, in grid cells, when the island has one. */
  readonly volcano: { readonly x: number; readonly y: number; readonly craterRadius: number; readonly peak: number } | null;
}

export interface IslandReliefInput {
  readonly size: number;
  readonly element: string;
  readonly seed: number;
  readonly isRock: (index: number) => boolean;
  /** ORE sites in grid cells (not farm tiles). */
  readonly ore: readonly { readonly x: number; readonly y: number }[];
}

/**
 * Chamfer distance from every cell inside a region to the nearest cell outside it (0 outside):
 * two passes, orthogonal steps 1 and diagonal steps sqrt 2. The grid's edge is not a neighbour.
 */
export function distanceToOutside(size: number, inside: (index: number) => boolean): Float32Array {
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

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** The rock a mountain may rise from: rock that is not a mine's yard or its pass to open ground. */
function mountainRock(input: IslandReliefInput): Uint8Array {
  const { size, isRock, ore } = input;
  const rock = new Uint8Array(size * size);
  for (let index = 0; index < rock.length; index += 1) rock[index] = isRock(index) ? 1 : 0;
  const clear = (x: number, y: number, radius: number): void => {
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && Math.hypot(dx, dy) <= radius) rock[ny * size + nx] = 0;
      }
    }
  };
  for (const site of ore) {
    if (site.x < 0 || site.y < 0 || site.x >= size || site.y >= size) continue;
    // The pass: breadth-first through rock from the mine to the first open cell, then back.
    const start = site.y * size + site.x;
    const parent = new Int32Array(size * size).fill(-2);
    parent[start] = -1;
    const queue = [start];
    let reached = -1;
    for (let head = 0; head < queue.length && reached < 0; head += 1) {
      const index = queue[head] ?? 0;
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (parent[next] !== -2) continue;
        parent[next] = index;
        if (!isRock(next)) {
          reached = next;
          break;
        }
        queue.push(next);
      }
    }
    for (let step = reached; step >= 0; step = parent[step] ?? -1) clear(step % size, Math.floor(step / size), 1.5);
    clear(site.x, site.y, MINE_YARD_RADIUS_CELLS);
  }
  return rock;
}

/** Labels the connected pieces of a mask (4-neighbour); returns the labels and each piece's size. */
function pieces(size: number, mask: Uint8Array): { readonly label: Int32Array; readonly sizes: number[] } {
  const label = new Int32Array(size * size).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || (label[start] ?? -1) >= 0) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      count += 1;
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (mask[next] !== 1 || (label[next] ?? -1) >= 0) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    sizes.push(count);
  }
  return { label, sizes };
}

export function islandRelief(input: IslandReliefInput): IslandRelief {
  const { size, element, seed } = input;
  const total = size * size;
  const height = new Float32Array(total);
  const tag = new Uint8Array(total);
  const rock = mountainRock(input);
  const depth = distanceToOutside(size, (index) => rock[index] === 1);
  for (let index = 0; index < total; index += 1) if (input.isRock(index)) height[index] = RELIEF_BASE_WORLD;
  let volcano: IslandRelief["volcano"] = null;

  if (element === "KIM") {
    for (let index = 0; index < total; index += 1) {
      const d = depth[index] ?? 0;
      if (d <= 0) continue;
      const x = index % size;
      const y = (index - x) / size;
      // Ridged noise: high along the noise's mid-line, so the massif breaks into ridges and peaks.
      const n = fbm(seed + 4141, x / 7, y / 7, 3);
      const ridge = 1 - Math.abs(2 * n - 1);
      const core = Math.min(2, Math.max(0, d - 4) * 0.35);
      const h = RELIEF_BASE_WORLD + (KIM_PEAK_WORLD * (0.45 + 0.6 * ridge) + core) * smoothstep((d - 0.5) / KIM_RISE_CELLS);
      height[index] = h;
      if (h > KIM_SNOW_WORLD + (fbm(seed + 4242, x / 3, y / 3, 2) - 0.5) * 1.2) tag[index] = RELIEF_TAG.SNOW;
    }
  } else {
    const { label, sizes } = pieces(size, rock);
    let largest = -1;
    if (element === "HOA") sizes.forEach((count, id) => { if (count >= 12 && (largest < 0 || count > (sizes[largest] ?? 0))) largest = id; });
    if (largest >= 0) {
      // The volcano: a cone over its rock mass, rising with depth, with a crater at the deepest point.
      let crater = -1;
      for (let index = 0; index < total; index += 1) {
        if (label[index] === largest && (crater < 0 || (depth[index] ?? 0) > (depth[crater] ?? 0))) crater = index;
      }
      const reach = Math.max(1, depth[crater] ?? 1);
      const peak = Math.min(10, Math.max(3, 1.8 + 2.2 * reach));
      const cx = crater % size;
      const cy = (crater - cx) / size;
      const craterRadius = Math.max(1.1, reach * 0.32);
      for (let index = 0; index < total; index += 1) {
        if (label[index] !== largest) continue;
        const x = index % size;
        const y = (index - x) / size;
        const t = Math.min(1, (depth[index] ?? 0) / reach);
        let h = RELIEF_BASE_WORLD + peak * Math.pow(t, 1.15);
        const fromCrater = Math.hypot(x - cx, y - cy);
        if (fromCrater < craterRadius) {
          h -= peak * 0.3 * Math.pow(1 - fromCrater / craterRadius, 1.5);
          tag[index] = fromCrater < craterRadius * 0.7 ? RELIEF_TAG.LAVA : RELIEF_TAG.BASALT;
        } else {
          tag[index] = RELIEF_TAG.BASALT;
        }
        height[index] = h;
      }
      volcano = { x: cx, y: cy, craterRadius, peak };
    }
    for (let index = 0; index < total; index += 1) {
      const d = depth[index] ?? 0;
      if (d <= 0 || (largest >= 0 && label[index] === largest)) continue;
      const x = index % size;
      const y = (index - x) / size;
      const n = fbm(seed + 4343, x / 5, y / 5, 2);
      height[index] = RELIEF_BASE_WORLD + HILL_PEAK_WORLD * smoothstep((d - 1) / HILL_RISE_CELLS) * (0.75 + 0.5 * n);
    }
  }
  return { height, tag, volcano };
}
