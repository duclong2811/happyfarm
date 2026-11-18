import {
  fbm,
  hash2,
  rng,
  summedArea,
  type GeneratedIsland,
  type IslandCellKind,
  type IslandElement,
  type IslandOutline,
  type IslandSite,
  type IslandSiteKind
} from "./island-generator";

/**
 * Island generator v2 (`docs/briefs/ISLAND_V2.md`, `docs/design/ISLAND_V2_RESEARCH.md`).
 *
 * Same contract as v1 - `{ element, seed, outline }` always gives the same island, pure, no clock, no
 * randomness but the seed - and the same cell vocabulary, so stored grounds, server rules and the
 * renderer read it unchanged. What changes is how it reads and plays:
 *
 * - **Coherent shapes.** A domain-warped outline, then cleanup passes: no one-cell slivers, no specks,
 *   no pinholes. Biomes come in large patches with soft borders.
 * - **A walkable shelf.** Every coast has a band of shallows, wider on Thủy, whose coves and lagoons
 *   are shallow too - pretty water that never cuts the island into fingers. Deep water is the edge.
 * - **Connected.** Every land and shallow region joins the main island through land or shallows
 *   (a reef path is laid where it would not), so the camp can reach everything on foot.
 * - **Deliberate sites.** Camp on open level ground near the middle, the dock on the beach facing deep
 *   water nearest the camp, fishing places just off the shelf, ore on rock (Kim) or solid ground.
 *
 * Deterministic site placement walks candidates in a seeded hash order rather than sampling, so the
 * cost is bounded and the result never depends on how many tries a loop happened to need.
 */

interface RecipeV2 {
  /** Base radius of the land, in half-grid units. */
  readonly landRadius: number;
  /** How far the outline is warped: low-frequency headlands and coves. */
  readonly coastWarp: number;
  /** Fine wobble of the coastline. */
  readonly coastNoise: number;
  /** Width of the shallow shelf, in cells. */
  readonly shelf: number;
  /** Shallow coves carved into the coast. */
  readonly lagoons: number;
  readonly lagoonSize: number;
  /** Shallow ponds inland. */
  readonly ponds: number;
  /** Shallow reef patches past the shelf. */
  readonly reefs: boolean;
  readonly sites: Partial<Record<IslandSiteKind, number>>;
}

const RECIPES_V2: Record<IslandElement, RecipeV2> = {
  THO: { landRadius: 0.76, coastWarp: 0.1, coastNoise: 0.05, shelf: 3, lagoons: 0, lagoonSize: 0, ponds: 1, reefs: false, sites: { DOCK: 1, CAMP: 1, ORE: 3, TREE: 30, FISH_BAY: 2, FISHING: 3 } },
  KIM: { landRadius: 0.74, coastWarp: 0.14, coastNoise: 0.07, shelf: 2, lagoons: 0, lagoonSize: 0, ponds: 0, reefs: false, sites: { DOCK: 1, CAMP: 1, ORE: 6, TREE: 18, FISH_BAY: 2, FISHING: 3 } },
  MOC: { landRadius: 0.76, coastWarp: 0.12, coastNoise: 0.06, shelf: 3, lagoons: 0, lagoonSize: 0, ponds: 1, reefs: false, sites: { DOCK: 1, CAMP: 1, ORE: 3, TREE: 140, FISH_BAY: 2, FISHING: 3 } },
  THUY: { landRadius: 0.66, coastWarp: 0.16, coastNoise: 0.07, shelf: 6, lagoons: 5, lagoonSize: 0.13, ponds: 2, reefs: true, sites: { DOCK: 1, CAMP: 1, ORE: 3, TREE: 24, FISH_BAY: 10, FISHING: 8 } },
  HOA: { landRadius: 0.78, coastWarp: 0.1, coastNoise: 0.05, shelf: 3, lagoons: 0, lagoonSize: 0, ponds: 0, reefs: false, sites: { DOCK: 1, CAMP: 1, ORE: 3, TREE: 14, PASTURE: 6, FISH_BAY: 2, FISHING: 3 } }
};

/** Open sea kept round every island so it never touches the grid's edge. */
const MARGIN_CELLS = 4;
const FAR = 1e6;

const NEIGHBOURS_4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Two-pass chamfer distance (1 / √2) from every cell to the nearest cell where `source` holds. */
function distanceFrom(size: number, source: (index: number) => boolean): Float32Array {
  const total = size * size;
  const d = new Float32Array(total);
  for (let index = 0; index < total; index += 1) d[index] = source(index) ? 0 : FAR;
  const diagonal = Math.SQRT2;
  // Inlined relaxations: this runs several times per island, and a closure per neighbour was the
  // single largest cost of generation.
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const index = row + x;
      let best = d[index] as number;
      if (best === 0) continue;
      if (x > 0) best = Math.min(best, (d[index - 1] as number) + 1);
      if (y > 0) {
        best = Math.min(best, (d[index - size] as number) + 1);
        if (x > 0) best = Math.min(best, (d[index - size - 1] as number) + diagonal);
        if (x < size - 1) best = Math.min(best, (d[index - size + 1] as number) + diagonal);
      }
      d[index] = best;
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    const row = y * size;
    for (let x = size - 1; x >= 0; x -= 1) {
      const index = row + x;
      let best = d[index] as number;
      if (best === 0) continue;
      if (x < size - 1) best = Math.min(best, (d[index + 1] as number) + 1);
      if (y < size - 1) {
        best = Math.min(best, (d[index + size] as number) + 1);
        if (x < size - 1) best = Math.min(best, (d[index + size + 1] as number) + diagonal);
        if (x > 0) best = Math.min(best, (d[index + size - 1] as number) + diagonal);
      }
      d[index] = best;
    }
  }
  return d;
}

/** 4-connected components of the cells where `member` holds: a label per cell (-1 outside) and sizes. */
function components(size: number, member: (index: number) => boolean): { readonly label: Int32Array; readonly sizes: number[] } {
  const total = size * size;
  const inside = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) inside[index] = member(index) ? 1 : 0;
  const label = new Int32Array(total).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start += 1) {
    if (label[start] !== -1 || inside[start] === 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const index = queue[head++] as number;
      const x = index % size;
      if (x > 0 && inside[index - 1] === 1 && label[index - 1] === -1) { label[index - 1] = id; queue[tail++] = index - 1; }
      if (x < size - 1 && inside[index + 1] === 1 && label[index + 1] === -1) { label[index + 1] = id; queue[tail++] = index + 1; }
      if (index >= size && inside[index - size] === 1 && label[index - size] === -1) { label[index - size] = id; queue[tail++] = index - size; }
      if (index < total - size && inside[index + size] === 1 && label[index + size] === -1) { label[index + size] = id; queue[tail++] = index + size; }
    }
    sizes.push(tail);
  }
  return { label, sizes };
}

/**
 * A smooth noise sampled on a coarse lattice and interpolated to every cell. Every noise this generator
 * reads changes slowly across cells, so this is the same picture at a fraction of the evaluations -
 * which is what keeps generation inside a Worker's CPU budget.
 */
function noiseField(size: number, step: number, sample: (x: number, y: number) => number): Float32Array {
  const lattice = Math.ceil((size - 1) / step) + 2;
  const values = new Float32Array(lattice * lattice);
  for (let ly = 0; ly < lattice; ly += 1) for (let lx = 0; lx < lattice; lx += 1) values[ly * lattice + lx] = sample(lx * step, ly * step);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const fy = y / step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < size; x += 1) {
      const fx = x / step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = values[y0 * lattice + x0] as number;
      const b = values[y0 * lattice + x0 + 1] as number;
      const c = values[(y0 + 1) * lattice + x0] as number;
      const d = values[(y0 + 1) * lattice + x0 + 1] as number;
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

/** One 3x3 majority pass over a mask: rounds corners, removes slivers and pinholes. */
function majority(mask: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x;
      const count =
        (mask[index - size - 1] as number) + (mask[index - size] as number) + (mask[index - size + 1] as number) +
        (mask[index - 1] as number) + (mask[index] as number) + (mask[index + 1] as number) +
        (mask[index + size - 1] as number) + (mask[index + size] as number) + (mask[index + size + 1] as number);
      out[index] = count >= 5 ? 1 : 0;
    }
  }
  return out;
}

/** Inside the outline? The outline picks the silhouette; the element's recipe shapes its coast. */
function insideOutline(
  outline: IslandOutline,
  wx: number,
  wy: number,
  rx: number,
  ry: number,
  radius: number,
  edge: number,
  islets: readonly { readonly x: number; readonly y: number; readonly r: number }[]
): boolean {
  const round = Math.hypot(wx, wy);
  switch (outline) {
    case "ROUND":
      return round < radius * edge;
    case "LONG":
      return Math.hypot(rx * 0.72, ry * 1.5) < radius * edge;
    case "CRESCENT":
      return round < radius * edge && Math.hypot(rx - radius * 0.62, ry) > radius * 0.6 * (2 - edge);
    case "TWIN":
      return Math.min(Math.hypot(rx - radius * 0.52, ry * 1.08), Math.hypot(rx + radius * 0.52, ry * 1.08)) < radius * 0.56 * edge;
    case "ATOLL":
      return round < radius * edge;
    case "ARCHIPELAGO":
      return round < radius * 0.58 * edge || islets.some((islet) => Math.hypot(wx - islet.x, wy - islet.y) < islet.r * edge);
  }
}

/**
 * How much of the dry interior each biome takes, per element. Thresholds are read as quantiles of the
 * island's own noise, so every seed gets the same proportions - a Kim island is always about a third
 * rock, never a bald dome on one seed and a pebble on the next.
 */
interface BiomeShares {
  /** Highest relief turned to bare rock (Kim's massif, Hỏa's ridge). */
  readonly rock: number;
  /** Highest patch noise turned to forest. */
  readonly forest: number;
  /** Lowest patch noise turned to the element's open biome (fields for Thổ, meadows for Thủy). */
  readonly open: number;
}

const BIOME_SHARES: Record<IslandElement, BiomeShares> = {
  THO: { rock: 0, forest: 0.1, open: 0.4 },
  KIM: { rock: 0.3, forest: 0.1, open: 0 },
  MOC: { rock: 0, forest: 0.72, open: 0 },
  THUY: { rock: 0, forest: 0.14, open: 0.26 },
  HOA: { rock: 0.07, forest: 0.08, open: 0 }
};

/** The value below which `share` of an already-sorted sample lies (a quantile). */
function quantileOf(sorted: Float32Array, share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))] as number;
}

function landBiome(element: IslandElement, n: number, e: number, cut: { readonly rock: number; readonly forest: number; readonly open: number }): IslandCellKind {
  if (e >= cut.rock) return "ROCK";
  if (n >= cut.forest) return "FOREST";
  if (n <= cut.open) return element === "THO" ? "FIELD" : "MEADOW";
  return element === "HOA" ? "MEADOW" : "GRASS";
}

const DEFAULT_OUTLINE: IslandOutline = "ROUND";

export function generateIslandV2(element: IslandElement, seed: number, size = 96, outline: IslandOutline = DEFAULT_OUTLINE): GeneratedIsland {
  const recipe = RECIPES_V2[element];
  const random = rng(seed ^ 0x51ed270b);
  const turn = random() * Math.PI * 2;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const radius = recipe.landRadius;
  const isletCount = 3 + Math.floor(random() * 3);
  const islets = outline === "ARCHIPELAGO"
    ? Array.from({ length: isletCount }, (_, index) => {
        const angle = turn + (index / isletCount) * Math.PI * 2 + (random() - 0.5) * 0.6;
        const distance = radius * (0.72 + random() * 0.14);
        return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: radius * (0.2 + random() * 0.1) };
      })
    : [];
  const half = size / 2;
  const total = size * size;
  const inGrid = (x: number, y: number): boolean => x >= MARGIN_CELLS && y >= MARGIN_CELLS && x < size - MARGIN_CELLS && y < size - MARGIN_CELLS;

  const edgeNoise = noiseField(size, 2, (x, y) => fbm(seed + 303, x / 15 + 19, y / 15 + 23, 2));
  // 1. The silhouette: a warped outline with a fine coastal wobble.
  let land: Uint8Array = new Uint8Array(total);
  const lagoon = new Uint8Array(total);
  // The warp is low-frequency, so it is sampled on a coarse lattice and interpolated: the same shape
  // at a sixteenth of the noise evaluations.
  const step = 4;
  const lattice = Math.ceil(size / step) + 1;
  const warpX = new Float32Array(lattice * lattice);
  const warpY = new Float32Array(lattice * lattice);
  for (let ly = 0; ly < lattice; ly += 1) {
    for (let lx = 0; lx < lattice; lx += 1) {
      const dx = (lx * step + 0.5 - half) / half;
      const dy = (ly * step + 0.5 - half) / half;
      warpX[ly * lattice + lx] = recipe.coastWarp * (fbm(seed + 101, dx * 1.7 + 3.1, dy * 1.7 + 7.3, 3) - 0.5) * 2;
      warpY[ly * lattice + lx] = recipe.coastWarp * (fbm(seed + 202, dx * 1.7 + 11.7, dy * 1.7 + 5.9, 3) - 0.5) * 2;
    }
  }
  const warpAt = (values: Float32Array, x: number, y: number): number => {
    const fx = x / step;
    const fy = y / step;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = values[y0 * lattice + x0] as number;
    const b = values[y0 * lattice + x0 + 1] as number;
    const c = values[(y0 + 1) * lattice + x0] as number;
    const d = values[(y0 + 1) * lattice + x0 + 1] as number;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inGrid(x, y)) continue;
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      // Nothing of any outline reaches past this: open sea without asking the outline.
      if (dx * dx + dy * dy > 1.3 && outline !== "ATOLL") continue;
      const wx = dx + warpAt(warpX, x, y);
      const wy = dy + warpAt(warpY, x, y);
      const rx = wx * cos + wy * sin;
      const ry = -wx * sin + wy * cos;
      const index = y * size + x;
      const edge = 1 + recipe.coastNoise * ((edgeNoise[index] as number) - 0.5) * 2;
      if (outline === "ATOLL" && Math.hypot(wx, wy) < radius * 0.5 * (2 - edge)) {
        lagoon[index] = 1;
        continue;
      }
      land[index] = insideOutline(outline, wx, wy, rx, ry, radius, edge, islets) ? 1 : 0;
    }
  }

  // 2. Cleanup: round slivers away, drop specks, fill pinholes.
  land = majority(majority(land, size), size);
  const landParts = components(size, (index) => land[index] === 1);
  for (let index = 0; index < total; index += 1) {
    const id = landParts.label[index] ?? -1;
    if (id >= 0 && (landParts.sizes[id] ?? 0) < 24) land[index] = 0;
  }
  const waterParts = components(size, (index) => land[index] === 0 && lagoon[index] === 0);
  const openSea = waterParts.label[0] ?? -1;
  for (let index = 0; index < total; index += 1) {
    const id = waterParts.label[index] ?? -1;
    if (id >= 0 && id !== openSea && (waterParts.sizes[id] ?? 0) < 16) land[index] = 1;
  }

  // 3. Shallow coves (Thủy): carved into the coast, so the land stays joined round their heads.
  if (recipe.lagoons > 0) {
    for (let k = 0; k < recipe.lagoons; k += 1) {
      const angle = turn + (k / recipe.lagoons) * Math.PI * 2 + (random() - 0.5) * 0.7;
      // Walk outward from the middle to the last land cell on this bearing: that is the coast.
      let coastX = half;
      let coastY = half;
      for (let step = 0; step < half; step += 0.5) {
        const px = Math.round(half + Math.cos(angle) * step);
        const py = Math.round(half + Math.sin(angle) * step);
        if (px < 0 || py < 0 || px >= size || py >= size) break;
        if (land[py * size + px] === 1) {
          coastX = px;
          coastY = py;
        }
      }
      const cove = recipe.lagoonSize * half * (0.8 + random() * 0.4);
      const centreX = coastX - Math.cos(angle) * cove * 0.35;
      const centreY = coastY - Math.sin(angle) * cove * 0.35;
      for (let y = Math.max(0, Math.floor(centreY - cove - 2)); y <= Math.min(size - 1, Math.ceil(centreY + cove + 2)); y += 1) {
        for (let x = Math.max(0, Math.floor(centreX - cove - 2)); x <= Math.min(size - 1, Math.ceil(centreX + cove + 2)); x += 1) {
          const wobble = 1 + (fbm(seed + 909 + k, x / 4, y / 4, 2) - 0.5) * 0.5;
          if (Math.hypot(x - centreX, y - centreY) < cove * wobble) {
            const index = y * size + x;
            if (land[index] === 1) {
              land[index] = 0;
              lagoon[index] = 1;
            }
          }
        }
      }
    }
  }

  // 4. Ponds inland, where the ground is deep enough to hold one.
  let inland = distanceFrom(size, (index) => land[index] !== 1);
  if (recipe.ponds > 0) {
    const candidates: number[] = [];
    for (let index = 0; index < total; index += 1) if ((inland[index] ?? 0) >= 8) candidates.push(index);
    candidates.sort((a, b) => hash2(seed + 1111, a % size, Math.floor(a / size)) - hash2(seed + 1111, b % size, Math.floor(b / size)));
    const placed: number[] = [];
    for (const index of candidates) {
      if (placed.length >= recipe.ponds) break;
      const x = index % size;
      const y = Math.floor(index / size);
      if (placed.some((other) => Math.hypot((other % size) - x, Math.floor(other / size) - y) < 14)) continue;
      placed.push(index);
      const pond = 2 + hash2(seed + 1212, x, y) * 1.6;
      for (let py = y - 4; py <= y + 4; py += 1) {
        for (let px = x - 4; px <= x + 4; px += 1) {
          if (Math.hypot(px - x, py - y) <= pond && px >= 0 && py >= 0 && px < size && py < size) {
            land[py * size + px] = 0;
            lagoon[py * size + px] = 1;
          }
        }
      }
    }
    inland = distanceFrom(size, (index) => land[index] !== 1);
  }

  // 5. Water: the shelf (and coves, ponds, the atoll's lagoon) is shallow; past it, deep.
  const toLand = distanceFrom(size, (index) => land[index] === 1);
  const shelfNoise = noiseField(size, 3, (x, y) => fbm(seed + 404, x / 6, y / 6, 2));
  const reefNoise = recipe.reefs ? noiseField(size, 3, (x, y) => fbm(seed + 505, x / 5, y / 5, 2)) : null;
  const cells: IslandCellKind[] = new Array<IslandCellKind>(total).fill("DEEP");
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (land[index] === 1) continue;
      if (x < MARGIN_CELLS - 1 || y < MARGIN_CELLS - 1 || x >= size - MARGIN_CELLS + 1 || y >= size - MARGIN_CELLS + 1) continue;
      const distance = toLand[index] ?? FAR;
      if (lagoon[index] === 1) {
        cells[index] = "SHALLOW";
        continue;
      }
      if (distance > recipe.shelf * 2.4 + 2) continue;
      const shelf = recipe.shelf + ((shelfNoise[index] as number) - 0.5) * 2.4;
      if (distance <= shelf) cells[index] = "SHALLOW";
      else if (reefNoise !== null && distance <= recipe.shelf * 2.4 && (reefNoise[index] as number) > 0.6) cells[index] = "SHALLOW";
    }
  }

  // The shelf's edge, smoothed: a thread of shallows poking into the deep (or a notch of deep in the
  // shelf) is noise, not a feature. Coves, ponds and lagoons are left exactly as carved.
  const shallowMask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) shallowMask[index] = land[index] === 1 || cells[index] === "SHALLOW" ? 1 : 0;
  const smoothed = majority(shallowMask, size);
  for (let index = 0; index < total; index += 1) {
    if (land[index] === 1 || lagoon[index] === 1) continue;
    if (cells[index] === "SHALLOW" && smoothed[index] === 0) cells[index] = "DEEP";
    else if (cells[index] === "DEEP" && smoothed[index] === 1 && (toLand[index] ?? FAR) <= recipe.shelf * 2.4) cells[index] = "SHALLOW";
    // Whatever the noise did, the water touching the land is wadeable: no beach drops into the deep.
    if ((toLand[index] ?? FAR) <= 1.5 && cells[index] === "DEEP") cells[index] = "SHALLOW";
  }

  // 6. Land: a beach band, then the element's biomes in broad patches.
  const beachNoise = noiseField(size, 3, (x, y) => fbm(seed + 606, x / 5, y / 5, 2));
  const patchNoise = noiseField(size, 4, (x, y) => fbm(seed + 707, x / 13, y / 13, 3));
  const reliefNoise = noiseField(size, 4, (x, y) => fbm(seed + 808, x / 17, y / 17, 3));
  const interior: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (land[index] !== 1) continue;
    const depth = inland[index] ?? 0;
    const beach = 1.2 + (beachNoise[index] as number) * 1.4;
    if (depth <= beach) cells[index] = "SAND";
    else interior.push(index);
  }
  // Relief rises a little inland, so rock gathers in the middle of a massif rather than on a beach;
  // Hỏa's ridge follows the relief alone, so it stays a spine.
  const reliefLift = element === "HOA" ? 0 : 0.3;
  const relief = new Float32Array(interior.length);
  const patch = new Float32Array(interior.length);
  interior.forEach((index, k) => {
    relief[k] = (reliefNoise[index] as number) + Math.min(1, (inland[index] ?? 0) / 14) * reliefLift;
    patch[k] = patchNoise[index] as number;
  });
  const shares = BIOME_SHARES[element];
  const sortedRelief = shares.rock > 0 && relief.length > 0 ? Float32Array.from(relief).sort() : null;
  const sortedPatch = (shares.forest > 0 || shares.open > 0) && patch.length > 0 ? Float32Array.from(patch).sort() : null;
  const cut = {
    rock: sortedRelief === null ? Number.POSITIVE_INFINITY : quantileOf(sortedRelief, 1 - shares.rock),
    forest: sortedPatch === null || shares.forest <= 0 ? Number.POSITIVE_INFINITY : quantileOf(sortedPatch, 1 - shares.forest),
    open: sortedPatch === null || shares.open <= 0 ? Number.NEGATIVE_INFINITY : quantileOf(sortedPatch, shares.open)
  };
  interior.forEach((index, k) => {
    // Mộc's deep interior is old forest whatever the noise says: its landmark.
    if (element === "MOC" && (inland[index] ?? 0) > 9) cells[index] = "FOREST";
    else cells[index] = landBiome(element, patch[k] as number, relief[k] as number, cut);
  });
  // One mode pass over the biomes, so a lone cell of forest in a field reads as noise and goes.
  const BIOMES: readonly IslandCellKind[] = ["GRASS", "FOREST", "ROCK", "MEADOW", "FIELD"];
  const biomeIndex = (kind: IslandCellKind | undefined): number => (kind === undefined ? -1 : BIOMES.indexOf(kind));
  const biome = new Int8Array(total);
  for (let index = 0; index < total; index += 1) biome[index] = biomeIndex(cells[index]);
  const counts = new Int32Array(BIOMES.length);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x;
      const own = biome[index] as number;
      if (own < 0) continue;
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbour = biome[index + dy * size + dx] as number;
          if (neighbour >= 0) counts[neighbour] = (counts[neighbour] as number) + 1;
        }
      }
      if ((counts[own] as number) > 2) continue;
      let best = own;
      for (let candidate = 0; candidate < BIOMES.length; candidate += 1) if ((counts[candidate] as number) > (counts[best] as number)) best = candidate;
      if ((counts[best] as number) >= 5) cells[index] = BIOMES[best] as IslandCellKind;
    }
  }

  // 7. Connectivity: everything walkable joins the main island, through a reef path if it must.
  connectWalkable(cells, size);

  return { element, outline, seed, size, cells, sites: placeSitesV2(element, seed, size, cells, recipe, inland) };
}

/**
 * Joins every walkable region (land or shallows) to the largest one by turning the shortest run of deep
 * water between them into shallows. Fragments too small to be worth a path are sunk instead.
 */
function connectWalkable(cells: IslandCellKind[], size: number): void {
  const walkable = (index: number): boolean => cells[index] !== "DEEP";
  const parts = components(size, walkable);
  if (parts.sizes.length <= 1) return;
  let main = 0;
  parts.sizes.forEach((count, id) => { if (count > (parts.sizes[main] ?? 0)) main = id; });
  const joined = new Uint8Array(parts.sizes.length);
  joined[main] = 1;
  const parent = new Int32Array(size * size);
  const queue = new Int32Array(size * size);
  for (let id = 0; id < parts.sizes.length; id += 1) {
    if (joined[id] === 1) continue;
    let hasLand = false;
    for (let index = 0; index < cells.length && !hasLand; index += 1) {
      if (parts.label[index] === id && cells[index] !== "SHALLOW") hasLand = true;
    }
    // A reef patch or a speck with no land is not worth a path: it sinks.
    if ((parts.sizes[id] ?? 0) < 6 || !hasLand) {
      for (let index = 0; index < cells.length; index += 1) if (parts.label[index] === id) cells[index] = "DEEP";
      continue;
    }
    // Breadth-first from the whole fragment through deep water until something already joined.
    parent.fill(-2);
    let head = 0;
    let tail = 0;
    for (let index = 0; index < cells.length; index += 1) {
      if (parts.label[index] === id) {
        parent[index] = -1;
        queue[tail++] = index;
      }
    }
    let reached = -1;
    while (head < tail && reached < 0) {
      const index = queue[head++] ?? 0;
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of NEIGHBOURS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1) continue;
        const next = ny * size + nx;
        if (parent[next] !== -2) continue;
        parent[next] = index;
        const label = parts.label[next] ?? -1;
        if (label >= 0 && joined[label] === 1) {
          reached = next;
          break;
        }
        if (cells[next] === "DEEP") queue[tail++] = next;
      }
    }
    if (reached < 0) continue;
    // The path is three cells wide - a reef causeway a player can actually walk, not a thread.
    for (let step = parent[reached] ?? -1; step >= 0 && parts.label[step] !== id; step = parent[step] ?? -1) {
      const x = step % size;
      const y = (step - x) / size;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1) continue;
          if (cells[ny * size + nx] === "DEEP") cells[ny * size + nx] = "SHALLOW";
        }
      }
    }
    joined[id] = 1;
  }
}

const OPEN_GROUND: ReadonlySet<IslandCellKind> = new Set(["GRASS", "MEADOW", "FIELD", "FOREST"]);

/**
 * `inland` is the generator's own distance-to-water, passed through: connecting fragments only turns
 * deep water shallow (or sinks specks far from the main island), so it still holds where sites go.
 */
function placeSitesV2(element: IslandElement, seed: number, size: number, cells: IslandCellKind[], recipe: RecipeV2, inland: Float32Array): IslandSite[] {
  const total = size * size;
  const isWater = (kind: IslandCellKind | undefined): boolean => kind === undefined || kind === "DEEP" || kind === "SHALLOW";
  const toDeep = distanceFrom(size, (index) => cells[index] === "DEEP");
  const toWalkable = distanceFrom(size, (index) => cells[index] !== "DEEP");
  const sites: IslandSite[] = [];
  const at = (x: number, y: number): IslandCellKind | undefined => (x >= 0 && y >= 0 && x < size && y < size ? cells[y * size + x] : undefined);
  const landAround = summedArea(size, (index) => !isWater(cells[index]));
  const rockAround = summedArea(size, (index) => cells[index] === "ROCK");

  // Centre of the land, so the camp sits near the middle of the island rather than on a far headland.
  let sumX = 0;
  let sumY = 0;
  let landCells = 0;
  for (let index = 0; index < total; index += 1) {
    if (isWater(cells[index])) continue;
    sumX += index % size;
    sumY += Math.floor(index / size);
    landCells += 1;
  }
  const centreX = landCells === 0 ? size / 2 : sumX / landCells;
  const centreY = landCells === 0 ? size / 2 : sumY / landCells;

  // Camp: the best open, level cell well inland, near the middle.
  let camp = -1;
  let campScore = -FAR;
  for (let index = 0; index < total; index += 1) {
    const x = index % size;
    const y = Math.floor(index / size);
    const kind = cells[index];
    if (kind === undefined || !OPEN_GROUND.has(kind) || landAround(x, y, 3) < 49 || rockAround(x, y, 3) > 0) continue;
    const depth = Math.min(inland[index] ?? 0, 9);
    const score = depth - Math.hypot(x - centreX, y - centreY) * 0.35 + hash2(seed + 1313, x, y) * 0.5;
    if (score > campScore) {
      campScore = score;
      camp = index;
    }
  }
  if (camp < 0) {
    // A tiny island: the deepest dry cell will do.
    for (let index = 0; index < total; index += 1) if (!isWater(cells[index]) && (camp < 0 || (inland[index] ?? 0) > (inland[camp] ?? 0))) camp = index;
  }
  const campX = camp % size;
  const campY = Math.floor(camp / size);
  if (camp >= 0) {
    // Clear the camp: open ground in a small square, whatever the forest or the rock wanted there.
    const clearing: IslandCellKind = element === "HOA" ? "MEADOW" : "GRASS";
    for (let y = campY - 3; y <= campY + 3; y += 1) {
      for (let x = campX - 3; x <= campX + 3; x += 1) {
        const kind = at(x, y);
        if (kind === "FOREST" || kind === "ROCK" || kind === "FIELD") cells[y * size + x] = clearing;
      }
    }
    sites.push({ kind: "CAMP", x: campX, y: campY });
  }

  // Dock: on the beach, with shallows beside it and deep water close by, as near the camp as possible.
  let dock = -1;
  let dockScore = FAR;
  for (let index = 0; index < total; index += 1) {
    if (cells[index] !== "SAND" || (toDeep[index] ?? FAR) > recipe.shelf + 3) continue;
    const x = index % size;
    const y = Math.floor(index / size);
    if (!NEIGHBOURS_4.some(([dx, dy]) => at(x + dx, y + dy) === "SHALLOW")) continue;
    const score = Math.hypot(x - campX, y - campY) + (toDeep[index] ?? 0) * 0.5 + hash2(seed + 1414, x, y) * 0.5;
    if (score < dockScore) {
      dockScore = score;
      dock = index;
    }
  }
  if (dock >= 0) sites.push({ kind: "DOCK", x: dock % size, y: Math.floor(dock / size) });
  const dockX = dock < 0 ? -FAR : dock % size;
  const dockY = dock < 0 ? -FAR : Math.floor(dock / size);

  // Everything else: candidates in a seeded order, accepted greedily under a spacing rule.
  const bucketSize = 8;
  const buckets = new Map<number, IslandSite[]>();
  const bucketKey = (bx: number, by: number): number => by * 1024 + bx;
  const remember = (site: IslandSite): void => {
    sites.push(site);
    const key = bucketKey(Math.floor(site.x / bucketSize), Math.floor(site.y / bucketSize));
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [site]);
    else bucket.push(site);
  };
  const clear = (x: number, y: number, spacing: number, of: (kind: IslandSiteKind) => boolean): boolean => {
    const reach = Math.ceil(spacing / bucketSize);
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    for (let oy = -reach; oy <= reach; oy += 1) {
      for (let ox = -reach; ox <= reach; ox += 1) {
        for (const site of buckets.get(bucketKey(bx + ox, by + oy)) ?? []) {
          if (of(site.kind) && Math.hypot(site.x - x, site.y - y) < spacing) return false;
        }
      }
    }
    return true;
  };
  const away = (x: number, y: number, fromCamp: number, fromDock: number): boolean => {
    const cx = x - campX;
    const cy = y - campY;
    const dx = x - dockX;
    const dy = y - dockY;
    return cx * cx + cy * cy >= fromCamp * fromCamp && dx * dx + dy * dy >= fromDock * fromDock;
  };
  const sameOrOre = (kind: IslandSiteKind) => (other: IslandSiteKind): boolean => other === kind || other === "ORE";
  /**
   * Accepts candidates greedily in a seeded order. The order is a numeric sort of `roll * 2^20 * 2^14 +
   * index` - one native typed-array sort, no comparator - and only cells of the listed kinds are asked.
   */
  const pick = (kind: IslandSiteKind, count: number, salt: number, spacing: number, kinds: readonly IslandCellKind[], accepts: (index: number, x: number, y: number) => boolean): void => {
    if (count <= 0) return;
    const keys: number[] = [];
    for (let index = 0; index < total; index += 1) {
      const cell = cells[index];
      if (cell === undefined || !kinds.includes(cell)) continue;
      const x = index % size;
      const y = (index - x) / size;
      if (!accepts(index, x, y)) continue;
      keys.push(Math.floor(hash2(seed + salt, x, y) * 1048576) * 16384 + index);
    }
    const order = Float64Array.from(keys).sort();
    const of = sameOrOre(kind);
    let placed = 0;
    for (const key of order) {
      if (placed >= count) break;
      const index = key % 16384;
      const x = index % size;
      const y = (index - x) / size;
      if (!clear(x, y, spacing, of)) continue;
      remember({ kind, x, y });
      placed += 1;
    }
  };
  const solid = (x: number, y: number, r: number): boolean => landAround(x, y, r) === (2 * r + 1) * (2 * r + 1);
  const DRY: readonly IslandCellKind[] = ["GRASS", "FOREST", "ROCK", "MEADOW", "FIELD"];

  const oreCount = recipe.sites.ORE ?? 0;
  pick("ORE", oreCount, 1515, element === "KIM" ? 6 : 8, element === "KIM" ? ["ROCK"] : DRY, (_, x, y) => solid(x, y, 2) && away(x, y, 7, 6));
  const oresPlaced = sites.filter((site) => site.kind === "ORE").length;
  if (oresPlaced < oreCount) {
    // Not enough rock for every Kim slot: the rest go on solid ground, still well apart.
    pick("ORE", oreCount - oresPlaced, 1616, 6, DRY, (_, x, y) => solid(x, y, 2) && away(x, y, 7, 6));
  }
  // A mine's yard keeps trees off it.
  const oreYard = new Uint8Array(total);
  for (const site of sites) {
    if (site.kind !== "ORE") continue;
    for (let y = Math.max(0, site.y - 3); y <= Math.min(size - 1, site.y + 3); y += 1) {
      for (let x = Math.max(0, site.x - 3); x <= Math.min(size - 1, site.x + 3); x += 1) oreYard[y * size + x] = 1;
    }
  }
  pick("PASTURE", recipe.sites.PASTURE ?? 0, 1717, 9, ["MEADOW"], (_, x, y) => solid(x, y, 3) && away(x, y, 6, 5));
  // A sheltered bay: shallows mostly wrapped by land, where a cage sits out of the weather.
  pick("FISH_BAY", recipe.sites.FISH_BAY ?? 0, 1818, 7, ["SHALLOW"], (_, x, y) => landAround(x, y, 4) >= 22 && away(x, y, 0, 5));
  const baysPlaced = sites.filter((site) => site.kind === "FISH_BAY").length;
  if (baysPlaced < (recipe.sites.FISH_BAY ?? 0)) {
    pick("FISH_BAY", (recipe.sites.FISH_BAY ?? 0) - baysPlaced, 1919, 6, ["SHALLOW"], (_, x, y) => landAround(x, y, 3) >= 6 && away(x, y, 0, 5));
  }
  // Fishing: deep water one or two cells off the shelf, so a line cast from the shallows reaches it.
  pick("FISHING", recipe.sites.FISHING ?? 0, 2020, element === "THUY" ? 9 : 12, ["DEEP"], (index, x, y) => {
    const distance = toWalkable[index] ?? FAR;
    return distance >= 1 && distance <= 2.5 && away(x, y, 0, 6);
  });
  pick("TREE", recipe.sites.TREE ?? 0, 2121, 2.2, element === "MOC" ? ["FOREST"] : ["FOREST", "GRASS", "MEADOW"], (index, x, y) =>
    oreYard[index] === 0 && (cells[index] === "FOREST" || hash2(seed + 2222, x, y) < 0.15) && away(x, y, 4.5, 3.5));
  return sites;
}
