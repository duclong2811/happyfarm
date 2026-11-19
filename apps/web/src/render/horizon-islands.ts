import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  type Object3D
} from "three";
import {
  generateHomeIsland,
  generateIsland,
  type GeneratedIsland,
  type IslandCellKind,
  type IslandElement,
  type IslandOutline
} from "@happy-farm/game-data";
import { islandRelief, RELIEF_BASE_WORLD, RELIEF_TAG, type IslandRelief } from "./island-relief";
import { SEA_SURFACE_Y } from "./world-cell-overlay";

/**
 * The other islands of the player's archipelago, standing on the horizon (docs/design/WORLD_MAP.md,
 * W3).
 *
 * Each is drawn from its template (element, outline, seed), the same three values the chart draws it
 * from, so a player's own island looks to its neighbours the way it looks at home: its coast, its
 * forests, a Kim range or a Hỏa volcano. A settled island flies a small flag; a free place shows its
 * wild island.
 *
 * Bearings are the chart's own. Distances are condensed: on the chart the nearest neighbour is two
 * or three island widths away, which at the estate camera's range would sit in the fog, so the
 * horizon keeps the order of distances but draws every island between `HORIZON_NEAR` and
 * `HORIZON_FAR` home-island half-widths out, and smaller than life, as distance makes things look.
 *
 * Presentation only: nothing here is picked, collides, casts a shadow or carries state. The
 * islands are not fogged (the fog would swallow them at this range); their colours are hazed toward
 * the horizon instead, which reads the same way and keeps them in view.
 */

/** The size the chart draws islands at; the horizon samples the same ground. */
export const HORIZON_GRID = 96;
/** Nearest and farthest draw distance, in home-island half-widths from the home island's centre. */
export const HORIZON_NEAR = 2.35;
export const HORIZON_FAR = 3.25;
/** A neighbour's width as a share of the home island's. */
export const HORIZON_ISLAND_SCALE = 0.42;
/** Chart distances (tiles) mapped onto the near and far edges of the horizon band. */
const CHART_NEAR_TILES = 160;
const CHART_FAR_TILES = 560;
/** How far colours lean toward the horizon. */
const HAZE = 0.3;
/** Heights are exaggerated so a forest, a range or a volcano still reads at this distance. */
const VERTICAL_EXAGGERATION = 2.6;
/** The open sea round a distant island, before the haze. */
const SEA_COLOUR = 0x2f8fc4;

export interface HorizonTemplate {
  readonly element: string;
  readonly outline: string;
  readonly seed: number;
  readonly generatorVersion: number;
}

export interface HorizonSlot {
  readonly slotId: string;
  /** Chart position, tiles: +x east, +z south (the world's own axes). */
  readonly x: number;
  readonly z: number;
  readonly claimed: boolean;
  readonly island: HorizonTemplate;
}

export interface HorizonPlacement {
  readonly slotId: string;
  readonly worldX: number;
  readonly worldZ: number;
  /** The island's drawn width, world units. */
  readonly footprint: number;
  readonly claimed: boolean;
  readonly island: HorizonTemplate;
}

/**
 * Where each neighbour stands around the home island: its chart bearing from home, its chart
 * distance condensed into the horizon band, and pushed a little further out where two would touch.
 * The home slot itself is not drawn.
 */
export function horizonPlacements(
  home: { readonly x: number; readonly z: number },
  slots: readonly HorizonSlot[],
  centre: { readonly x: number; readonly z: number },
  halfExtent: number
): HorizonPlacement[] {
  const footprint = halfExtent * 2 * HORIZON_ISLAND_SCALE;
  const placed: { slotId: string; bearing: number; radius: number; chartDistance: number; claimed: boolean; island: HorizonTemplate }[] = [];
  for (const slot of slots) {
    const dx = slot.x - home.x;
    const dz = slot.z - home.z;
    const chartDistance = Math.hypot(dx, dz);
    if (chartDistance < 1) continue;
    const t = Math.min(1, Math.max(0, (chartDistance - CHART_NEAR_TILES) / (CHART_FAR_TILES - CHART_NEAR_TILES)));
    placed.push({
      slotId: slot.slotId,
      bearing: Math.atan2(dz, dx),
      radius: halfExtent * (HORIZON_NEAR + (HORIZON_FAR - HORIZON_NEAR) * t),
      chartDistance,
      claimed: slot.claimed,
      island: slot.island
    });
  }
  // Nearer islands keep their place; a farther one that would overlap one already settled moves out.
  placed.sort((a, b) => a.chartDistance - b.chartDistance || a.slotId.localeCompare(b.slotId));
  const gap = footprint * 1.08;
  for (let i = 0; i < placed.length; i += 1) {
    const current = placed[i];
    if (current === undefined) continue;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const clash = placed.slice(0, i).some((other) => {
        const ax = Math.cos(current.bearing) * current.radius;
        const az = Math.sin(current.bearing) * current.radius;
        return Math.hypot(ax - Math.cos(other.bearing) * other.radius, az - Math.sin(other.bearing) * other.radius) < gap;
      });
      if (!clash) break;
      current.radius += footprint * 0.35;
    }
  }
  return placed
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .map((entry) => ({
      slotId: entry.slotId,
      worldX: centre.x + Math.cos(entry.bearing) * entry.radius,
      worldZ: centre.z + Math.sin(entry.bearing) * entry.radius,
      footprint,
      claimed: entry.claimed,
      island: entry.island
    }));
}

/** The island a template stands for, at the chart's size, or null for a template no generator draws. */
export function horizonGround(template: HorizonTemplate): GeneratedIsland | null {
  try {
    const element = template.element as IslandElement;
    const outline = template.outline as IslandOutline;
    return template.generatorVersion === 1
      ? generateIsland(element, template.seed, HORIZON_GRID, outline)
      : generateHomeIsland(element, template.seed, HORIZON_GRID, outline);
  } catch {
    return null;
  }
}

const LAND_COLOURS: Readonly<Record<Exclude<IslandCellKind, "DEEP">, number>> = {
  SHALLOW: 0x7cc9d6,
  SAND: 0xe4d29a,
  GRASS: 0x82b85c,
  MEADOW: 0xa9c96c,
  FIELD: 0xb99262,
  FOREST: 0x3f7d3b,
  ROCK: 0x8b8377
};
const TAG_COLOURS: Readonly<Record<number, number>> = {
  [RELIEF_TAG.SNOW]: 0xf3f6f8,
  [RELIEF_TAG.BASALT]: 0x4b4541,
  [RELIEF_TAG.LAVA]: 0xd2562c
};

/** One cell's height above the sea, in the island's own world metres (before scaling). */
function cellHeight(kind: IslandCellKind, relief: IslandRelief, index: number): number {
  switch (kind) {
    case "DEEP":
      return -0.6;
    case "SHALLOW":
      return 0.03;
    case "SAND":
      return 0.35;
    case "FOREST":
      return 1.7;
    case "ROCK":
      return 0.75 + Math.max(0, (relief.height[index] ?? RELIEF_BASE_WORLD) - RELIEF_BASE_WORLD);
    default:
      return 0.75;
  }
}

/**
 * The island as one low-poly mesh: a height field over every `step`-th cell, with a quad wherever a
 * corner is not open sea, so the shallows ring it and the sea's edge stays under the water. Local
 * coordinates: centred on the island, `footprint` wide, y in world metres from the sea's surface.
 */
export function horizonIslandGeometry(island: GeneratedIsland, footprint: number, haze: number, step = 2): BufferGeometry {
  const size = island.size;
  const cells = island.cells;
  const relief = islandRelief({
    size,
    element: island.element,
    seed: island.seed,
    isRock: (index) => cells[index] === "ROCK",
    ore: island.sites.filter((site) => site.kind === "ORE")
  });
  const points = Math.floor((size - 1) / step) + 1;
  const cellWorld = footprint / size;
  // A home cell is about one metre; a horizon cell is `cellWorld`, so heights shrink with it.
  const vertical = cellWorld * VERTICAL_EXAGGERATION;
  const positions = new Float32Array(points * points * 3);
  const colours = new Float32Array(points * points * 3);
  const deep = new Uint8Array(points * points);
  const hazeColour = new Color(haze);
  const colour = new Color();
  for (let j = 0; j < points; j += 1) {
    for (let i = 0; i < points; i += 1) {
      const x = Math.min(size - 1, i * step);
      const y = Math.min(size - 1, j * step);
      // The block's highest cell, so a narrow ridge or a crater rim survives the sampling.
      let best = y * size + x;
      let bestHeight = -Infinity;
      for (let by = y; by < Math.min(size, y + step); by += 1) {
        for (let bx = x; bx < Math.min(size, x + step); bx += 1) {
          const index = by * size + bx;
          const h = cellHeight(cells[index] ?? "DEEP", relief, index);
          if (h > bestHeight) {
            bestHeight = h;
            best = index;
          }
        }
      }
      const kind = cells[best] ?? "DEEP";
      const point = j * points + i;
      deep[point] = kind === "DEEP" ? 1 : 0;
      positions[point * 3] = (x + step / 2 - size / 2) * cellWorld;
      positions[point * 3 + 1] = SEA_SURFACE_Y + bestHeight * vertical;
      positions[point * 3 + 2] = (y + step / 2 - size / 2) * cellWorld;
      const tag = relief.tag[best] ?? RELIEF_TAG.NONE;
      colour.setHex(kind === "DEEP" ? LAND_COLOURS.SHALLOW : (TAG_COLOURS[tag] ?? LAND_COLOURS[kind]));
      colour.lerp(hazeColour, HAZE);
      colours[point * 3] = colour.r;
      colours[point * 3 + 1] = colour.g;
      colours[point * 3 + 2] = colour.b;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < points - 1; j += 1) {
    for (let i = 0; i < points - 1; i += 1) {
      const a = j * points + i;
      const b = a + 1;
      const c = a + points;
      const d = c + 1;
      if (deep[a] === 1 && deep[b] === 1 && deep[c] === 1 && deep[d] === 1) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const noRaycast: Object3D["raycast"] = () => undefined;

/**
 * One neighbour, ready to add to the scene: the island, and on a settled one a flag at its camp.
 * Returns null when the template draws no island.
 */
export function buildHorizonIsland(placement: HorizonPlacement, haze: number, step = 2): Group | null {
  const island = horizonGround(placement.island);
  if (island === null) return null;
  const root = new Group();
  root.name = `horizon:${placement.slotId}`;
  root.userData = { horizonSlotId: placement.slotId };
  root.position.set(placement.worldX, 0, placement.worldZ);
  const geometry = horizonIslandGeometry(island, placement.footprint, haze, step);
  const ground = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, fog: false }));
  ground.raycast = noRaycast;
  root.add(seaPatch(placement.footprint * 0.68, haze), ground);
  if (placement.claimed) {
    const camp = island.sites.find((site) => site.kind === "CAMP");
    const cellWorld = placement.footprint / island.size;
    const at = camp ?? { x: island.size / 2, y: island.size / 2 };
    const poleHeight = placement.footprint * 0.13;
    const base = SEA_SURFACE_Y + 0.75 * cellWorld * VERTICAL_EXAGGERATION;
    const hazeColour = new Color(haze);
    const pole = new Mesh(
      new CylinderGeometry(poleHeight * 0.025, poleHeight * 0.03, poleHeight, 5),
      new MeshLambertMaterial({ color: new Color(0x5a3b22).lerp(hazeColour, HAZE * 0.6), fog: false })
    );
    pole.position.set((at.x - island.size / 2) * cellWorld, base + poleHeight / 2, (at.y - island.size / 2) * cellWorld);
    pole.raycast = noRaycast;
    const flag = new Mesh(
      new ConeGeometry(poleHeight * 0.16, poleHeight * 0.38, 3),
      new MeshLambertMaterial({ color: new Color(0xd23a2a).lerp(hazeColour, HAZE * 0.5), fog: false })
    );
    // A pennant: a flattened cone on its side at the top of the pole, pointing down-wind.
    flag.rotation.z = -Math.PI / 2;
    flag.scale.set(1, 1, 0.25);
    flag.position.set(pole.position.x + poleHeight * 0.19, base + poleHeight * 0.86, pole.position.z);
    flag.raycast = noRaycast;
    root.add(pole, flag);
  }
  return root;
}

/**
 * A patch of blue sea under a distant island, fading out at its rim. The fog turns the ocean pale
 * at this range; without its own water an unfogged island would seem to float on the haze.
 */
function seaPatch(radius: number, haze: number): Mesh {
  const geometry = new CircleGeometry(radius, 40);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 4);
  const centre = new Color(SEA_COLOUR).lerp(new Color(haze), 0.42);
  for (let i = 0; i < position.count; i += 1) {
    const r = Math.hypot(position.getX(i), position.getZ(i)) / radius;
    colours[i * 4] = centre.r;
    colours[i * 4 + 1] = centre.g;
    colours[i * 4 + 2] = centre.b;
    colours[i * 4 + 3] = 0.85 * (1 - r * r);
  }
  geometry.setAttribute("color", new BufferAttribute(colours, 4));
  const patch = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  patch.position.y = SEA_SURFACE_Y + 0.005;
  patch.renderOrder = -1;
  patch.raycast = noRaycast;
  return patch;
}

/** Frees what a horizon group holds. */
export function disposeHorizon(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Mesh) {
      (object.geometry as BufferGeometry).dispose();
      const material = object.material as Material | Material[];
      if (Array.isArray(material)) for (const entry of material) entry.dispose();
      else material.dispose();
    }
  });
  group.clear();
}

/** A voyage the horizon shows: where a ship sails from and to, and when (server times). */
export interface HorizonVoyage {
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly departedAt: string;
  readonly arrivesAt: string;
  readonly mine: boolean;
}

/**
 * Where a ship of `voyage` is on the horizon at `serverNowMs`, and which way it faces: between the
 * horizon islands it sails from and to. Home is the home island's own shore on the side the ship sails.
 * Null when an end is not on this horizon (a voyage to a farther archipelago).
 */
export function horizonShipPose(
  voyage: HorizonVoyage,
  serverNowMs: number,
  places: ReadonlyMap<string, { readonly x: number; readonly z: number }>,
  homeSlotId: string,
  centre: { readonly x: number; readonly z: number },
  halfExtent: number
): { readonly x: number; readonly z: number; readonly heading: number } | null {
  const far = (slotId: string): { x: number; z: number } | null => {
    const place = places.get(slotId);
    return place === undefined ? null : { x: place.x, z: place.z };
  };
  let from = voyage.fromSlotId === homeSlotId ? null : far(voyage.fromSlotId);
  let to = voyage.toSlotId === homeSlotId ? null : far(voyage.toSlotId);
  const shore = (towards: { x: number; z: number }): { x: number; z: number } => {
    const dx = towards.x - centre.x;
    const dz = towards.z - centre.z;
    const length = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: centre.x + (dx / length) * halfExtent * 1.15, z: centre.z + (dz / length) * halfExtent * 1.15 };
  };
  if (voyage.fromSlotId === homeSlotId && to !== null) from = shore(to);
  if (voyage.toSlotId === homeSlotId && from !== null) to = shore(from);
  if (from === null || to === null) return null;
  const start = Date.parse(voyage.departedAt);
  const end = Date.parse(voyage.arrivesAt);
  const share = end <= start ? 1 : Math.min(1, Math.max(0, (serverNowMs - start) / (end - start)));
  return { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share, heading: Math.atan2(to.z - from.z, to.x - from.x) };
}

/**
 * A small sailing ship for the horizon: a hull, a mast and a sail, hazed like the islands and never
 * picked. The player's own flies a red sail. `size` is its length in world metres; it faces +x.
 */
export function buildHorizonShip(size: number, mine: boolean, haze: number): Group {
  const hazeColour = new Color(haze);
  const material = (hex: number, amount: number): MeshLambertMaterial => new MeshLambertMaterial({ color: new Color(hex).lerp(hazeColour, amount), fog: false });
  const ship = new Group();
  const hull = new Mesh(new BoxGeometry(size, size * 0.22, size * 0.34), material(0x6b4423, HAZE * 0.6));
  hull.position.y = SEA_SURFACE_Y + size * 0.08;
  const mast = new Mesh(new CylinderGeometry(size * 0.025, size * 0.03, size * 0.85, 5), material(0x4a2f18, HAZE * 0.6));
  mast.position.set(0, SEA_SURFACE_Y + size * 0.55, 0);
  const sail = new Mesh(new ConeGeometry(size * 0.32, size * 0.6, 3), material(mine ? 0xd23a2a : 0xf6f0e0, HAZE * 0.4));
  sail.scale.set(1, 1, 0.12);
  sail.position.set(size * 0.05, SEA_SURFACE_Y + size * 0.6, 0);
  for (const part of [hull, mast, sail]) part.raycast = noRaycast;
  ship.add(hull, mast, sail);
  return ship;
}
