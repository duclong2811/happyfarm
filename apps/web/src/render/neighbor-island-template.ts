/**
 * Deterministic presentation templates for the future Five Elements archipelago.
 *
 * The HOME_ISLAND remains the server-authored farm world. These templates only describe the
 * fixed scenery shell around a persisted neighbour identity; they do not create resources,
 * rewards, placement permissions, or economy state.
 */
export type NeighborIslandKind = "MOC" | "KIM" | "THUY" | "HOA";

/** The visible water shell used by HOME's low-detail previews. Full islands use 1.20. */
/**
 * Distant islands are still world objects, not map markers.  Keep the preview close to the authored
 * outline so a player can read the island's silhouette, shore and large landmarks from HOME.
 */
export const NEIGHBOR_PREVIEW_WATER_SCALE = 0.55;

/**
 * Persisted neighbour coordinates are the only world coordinates used when an island is visited.
 * Keep this identity helper for callers/tests that need to make the no-transform rule explicit;
 * travel never rewrites island rows, dock offsets, or NPC state in D1.
 */
export function neighborPresentationCenter(kind: NeighborIslandKind, stored: { readonly x: number; readonly z: number }): { readonly x: number; readonly z: number } {
  switch (kind) {
    case "MOC":
    case "KIM":
    case "THUY":
    case "HOA":
      return { x: stored.x, z: stored.z };
  }
}

export interface NeighborIslandTemplate {
  readonly kind: NeighborIslandKind;
  readonly terrainKind: "FOREST" | "RIDGE" | "COAST";
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly relief: number;
  readonly dockLocal: { readonly x: number; readonly z: number };
  readonly npcLocal: { readonly x: number; readonly z: number };
  readonly houseLocal: { readonly x: number; readonly z: number };
  readonly storeLocal: { readonly x: number; readonly z: number };
  readonly forestLocal: readonly { readonly x: number; readonly z: number; readonly scale: number }[];
  readonly landmarks: readonly { readonly kind: "LOOKOUT" | "GROVE" | "STONE"; readonly x: number; readonly z: number }[];
  readonly workLocal: { readonly x: number; readonly z: number };
  readonly supportLocal: readonly { readonly kind: "ROCK" | "TREE" | "BUSH" | "WATER"; readonly x: number; readonly z: number; readonly scale: number }[];
  /** Functional districts are shared by the full island and its distant LOD. */
  readonly forestZones: readonly { readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number; readonly count: number; readonly scaleMin: number; readonly scaleMax: number }[];
  readonly oreLocal: readonly { readonly x: number; readonly z: number; readonly kind: "STONE" | "COPPER" | "IRON"; readonly scale: number }[];
  readonly waterChannels: readonly { readonly x: number; readonly z: number; readonly width: number; readonly length: number; readonly rotation: number }[];
  readonly ridgeLines: readonly { readonly x: number; readonly z: number; readonly width: number; readonly length: number; readonly height: number; readonly rotation: number }[];
  /** Presentation-only set dressing; never becomes a resource, building or gameplay row. */
  readonly presentationProps: readonly { readonly id: string; readonly x: number; readonly z: number; readonly scale: number }[];
}

const TEMPLATES: Readonly<Record<NeighborIslandKind, NeighborIslandTemplate>> = {
  MOC: {
    kind: "MOC", terrainKind: "FOREST", radiusX: 56, radiusZ: 50, relief: 6.8,
    dockLocal: { x: -13.2, z: 4.5 }, npcLocal: { x: 3.4, z: -1.8 }, houseLocal: { x: 1.5, z: 3.5 }, storeLocal: { x: 9.9, z: 0.6 },
    forestLocal: [
      { x: -5.5, z: -7.0, scale: 1.1 }, { x: -1.6, z: -8.0, scale: 0.9 },
      { x: 3.0, z: -7.5, scale: 1.25 }, { x: 7.0, z: -5.5, scale: 0.95 },
      { x: 9.0, z: -1.8, scale: 1.15 }, { x: 8.0, z: 3.0, scale: 0.9 },
      { x: -6.5, z: 6.2, scale: 1.0 }, { x: -1.5, z: 7.2, scale: 0.86 },
      { x: -10.5, z: -11.5, scale: 1.05 }, { x: -12.5, z: -4.0, scale: 0.92 },
      { x: -11.0, z: 2.7, scale: 1.12 }, { x: 12.0, z: -9.0, scale: 0.88 }
    ],
    landmarks: [
      { kind: "GROVE", x: 0, z: -5.8 }, { kind: "LOOKOUT", x: 10.2, z: 5.0 }, { kind: "STONE", x: -7.5, z: 0.8 }
    ],
    workLocal: { x: -4.4, z: -1.5 },
    supportLocal: [
      { kind: "TREE", x: -30, z: -14, scale: 1.1 }, { kind: "TREE", x: -18, z: -23, scale: 0.9 }, { kind: "TREE", x: -2, z: -28, scale: 1.2 }, { kind: "TREE", x: 16, z: -21, scale: 1.0 }, { kind: "TREE", x: 27, z: -10, scale: 0.85 },
      { kind: "TREE", x: -28, z: 12, scale: 1.0 }, { kind: "TREE", x: -15, z: 23, scale: 1.15 }, { kind: "TREE", x: 19, z: 18, scale: 0.9 }, { kind: "TREE", x: 30, z: 7, scale: 1.05 },
      { kind: "ROCK", x: 33, z: -19, scale: 1.1 }, { kind: "ROCK", x: -34, z: 0, scale: 0.9 },
      { kind: "BUSH", x: -39, z: -7, scale: 1.0 }, { kind: "BUSH", x: -31, z: 29, scale: 0.9 },
      { kind: "BUSH", x: 35, z: -5, scale: 1.1 }, { kind: "BUSH", x: 34, z: 28, scale: 0.85 }
    ],
    forestZones: [
      // Four separate forestry districts leave a readable central settlement/log yard while
      // keeping the island's existing outline unchanged. The outer rings are deliberately dense
      // enough to read as canopies from both the dock and the HOME LOD camera.
      { x: -29, z: -19, radiusX: 20, radiusZ: 13, count: 17, scaleMin: 0.82, scaleMax: 1.24 },
      { x: 27, z: -19, radiusX: 20, radiusZ: 13, count: 15, scaleMin: 0.78, scaleMax: 1.16 },
      { x: -28, z: 20, radiusX: 20, radiusZ: 12, count: 14, scaleMin: 0.76, scaleMax: 1.12 },
      { x: 28, z: 20, radiusX: 20, radiusZ: 13, count: 18, scaleMin: 0.84, scaleMax: 1.3 }
    ],
    presentationProps: [
      { id: "prop_wagon", x: -5.0, z: -3.4, scale: 1.2 },
      { id: "prop_crate_wooden", x: -3.7, z: -3.5, scale: 1.05 },
      { id: "prop_sack", x: -4.2, z: -4.4, scale: 1.0 },
      { id: "prop_axe", x: -2.8, z: -2.7, scale: 1.0 },
      { id: "prop_whetstone", x: -5.8, z: -1.0, scale: 1.0 },
      { id: "resource_wildwood_stump", x: -7.0, z: -2.8, scale: 1.0 },
      { id: "resource_pine_stump", x: -6.3, z: -4.6, scale: 0.9 }
    ],
    oreLocal: [], waterChannels: [], ridgeLines: []
  },
  KIM: {
    kind: "KIM", terrainKind: "RIDGE", radiusX: 56, radiusZ: 48, relief: 10.5,
    dockLocal: { x: -13, z: 3 }, npcLocal: { x: 2, z: -1 }, houseLocal: { x: 1.5, z: 3.5 }, storeLocal: { x: 8.5, z: 1.4 }, forestLocal: [],
    landmarks: [{ kind: "LOOKOUT", x: 6, z: 2 }, { kind: "STONE", x: -4, z: -3 }],
    workLocal: { x: -3, z: -2 },
    supportLocal: [
      { kind: "ROCK", x: -30, z: -15, scale: 1.5 }, { kind: "ROCK", x: -23, z: -23, scale: 1.1 }, { kind: "ROCK", x: -10, z: -28, scale: 1.8 }, { kind: "ROCK", x: 5, z: -24, scale: 1.2 }, { kind: "ROCK", x: 22, z: -15, scale: 1.7 },
      { kind: "ROCK", x: -28, z: 12, scale: 1.1 }, { kind: "ROCK", x: -13, z: 22, scale: 1.6 }, { kind: "ROCK", x: 17, z: 20, scale: 1.0 }, { kind: "ROCK", x: 30, z: 8, scale: 1.4 },
      { kind: "TREE", x: -38, z: -5, scale: 0.9 }, { kind: "TREE", x: -34, z: 24, scale: 0.82 }, { kind: "TREE", x: 35, z: -11, scale: 0.88 }, { kind: "TREE", x: 36, z: 21, scale: 0.78 },
      { kind: "BUSH", x: -31, z: -2, scale: 0.9 }, { kind: "BUSH", x: 29, z: 1, scale: 0.84 }, { kind: "BUSH", x: 34, z: -4, scale: 0.8 }
    ],
    forestZones: [],
    oreLocal: [
      { x: -24, z: -13, kind: "STONE", scale: 1.4 }, { x: -17, z: -17, kind: "COPPER", scale: 1.2 },
      { x: -8, z: -21, kind: "IRON", scale: 1.35 }, { x: 8, z: -18, kind: "STONE", scale: 1.5 },
      { x: 19, z: -11, kind: "COPPER", scale: 1.25 }, { x: -25, z: 9, kind: "IRON", scale: 1.3 },
      { x: -12, z: 15, kind: "STONE", scale: 1.15 }, { x: 4, z: 18, kind: "COPPER", scale: 1.4 },
      { x: 18, z: 13, kind: "IRON", scale: 1.2 }, { x: 28, z: 4, kind: "STONE", scale: 1.25 }
    ],
    presentationProps: [
      { id: "prop_wagon", x: -7.2, z: -4.9, scale: 1.2 },
      { id: "prop_crate_wooden", x: -5.6, z: -4.7, scale: 1.05 },
      { id: "prop_barrel", x: -5.9, z: -3.1, scale: 1.0 },
      { id: "prop_chest", x: -4.6, z: -3.5, scale: 1.0 }
    ],
    waterChannels: [],
    ridgeLines: [
      { x: -20, z: -15, width: 9.0, length: 26, height: 8.4, rotation: 0.18 },
      { x: 18, z: -14, width: 8.0, length: 22, height: 7.8, rotation: -0.42 },
      { x: 13, z: 17, width: 8.0, length: 20, height: 6.4, rotation: 0.58 }
    ]
  },
  THUY: {
    kind: "THUY", terrainKind: "COAST", radiusX: 64, radiusZ: 54, relief: 3.6,
    dockLocal: { x: -14, z: 3 }, npcLocal: { x: 2, z: -1 }, houseLocal: { x: 0, z: -20 }, storeLocal: { x: 5, z: -14 }, forestLocal: [],
    landmarks: [{ kind: "LOOKOUT", x: 7, z: 5 }, { kind: "STONE", x: -5, z: -4 }],
    workLocal: { x: -2, z: -2 },
    supportLocal: [
      { kind: "WATER", x: -24, z: 16, scale: 1.0 }, { kind: "WATER", x: 2, z: 13, scale: 1.0 }, { kind: "WATER", x: 25, z: 17, scale: 1.0 },
      { kind: "ROCK", x: 34, z: 18, scale: 0.9 }, { kind: "ROCK", x: -30, z: -18, scale: 1.0 },
      { kind: "TREE", x: -42, z: -12, scale: 0.78 }, { kind: "TREE", x: 42, z: -13, scale: 0.82 },
      { kind: "BUSH", x: -37, z: -3, scale: 0.85 }, { kind: "BUSH", x: 36, z: -2, scale: 0.9 }
    ],
    forestZones: [], oreLocal: [],
    presentationProps: [
      { id: "prop_cage_small", x: -24, z: 16, scale: 1.05 },
      { id: "prop_rope", x: -20, z: 13, scale: 1.0 },
      { id: "prop_cage_small", x: 2, z: 13, scale: 1.1 },
      { id: "prop_rope", x: 7, z: 13, scale: 1.0 },
      { id: "prop_cage_small", x: 25, z: 17, scale: 1.05 },
      { id: "prop_barrel", x: -4.8, z: -3.0, scale: 1.0 },
      { id: "prop_crate_wooden", x: -3.7, z: -3.9, scale: 1.0 }
    ],
    waterChannels: [
      { x: -24, z: 16, width: 9, length: 7, rotation: -0.25 },
      { x: 2, z: 13, width: 11, length: 8, rotation: 0.08 },
      { x: 25, z: 17, width: 10, length: 7, rotation: 0.3 }
    ], ridgeLines: []
  },
  HOA: {
    kind: "HOA", terrainKind: "FOREST", radiusX: 43, radiusZ: 37, relief: 5.4,
    dockLocal: { x: -13, z: 4 }, npcLocal: { x: 3, z: -1 }, houseLocal: { x: 1.5, z: 3.5 }, storeLocal: { x: 8.5, z: 1.4 }, forestLocal: [],
    landmarks: [{ kind: "LOOKOUT", x: 7, z: 4 }, { kind: "STONE", x: -6, z: -3 }],
    workLocal: { x: -2, z: -2 },
    supportLocal: [{ kind: "ROCK", x: -8, z: -5, scale: 1.2 }],
    forestZones: [], oreLocal: [], waterChannels: [], ridgeLines: [], presentationProps: []
  }
};

export function neighborIslandTemplate(kind: NeighborIslandKind = "MOC"): NeighborIslandTemplate {
  return TEMPLATES[kind];
}

/** Irregular closed outline: lobes create bays/headlands without a circular disc. */
export function neighborOutlineRadius(template: NeighborIslandTemplate, angle: number): number {
  const lobe = template.terrainKind === "COAST"
    ? 1 + 0.16 * Math.sin(angle * 2 + 0.4) + 0.11 * Math.sin(angle * 5 - 0.8)
    : 1 + 0.08 * Math.sin(angle * 2 + 0.4) + 0.06 * Math.sin(angle * 5 - 0.8);
  const bay = template.terrainKind === "COAST"
    ? 1 - 0.38 * Math.max(0, Math.cos(angle - 0.2)) ** 8 - 0.24 * Math.max(0, Math.cos(angle - 2.1)) ** 10
    : 1 - 0.14 * Math.max(0, Math.cos(angle - 2.45)) ** 8;
  return Math.max(template.terrainKind === "COAST" ? 0.58 : 0.72, lobe * bay);
}

export function neighborGroundHeight(template: NeighborIslandTemplate, x: number, z: number): number {
  const nx = x / template.radiusX;
  const nz = z / template.radiusZ;
  const distance = Math.hypot(nx, nz);
  const edge = Math.max(0, Math.min(1, (distance - 0.58) / 0.42));
  const hill = Math.max(0, 1 - distance) * (0.52 + 0.48 * Math.sin((x + z) * 0.16 + 1.2));
  const base = template.relief * hill * (1 - edge * 0.85);
  if (template.terrainKind === "RIDGE") {
    const authoredRidge = template.ridgeLines.reduce((highest, ridge) => {
      const dx = x - ridge.x;
      const dz = z - ridge.z;
      const along = dx * Math.cos(ridge.rotation) + dz * Math.sin(ridge.rotation);
      const across = -dx * Math.sin(ridge.rotation) + dz * Math.cos(ridge.rotation);
      const alongFalloff = Math.max(0, 1 - Math.abs(along) / (ridge.length * 0.5));
      const acrossFalloff = Math.max(0, 1 - Math.abs(across) / ridge.width);
      return Math.max(highest, ridge.height * Math.pow(alongFalloff, 0.72) * Math.pow(acrossFalloff, 0.9) * 0.22);
    }, 0);
    return Math.min(template.relief * 1.25, base * 0.68 + authoredRidge);
  }
  if (template.terrainKind === "COAST") {
    const channel = template.waterChannels.reduce((amount, item) => {
      const dx = x - item.x;
      const dz = z - item.z;
      const along = dx * Math.cos(item.rotation) + dz * Math.sin(item.rotation);
      const across = -dx * Math.sin(item.rotation) + dz * Math.cos(item.rotation);
      const ellipseDistance = Math.hypot(across / item.width, along / item.length);
      return Math.max(amount, Math.max(0, 1 - ellipseDistance));
    }, 0);
    // Cut channels down to the sea level. The renderer caps them with a water ribbon while the
    // movement terrain rejects the same mask, so the coast is physically non-walkable and not a pond
    // painted on top of a solid field.
    return Math.max(-0.78, base * (1 - channel * 2.4));
  }
  return base;
}

/** Signed radial depth against the same irregular outline used by the island mesh. */
export function neighborLandDepth(template: NeighborIslandTemplate, x: number, z: number): number {
  const radial = Math.hypot(x / template.radiusX, z / template.radiusZ);
  if (radial === 0) return -neighborOutlineRadius(template, 0);
  return radial - neighborOutlineRadius(template, Math.atan2(z / template.radiusZ, x / template.radiusX));
}

/** Shared coast-channel mask; callers use this for collision as well as water presentation. */
export function neighborWaterDepth(template: NeighborIslandTemplate, x: number, z: number): number {
  if (template.terrainKind !== "COAST") return 0;
  return template.waterChannels.reduce((amount, item) => {
    const dx = x - item.x;
    const dz = z - item.z;
    const along = dx * Math.cos(item.rotation) + dz * Math.sin(item.rotation);
    const across = -dx * Math.sin(item.rotation) + dz * Math.cos(item.rotation);
    const ellipseDistance = Math.hypot(across / item.width, along / item.length);
    return Math.max(amount, Math.max(0, 1 - ellipseDistance));
  }, 0);
}

/** Deterministic forest expansion from the same authored zones used by full and distant views. */
export function neighborForestLayout(template: NeighborIslandTemplate, seed = 0): readonly { readonly x: number; readonly z: number; readonly scale: number }[] {
  if (template.forestZones.length === 0) return template.forestLocal;
  const result = [...template.forestLocal];
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  const random = (): number => { state = Math.imul(state ^ (state >>> 16), 2246822519) >>> 0; return state / 0x100000000; };
  for (const zone of template.forestZones) {
    const count = Math.max(0, Math.trunc(zone.count));
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      result.push({ x: zone.x + Math.cos(angle) * zone.radiusX * radius, z: zone.z + Math.sin(angle) * zone.radiusZ * radius, scale: zone.scaleMin + random() * (zone.scaleMax - zone.scaleMin) });
    }
  }
  return result;
}

export function neighborWorldPoint(template: NeighborIslandTemplate, center: { readonly x: number; readonly z: number }, angle: number, fraction: number): { readonly x: number; readonly z: number } {
  const radius = neighborOutlineRadius(template, angle);
  return { x: center.x + Math.cos(angle) * template.radiusX * radius * fraction, z: center.z + Math.sin(angle) * template.radiusZ * radius * fraction };
}
