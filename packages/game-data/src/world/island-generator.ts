/**
 * Deterministic island generator, one recipe per element (Ngũ Hành).
 *
 * The same `{ element, seed, outline }` always yields the same island, so the picker can preview an
 * island in the browser and the server can build exactly that island when the farm is created. The
 * server *stores* what it built (`island-ground.ts`); a stored island never depends on this code
 * again. Tuning a recipe here is therefore safe for existing farms, but it changes what new templates
 * produce, so it must bump `ISLAND_GENERATOR_VERSION`. Pure: no randomness source but the seed.
 */

export const ISLAND_ELEMENTS = ["THO", "KIM", "MOC", "THUY", "HOA"] as const;
export type IslandElement = (typeof ISLAND_ELEMENTS)[number];

/** The overall outline a player picks; the element decides what grows on it. */
export const ISLAND_OUTLINES = ["ROUND", "LONG", "CRESCENT", "TWIN", "ATOLL", "ARCHIPELAGO"] as const;
export type IslandOutline = (typeof ISLAND_OUTLINES)[number];

export type IslandCellKind = "DEEP" | "SHALLOW" | "SAND" | "GRASS" | "FOREST" | "ROCK" | "MEADOW" | "FIELD";
/**
 * What a site marks. `FISH_BAY` is sheltered shallow water (aquaculture); `FISHING` (generator v2) is
 * deep water just off the shallow shelf, where a player standing at the shelf's edge casts a line.
 */
export type IslandSiteKind = "ORE" | "TREE" | "FISH_BAY" | "FISHING" | "PASTURE" | "DOCK" | "CAMP";

export interface IslandSite {
  readonly kind: IslandSiteKind;
  readonly x: number;
  readonly y: number;
}

export interface GeneratedIsland {
  readonly element: IslandElement;
  readonly outline: IslandOutline;
  readonly seed: number;
  readonly size: number;
  /** Row-major cell kinds, `size * size` long. */
  readonly cells: readonly IslandCellKind[];
  readonly sites: readonly IslandSite[];
}

interface Recipe {
  /** How far the coast may wander from a circle (0 = round). */
  readonly roughness: number;
  /** Noise scale of the coastline wobble: higher = more, smaller bays and headlands. */
  readonly coastFrequency: number;
  /** Bays cut into the coast. */
  readonly bays: number;
  readonly bayDepth: number;
  readonly landRadius: number;
  readonly sites: Partial<Record<IslandSiteKind, number>>;
}

const RECIPES: Record<IslandElement, Recipe> = {
  THO: { roughness: 0.1, coastFrequency: 2.2, bays: 1, bayDepth: 0.25, landRadius: 0.78, sites: { DOCK: 1, CAMP: 1, ORE: 2, TREE: 30 } },
  KIM: { roughness: 0.2, coastFrequency: 3, bays: 2, bayDepth: 0.3, landRadius: 0.74, sites: { DOCK: 1, CAMP: 1, ORE: 6, TREE: 18 } },
  MOC: { roughness: 0.14, coastFrequency: 2.6, bays: 2, bayDepth: 0.3, landRadius: 0.78, sites: { DOCK: 1, CAMP: 1, ORE: 1, TREE: 140 } },
  THUY: { roughness: 0.3, coastFrequency: 6, bays: 7, bayDepth: 0.75, landRadius: 0.82, sites: { DOCK: 1, CAMP: 1, ORE: 1, TREE: 24, FISH_BAY: 10 } },
  HOA: { roughness: 0.12, coastFrequency: 2.2, bays: 1, bayDepth: 0.22, landRadius: 0.8, sites: { DOCK: 1, CAMP: 1, ORE: 1, TREE: 14, PASTURE: 6 } }
};

/** mulberry32: tiny, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function noise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * noise(seed + octave * 1013, x * frequency, y * frequency);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum;
}

function angleDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/**
 * Distance from the island's "centre" in the same units as the plain radial distance, so every
 * shape reuses one coastline rule. `null` marks water carved out by the shape itself (a crescent's
 * bite, an atoll's lagoon).
 */
function outlineDistance(outline: IslandOutline, dx: number, dy: number, turn: number, landRadius: number, islets: readonly { x: number; y: number; r: number }[]): number | "LAGOON" | null {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  const round = Math.hypot(dx, dy);
  switch (outline) {
    case "ROUND": return round;
    case "LONG": return Math.hypot(rx * 0.8, ry * 1.55);
    case "TWIN": return Math.min(Math.hypot(rx - 0.4, ry * 1.1), Math.hypot(rx + 0.4, ry * 1.1)) * 1.75;
    case "CRESCENT": return Math.hypot(rx - 0.42, ry) < landRadius * 0.7 ? null : round;
    case "ATOLL": return round < landRadius * 0.55 ? "LAGOON" : round;
    case "ARCHIPELAGO": {
      let best = round * 1.7;
      for (const islet of islets) best = Math.min(best, (Math.hypot(dx - islet.x, dy - islet.y) / islet.r) * landRadius);
      return best;
    }
  }
}

const DEFAULT_OUTLINE: Record<IslandElement, IslandOutline> = { THO: "ROUND", KIM: "ROUND", MOC: "ROUND", THUY: "ROUND", HOA: "ROUND" };

export function generateIsland(element: IslandElement, seed: number, size = 96, outline: IslandOutline = DEFAULT_OUTLINE[element]): GeneratedIsland {
  const recipe = RECIPES[element];
  const random = rng(seed);
  const turn = random() * Math.PI * 2;
  const islets = Array.from({ length: 3 + Math.floor(random() * 3) }, () => {
    const angle = random() * Math.PI * 2;
    const distance = 0.55 + random() * 0.25;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: 0.12 + random() * 0.1 };
  });
  const bays = Array.from({ length: recipe.bays }, () => ({
    angle: random() * Math.PI * 2,
    width: 0.12 + random() * 0.16,
    depth: recipe.bayDepth * (0.6 + random() * 0.6)
  }));
  const half = size / 2;
  const land: boolean[] = [];
  const lagoon: boolean[] = [];
  const inland: number[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const shaped = outlineDistance(outline, dx, dy, turn, recipe.landRadius, islets);
      const distance = typeof shaped === "number" ? shaped : Number.POSITIVE_INFINITY;
      const angle = Math.atan2(dy, dx);
      // The coast: a circle pushed in and out by noise sampled around the rim, minus the bays.
      const wobble = (fbm(seed, Math.cos(angle) * recipe.coastFrequency + 7, Math.sin(angle) * recipe.coastFrequency + 7, 4) - 0.5) * 2;
      let radius = recipe.landRadius * (1 + wobble * recipe.roughness) + (fbm(seed + 77, dx * 3 + 11, dy * 3 + 11, 3) - 0.5) * 0.08;
      for (const bay of bays) {
        const across = angleDistance(angle, bay.angle) / bay.width;
        if (across < 1) radius -= bay.depth * recipe.landRadius * (1 - across * across);
      }
      land.push(distance < radius);
      lagoon.push(shaped === "LAGOON");
      inland.push(radius - distance);
    }
  }
  const landCount = summedArea(size, (index) => land[index] ?? false);
  const cells: IslandCellKind[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (!(land[index] ?? false)) {
        if (lagoon[index] ?? false) { cells.push("SHALLOW"); continue; }
        cells.push(landCount(x, y, 3) > 0 ? "SHALLOW" : "DEEP");
        continue;
      }
      const depth = inland[index] ?? 0;
      if (depth < 0.035) { cells.push("SAND"); continue; }
      const n = fbm(seed + 301, x / 9, y / 9, 4);
      if (element === "KIM") cells.push(depth > 0.12 && n > 0.42 ? "ROCK" : n > 0.6 ? "FOREST" : "GRASS");
      else if (element === "MOC") cells.push(n > 0.4 ? "FOREST" : "GRASS");
      else if (element === "HOA") cells.push(n > 0.66 ? "FOREST" : "MEADOW");
      else if (element === "THO") cells.push(depth > 0.1 && n < 0.5 ? "FIELD" : n > 0.68 ? "FOREST" : "GRASS");
      else cells.push(n > 0.62 ? "FOREST" : "GRASS");
    }
  }
  return { element, outline, seed, size, cells, sites: placeSites(element, seed, size, cells, recipe) };
}

/**
 * A summed-area table over a square grid: `count(x, y, r)` is how many cells in the
 * `(2r+1) x (2r+1)` window around `(x, y)` pass `test`, clipped to the grid, in constant time.
 */
export function summedArea(size: number, test: (index: number) => boolean): (x: number, y: number, r: number) => number {
  const stride = size + 1;
  const table = new Int32Array(stride * stride);
  for (let y = 0; y < size; y += 1) {
    let row = 0;
    for (let x = 0; x < size; x += 1) {
      if (test(y * size + x)) row += 1;
      table[(y + 1) * stride + x + 1] = (table[y * stride + x + 1] ?? 0) + row;
    }
  }
  return (x, y, r) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(size, x + r + 1);
    const y1 = Math.min(size, y + r + 1);
    if (x0 >= x1 || y0 >= y1) return 0;
    return (table[y1 * stride + x1] ?? 0) - (table[y0 * stride + x1] ?? 0) - (table[y1 * stride + x0] ?? 0) + (table[y0 * stride + x0] ?? 0);
  };
}

function placeSites(element: IslandElement, seed: number, size: number, cells: readonly IslandCellKind[], recipe: Recipe): IslandSite[] {
  const random = rng(seed ^ 0x9e3779b9);
  const sites: IslandSite[] = [];
  const kindAt = (x: number, y: number): IslandCellKind | undefined => (x >= 0 && y >= 0 && x < size && y < size ? cells[y * size + x] : undefined);
  const isLand = (kind: IslandCellKind | undefined): boolean => kind !== undefined && kind !== "DEEP" && kind !== "SHALLOW";
  const landAround = summedArea(size, (index) => isLand(cells[index]));
  // Sites bucketed by a coarse grid, so the spacing rule looks at neighbours rather than every site.
  const bucketSize = 10;
  const buckets = new Map<number, IslandSite[]>();
  const bucketKey = (bx: number, by: number): number => by * 1024 + bx;
  const free = (x: number, y: number, spacing: number): boolean => {
    const reach = Math.ceil(spacing / bucketSize);
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    for (let oy = -reach; oy <= reach; oy += 1) {
      for (let ox = -reach; ox <= reach; ox += 1) {
        for (const site of buckets.get(bucketKey(bx + ox, by + oy)) ?? []) {
          if (Math.hypot(site.x - x, site.y - y) < spacing) return false;
        }
      }
    }
    return true;
  };
  const pick = (kind: IslandSiteKind, count: number, spacing: number, accepts: (x: number, y: number) => boolean): void => {
    for (let attempt = 0, placed = 0; attempt < count * 400 && placed < count; attempt += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      if (accepts(x, y) && free(x, y, spacing)) {
        const site = { kind, x, y };
        sites.push(site);
        const key = bucketKey(Math.floor(x / bucketSize), Math.floor(y / bucketSize));
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, [site]);
        else bucket.push(site);
        placed += 1;
      }
    }
  };
  const want = recipe.sites;
  // A bay is shallow water mostly wrapped by land: that is where a cage is sheltered.
  pick("FISH_BAY", want.FISH_BAY ?? 0, 7, (x, y) => kindAt(x, y) === "SHALLOW" && landAround(x, y, 4) >= 34);
  pick("DOCK", want.DOCK ?? 0, 6, (x, y) => kindAt(x, y) === "SAND" && landAround(x, y, 3) <= 34 && landAround(x, y, 3) >= 14);
  pick("CAMP", want.CAMP ?? 0, 10, (x, y) => { const k = kindAt(x, y); return (k === "GRASS" || k === "MEADOW" || k === "FIELD" || k === "FOREST") && landAround(x, y, 3) === 49; });
  pick("ORE", want.ORE ?? 0, element === "KIM" ? 6 : 8, (x, y) => (element === "KIM" ? kindAt(x, y) === "ROCK" : isLand(kindAt(x, y)) && kindAt(x, y) !== "SAND") && landAround(x, y, 2) === 25);
  pick("PASTURE", want.PASTURE ?? 0, 9, (x, y) => kindAt(x, y) === "MEADOW" && landAround(x, y, 3) === 49);
  pick("TREE", want.TREE ?? 0, 2.2, (x, y) => kindAt(x, y) === "FOREST" || (element !== "MOC" && kindAt(x, y) === "GRASS" && random() < 0.15));
  return sites;
}
