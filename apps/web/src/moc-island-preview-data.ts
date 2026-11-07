import {
  neighborIslandTemplate,
  neighborLandDepth,
  neighborOutlineRadius,
  type NeighborIslandTemplate
} from "./render/neighbor-island-template";

export type MocPreviewGroup =
  | "DOCK"
  | "HOUSE"
  | "WAREHOUSE"
  | "WOOD_YARD"
  | "FOREST_BACK"
  | "FOREST_LEFT"
  | "FOREST_RIGHT"
  | "DETAIL";

export interface MocPreviewPlacement {
  readonly id: string;
  readonly modelId: string;
  readonly group: MocPreviewGroup;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
}

export interface MocPreviewRoute {
  readonly id: string;
  readonly points: readonly { readonly x: number; readonly z: number }[];
}

export interface MocPreviewLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export interface MocPreviewMissingAsset {
  readonly id: string;
  readonly reason: string;
}

export interface MocPreviewDockAnchor {
  readonly oldHint: { readonly x: number; readonly z: number };
  readonly shore: { readonly x: number; readonly z: number };
  readonly land: { readonly x: number; readonly z: number };
  readonly water: { readonly x: number; readonly z: number };
  readonly outward: { readonly x: number; readonly z: number };
  readonly oldHintDelta: number;
}

export interface MocPreviewLayout {
  readonly kind: "MOC";
  readonly seed: number;
  readonly template: NeighborIslandTemplate;
  readonly placements: readonly MocPreviewPlacement[];
  readonly routes: readonly MocPreviewRoute[];
  readonly dock: MocPreviewDockAnchor;
  readonly labels: readonly MocPreviewLabel[];
  readonly missing: readonly MocPreviewMissingAsset[];
}

const template = neighborIslandTemplate("MOC");
const seed = 20261018;
const oldDockHint = template.dockLocal;

function normalize(point: { readonly x: number; readonly z: number }): { readonly x: number; readonly z: number } {
  const length = Math.hypot(point.x, point.z) || 1;
  return { x: point.x / length, z: point.z / length };
}

/**
 * The template's dockLocal is only a historical direction hint. The preview anchor is sampled from
 * the same irregular outline used by terrain/collision, so the bridge cannot silently start inland.
 */
function deriveDockAnchor(): MocPreviewDockAnchor {
  const hintDirection = normalize(oldDockHint);
  let shore = { x: 0, z: 0 };
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < 720; index += 1) {
    const angle = (index / 720) * Math.PI * 2;
    const radius = neighborOutlineRadius(template, angle);
    const point = {
      x: Math.cos(angle) * template.radiusX * radius,
      z: Math.sin(angle) * template.radiusZ * radius
    };
    const score = point.x * hintDirection.x + point.z * hintDirection.z;
    if (score > bestScore) {
      bestScore = score;
      shore = point;
    }
  }
  // Use the ellipse normal, not the centre-to-shore chord, for the seaward heading.
  const outward = normalize({ x: shore.x / (template.radiusX * template.radiusX), z: shore.z / (template.radiusZ * template.radiusZ) });
  const land = { x: shore.x - outward.x * 5.0, z: shore.z - outward.z * 5.0 };
  const water = { x: shore.x + outward.x * 13.0, z: shore.z + outward.z * 13.0 };
  return {
    oldHint: oldDockHint,
    shore,
    land,
    water,
    outward,
    oldHintDelta: distance(oldDockHint, land)
  };
}

const dock = deriveDockAnchor();

function mulberry32(initial: number): () => number {
  let state = initial >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distanceToSegment(point: { readonly x: number; readonly z: number }, start: { readonly x: number; readonly z: number }, end: { readonly x: number; readonly z: number }): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.001) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return distance(point, { x: start.x + dx * t, z: start.z + dz * t });
}

const house = { x: 2.0, z: 8.0 };
const barn = { x: 10.0, z: -4.0 };
const woodYard = { x: 16.0, z: -6.0 };
const fork = { x: 1.0, z: 1.5 };
const forestEntry = { x: 23.0, z: -15.0 };

const routes: readonly MocPreviewRoute[] = [
  { id: "dock-to-fork", points: [dock.land, fork] },
  { id: "fork-to-house", points: [fork, house] },
  { id: "fork-to-barn", points: [fork, barn, woodYard] },
  { id: "wood-yard-to-forest", points: [woodYard, forestEntry, { x: 28.0, z: -24.0 }] },
  { id: "forest-return", points: [{ x: 28.0, z: -24.0 }, { x: 38.0, z: -8.0 }, { x: 29.0, z: 8.0 }, fork] }
];

const clearedPoints = [house, barn, woodYard, fork];

function nearRoute(point: { readonly x: number; readonly z: number }, margin: number): boolean {
  return routes.some((route) => {
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      if (start !== undefined && end !== undefined && distanceToSegment(point, start, end) < margin) return true;
    }
    return false;
  });
}

function addForestPlacements(): MocPreviewPlacement[] {
  const random = mulberry32(seed);
  const placements: MocPreviewPlacement[] = [];
  const masses = [
    { group: "FOREST_BACK" as const, center: { x: 26.0, z: -21.0 }, radiusX: 20.0, radiusZ: 11.0, count: 34 },
    { group: "FOREST_LEFT" as const, center: { x: -24.0, z: 1.0 }, radiusX: 13.0, radiusZ: 18.0, count: 18 },
    { group: "FOREST_RIGHT" as const, center: { x: 30.0, z: 8.0 }, radiusX: 14.0, radiusZ: 15.0, count: 18 }
  ];
  const models = ["tree_broad_2", "tree_broad_3", "tree_pine_2"] as const;
  for (const mass of masses) {
    let accepted = 0;
    let attempts = 0;
    while (accepted < mass.count && attempts < mass.count * 30) {
      attempts += 1;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      const point = {
        x: mass.center.x + Math.cos(angle) * mass.radiusX * radius,
        z: mass.center.z + Math.sin(angle) * mass.radiusZ * radius
      };
      if (neighborLandDepth(template, point.x, point.z) >= -0.012) continue;
      if (clearedPoints.some((clear) => distance(point, clear) < 7.0)) continue;
      if (nearRoute(point, 2.8)) continue;
      const modelId = models[Math.floor(random() * models.length)] ?? "tree_broad_2";
      placements.push({
        id: `forest-${mass.group.toLowerCase()}-${String(accepted + 1).padStart(2, "0")}`,
        modelId,
        group: mass.group,
        x: point.x,
        z: point.z,
        rotationY: random() * Math.PI * 2,
        scale: 0.86 + random() * 0.3
      });
      accepted += 1;
    }
  }
  return placements;
}

const fixedPlacements: readonly MocPreviewPlacement[] = [
  { id: "farmhouse", modelId: "__procedural:FARMHOUSE", group: "HOUSE", x: house.x, z: house.z, rotationY: Math.PI, scale: 1 },
  { id: "storage-barn-t1", modelId: "farm.barn.t1", group: "WAREHOUSE", x: barn.x, z: barn.z, rotationY: 0.22, scale: 4.6 },
  { id: "wagon", modelId: "prop_wagon", group: "WOOD_YARD", x: 7.0, z: -2.8, rotationY: 0.22, scale: 2.2 },
  { id: "workbench", modelId: "prop_workbench", group: "WOOD_YARD", x: 14.3, z: -4.0, rotationY: 0.2, scale: 1.9 },
  { id: "anvil-log", modelId: "prop_anvil_log", group: "WOOD_YARD", x: 15.8, z: -3.8, rotationY: 0.1, scale: 1.2 },
  { id: "axe", modelId: "prop_axe", group: "WOOD_YARD", x: 15.0, z: -7.0, rotationY: -0.4, scale: 0.8 },
  { id: "crate-01", modelId: "prop_crate_wooden", group: "WOOD_YARD", x: 12.2, z: -6.7, rotationY: 0.3, scale: 0.7 },
  { id: "crate-02", modelId: "prop_crate_wooden", group: "WOOD_YARD", x: 13.0, z: -6.1, rotationY: -0.2, scale: 0.7 },
  { id: "crate-03", modelId: "prop_crate_wooden", group: "WOOD_YARD", x: 13.8, z: -6.8, rotationY: 0.5, scale: 0.7 },
  { id: "crate-04", modelId: "prop_crate_wooden", group: "WOOD_YARD", x: 12.8, z: -7.6, rotationY: -0.1, scale: 0.7 },
  { id: "fence-house-01", modelId: "prop_fence_rail_long", group: "HOUSE", x: -0.2, z: 9.4, rotationY: 0.08, scale: 1 },
  { id: "fence-house-02", modelId: "prop_fence_rail_long", group: "HOUSE", x: 3.2, z: 10.1, rotationY: 0.2, scale: 1 },
  { id: "flower-house-01", modelId: "bush_flowering", group: "HOUSE", x: -1.2, z: 7.1, rotationY: 0.2, scale: 1.1 },
  { id: "flower-house-02", modelId: "bush_flowering", group: "HOUSE", x: 4.6, z: 7.6, rotationY: -0.2, scale: 0.9 },
  { id: "fern-edge-01", modelId: "plant_fern", group: "DETAIL", x: 7.0, z: -12.5, rotationY: 0.3, scale: 0.7 },
  { id: "fern-edge-02", modelId: "plant_fern", group: "DETAIL", x: 9.4, z: -13.2, rotationY: -0.4, scale: 0.65 },
  { id: "grass-edge-01", modelId: "plant_grass_tall", group: "DETAIL", x: 5.8, z: -11.8, rotationY: 0.1, scale: 0.72 },
  { id: "rock-edge-01", modelId: "rock_boulder_1", group: "DETAIL", x: 20.0, z: -13.4, rotationY: 0.4, scale: 1.0 },
  { id: "rock-edge-02", modelId: "rock_boulder_2", group: "DETAIL", x: 32.0, z: 10.8, rotationY: -0.2, scale: 0.85 },
  { id: "dock-harbor", modelId: "__procedural:HARBOR", group: "DOCK", x: dock.land.x, z: dock.land.z, rotationY: Math.atan2(dock.outward.x, dock.outward.z), scale: 1 }
];

export const MOC_PREVIEW_LAYOUT: MocPreviewLayout = {
  kind: "MOC",
  seed,
  template,
  placements: [...fixedPlacements, ...addForestPlacements()],
  routes,
  dock,
  labels: [
    { id: "label-dock", text: "BẾN / BỜ", x: dock.land.x, z: dock.land.z, y: 2.5 },
    { id: "label-house", text: "NHÀ Ở", x: house.x, z: house.z, y: 4.2 },
    { id: "label-barn", text: "KHO + BÃI GỖ", x: woodYard.x, z: woodYard.z, y: 3.2 },
    { id: "label-forest-back", text: "RỪNG SAU", x: 26, z: -21, y: 3.4 },
    { id: "label-forest-left", text: "RỪNG TRÁI", x: -24, z: 1, y: 3.4 },
    { id: "label-forest-right", text: "RỪNG PHẢI", x: 30, z: 8, y: 3.4 }
  ],
  missing: [
    { id: "log_pile", reason: "Registry không có model log-pile phù hợp; preview không phóng to stump và không dùng đe làm pile." }
  ]
};

/**
 * The preview layout is also the authored Mộc presentation layout used by the active island and
 * its distant LOD. Keeping lookup here prevents those render paths from quietly growing another
 * set of house/yard/forest coordinates.
 */
export function mocPreviewPlacement(id: string): MocPreviewPlacement | undefined {
  return MOC_PREVIEW_LAYOUT.placements.find((placement) => placement.id === id);
}

export function mocPreviewForestPlacements(): readonly MocPreviewPlacement[] {
  return MOC_PREVIEW_LAYOUT.placements.filter((placement) =>
    placement.group === "FOREST_BACK" || placement.group === "FOREST_LEFT" || placement.group === "FOREST_RIGHT"
  );
}

export function mocPresentationDockWorld(center: { readonly x: number; readonly z: number }): { readonly x: number; readonly z: number } {
  return { x: center.x + MOC_PREVIEW_LAYOUT.dock.land.x, z: center.z + MOC_PREVIEW_LAYOUT.dock.land.z };
}

export function mocPresentationSpawnWorld(center: { readonly x: number; readonly z: number }): { readonly x: number; readonly z: number } {
  const dock = mocPresentationDockWorld(center);
  return {
    x: dock.x - MOC_PREVIEW_LAYOUT.dock.outward.x * 2,
    z: dock.z - MOC_PREVIEW_LAYOUT.dock.outward.z * 2
  };
}
