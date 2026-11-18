import { hash2, ISLAND_ELEMENTS, ISLAND_OUTLINES, type IslandElement, type IslandOutline } from "./island-generator";

/**
 * The world's sea chart: where every player island can be, laid out once from a world seed.
 *
 * The world has four outer regions - North, East, South and West - around a Centre that is the world's
 * hub (no player islands there). Each region holds archipelagos in a fixed order, nearest the Centre
 * first. Each archipelago is a ring of four to eight island *slots*.
 *
 * A slot is a place, not an island: the player still chooses their island (element, outline,
 * reroll) and the server puts it in the next free slot of the region they chose. An unclaimed slot
 * has a wild island, pre-rolled here, so it can be drawn from afar until someone takes the place.
 * Elements are mixed in every region (owner decision, 2026-11-19).
 *
 * Pure and deterministic: the same seed is the same chart on the server and in the browser. Which
 * slots are taken is not here - that is the server's `world_slots` table. See
 * `docs/design/WORLD_MAP.md`.
 */

export const SEA_REGIONS = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
export type SeaRegion = (typeof SEA_REGIONS)[number];

/** The chart's seed. Changing it moves every slot: never change it once islands have been placed. */
export const SEA_CHART_SEED = 20261119;
/** How many archipelagos each region holds, in the order they open. */
export const ARCHIPELAGOS_PER_REGION = 12;
/** Archipelagos open in every region from the start; the next opens when these are full. */
export const INITIAL_OPEN_ARCHIPELAGOS = 1;
/** The Centre's hub: no slot lies within this many tiles of the chart's origin. */
export const SEA_HUB_RADIUS_TILES = 600;
/** The least distance between two slots of one archipelago, in tiles: an island and its open sea. */
export const SEA_SLOT_SPACING_TILES = 160;

export interface SeaSlot {
  /** Stable id, `slot_<region>_<archipelago>_<n>` (1-based). Never reused or renumbered. */
  readonly slotId: string;
  readonly region: SeaRegion;
  readonly archipelagoId: string;
  /** 1-based order of the archipelago in its region, and of the slot in its archipelago. */
  readonly archipelagoIndex: number;
  readonly index: number;
  /** Chart position in tiles: +x east, +z south. */
  readonly x: number;
  readonly z: number;
  /** The wild island seen from afar while the slot is free. */
  readonly wild: { readonly element: IslandElement; readonly outline: IslandOutline; readonly seed: number };
}

export interface SeaArchipelago {
  /** Stable id, `sea_<region>_<n>`. */
  readonly archipelagoId: string;
  readonly region: SeaRegion;
  readonly index: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly slots: readonly SeaSlot[];
}

/** Each region's bearing from the hub: north is up the chart (-z), east is +x. */
const BEARING: Readonly<Record<SeaRegion, number>> = {
  NORTH: -Math.PI / 2,
  EAST: 0,
  SOUTH: Math.PI / 2,
  WEST: Math.PI
};
/** How far an archipelago may stand off its region's bearing: well inside the region's quarter. */
const SECTOR_HALF_WIDTH = 0.55;
/** Archipelago rings are about 250 tiles across; centres this far apart never share a slot's water. */
const ARCHIPELAGO_SPACING_TILES = 720;

function regionSalt(region: SeaRegion): number {
  return (SEA_REGIONS.indexOf(region) + 1) * 7919;
}

function buildSlots(region: SeaRegion, index: number, centreX: number, centreZ: number): SeaSlot[] {
  const salt = regionSalt(region);
  const archipelagoId = `sea_${region.toLowerCase()}_${String(index)}`;
  const count = 4 + Math.floor(hash2(SEA_CHART_SEED + salt, index, 3) * 5);
  const turn = hash2(SEA_CHART_SEED + salt, index, 4) * Math.PI * 2;
  const slots: SeaSlot[] = [];
  // The ring is wide enough that neighbouring slots on it stay `SEA_SLOT_SPACING_TILES` apart however
  // the small wobble falls.
  const ring = Math.max(230, SEA_SLOT_SPACING_TILES / (2 * Math.sin(Math.PI / count)) + 50);
  for (let n = 1; n <= count; n += 1) {
    const angle = turn + ((n - 1) / count) * Math.PI * 2 + (hash2(SEA_CHART_SEED + salt, index * 16 + n, 5) - 0.5) * 0.1;
    const radius = ring + (hash2(SEA_CHART_SEED + salt, index * 16 + n, 6) - 0.5) * 20;
    const roll = (k: number): number => hash2(SEA_CHART_SEED + salt, index * 16 + n, 10 + k);
    slots.push({
      slotId: `slot_${region.toLowerCase()}_${String(index)}_${String(n)}`,
      region,
      archipelagoId,
      archipelagoIndex: index,
      index: n,
      x: Math.round(centreX + Math.cos(angle) * radius),
      z: Math.round(centreZ + Math.sin(angle) * radius),
      wild: {
        element: ISLAND_ELEMENTS[Math.floor(roll(1) * ISLAND_ELEMENTS.length)] ?? "THO",
        outline: ISLAND_OUTLINES[Math.floor(roll(2) * ISLAND_OUTLINES.length)] ?? "ROUND",
        seed: 1 + Math.floor(roll(3) * 2_147_483_646)
      }
    });
  }
  return slots;
}

/**
 * Lays every archipelago out: in each region, the first nearest the hub and each next a little further
 * out, wandering inside the region's quarter, and never closer than `ARCHIPELAGO_SPACING_TILES` to any
 * archipelago already placed - its own region's or a neighbour's.
 */
function buildChart(): Map<SeaRegion, readonly SeaArchipelago[]> {
  const placed: { x: number; z: number }[] = [];
  const built = new Map<SeaRegion, readonly SeaArchipelago[]>();
  for (let index = 1; index <= ARCHIPELAGOS_PER_REGION; index += 1) {
    for (const region of SEA_REGIONS) {
      const salt = regionSalt(region);
      let centre: { x: number; z: number } | null = null;
      for (let attempt = 0; attempt < 400 && centre === null; attempt += 1) {
        const reach = 1000 + (index - 1) * 300 + Math.floor(attempt / 40) * 120 + hash2(SEA_CHART_SEED + salt, index, 100 + attempt) * 200;
        const bearing = BEARING[region] + (hash2(SEA_CHART_SEED + salt, index, 600 + attempt) - 0.5) * 2 * SECTOR_HALF_WIDTH;
        const candidate = { x: Math.round(Math.cos(bearing) * reach), z: Math.round(Math.sin(bearing) * reach) };
        if (placed.every((other) => Math.hypot(other.x - candidate.x, other.z - candidate.z) >= ARCHIPELAGO_SPACING_TILES)) centre = candidate;
      }
      if (centre === null) throw new Error(`The sea chart could not place ${region} archipelago ${String(index)}`);
      placed.push(centre);
      const archipelago: SeaArchipelago = {
        archipelagoId: `sea_${region.toLowerCase()}_${String(index)}`,
        region,
        index,
        centreX: centre.x,
        centreZ: centre.z,
        slots: buildSlots(region, index, centre.x, centre.z)
      };
      built.set(region, [...(built.get(region) ?? []), archipelago]);
    }
  }
  return built;
}

let chart: ReadonlyMap<SeaRegion, readonly SeaArchipelago[]> | null = null;
let slotIndex: ReadonlyMap<string, SeaSlot> | null = null;

/** Every archipelago of every region, in opening order. Built once. */
export function seaChart(): ReadonlyMap<SeaRegion, readonly SeaArchipelago[]> {
  chart ??= buildChart();
  return chart;
}

export function isSeaRegion(value: string): value is SeaRegion {
  return (SEA_REGIONS as readonly string[]).includes(value);
}

/** One slot by id, or null for an id the chart does not have. */
export function findSeaSlot(slotId: string): SeaSlot | null {
  if (slotIndex === null) {
    const index = new Map<string, SeaSlot>();
    for (const archipelagos of seaChart().values()) for (const archipelago of archipelagos) for (const slot of archipelago.slots) index.set(slot.slotId, slot);
    slotIndex = index;
  }
  return slotIndex.get(slotId) ?? null;
}

/** One archipelago by id, or null for an id the chart does not have. */
export function findSeaArchipelago(archipelagoId: string): SeaArchipelago | null {
  for (const archipelagos of seaChart().values()) {
    const found = archipelagos.find((archipelago) => archipelago.archipelagoId === archipelagoId);
    if (found !== undefined) return found;
  }
  return null;
}

/** A region's slots in claiming order: archipelago by archipelago, slot by slot. */
export function regionSlots(region: SeaRegion): readonly SeaSlot[] {
  return (seaChart().get(region) ?? []).flatMap((archipelago) => archipelago.slots);
}

/** The slot a new island in `region` takes: the first free one in claiming order, or null when full. */
export function nextFreeSeaSlot(region: SeaRegion, isClaimed: (slotId: string) => boolean): SeaSlot | null {
  return regionSlots(region).find((slot) => !isClaimed(slot.slotId)) ?? null;
}

/**
 * The archipelagos open in a region: the initial ones, every one that holds an island, and the one the
 * next island will go to - so the world opens as it fills, one archipelago at a time.
 */
export function openArchipelagos(region: SeaRegion, isClaimed: (slotId: string) => boolean): readonly SeaArchipelago[] {
  const archipelagos = seaChart().get(region) ?? [];
  let open = INITIAL_OPEN_ARCHIPELAGOS;
  for (const archipelago of archipelagos) {
    if (archipelago.slots.some((slot) => isClaimed(slot.slotId))) open = Math.max(open, archipelago.index);
  }
  const next = nextFreeSeaSlot(region, isClaimed);
  if (next !== null) open = Math.max(open, next.archipelagoIndex);
  return archipelagos.slice(0, open);
}
