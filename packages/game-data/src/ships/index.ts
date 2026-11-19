/**
 * Ships (docs/design/NAVAL.md, W5a): what a player sails the chart in.
 *
 * A player has one ship. The dock's rowboat is everyone's from the start and costs nothing; each
 * next class is built at the dock with gold, wood and ore, replacing the one before. A ship's speed
 * decides how long a voyage takes; its hull and cannons are what it fights with (W5c).
 *
 * Owner decision, 2026-11-19: ships are built at the dock, and going far takes time. The numbers
 * below are a first proposal, set beside the mine upgrades' scale; they are game data and are tuned
 * here, never in code.
 */

export const SHIP_GOLD_CURRENCY_ID = "currency_gold";
export const SHIP_WOOD_ITEM_ID = "item_wood";
export const SHIP_ORE_ITEM_ID = "item_ore";

export interface ShipClassDefinition {
  /** Stable id, `ship_class_<name>`. */
  readonly id: string;
  /** 1 for the rowboat; each next class is one more. */
  readonly tier: number;
  readonly requiredPlayerLevel: number;
  /** Chart tiles a voyage covers per minute. */
  readonly speedTilesPerMinute: number;
  readonly hull: number;
  readonly cannons: number;
  /** What building it costs; null for the dock's own rowboat. */
  readonly buildCost: { readonly gold: number; readonly wood: number; readonly ore: number } | null;
}

export const SHIP_CLASSES: readonly ShipClassDefinition[] = [
  { id: "ship_class_rowboat", tier: 1, requiredPlayerLevel: 1, speedTilesPerMinute: 40, hull: 60, cannons: 0, buildCost: null },
  { id: "ship_class_sloop", tier: 2, requiredPlayerLevel: 10, speedTilesPerMinute: 70, hull: 150, cannons: 2, buildCost: { gold: 800, wood: 150, ore: 60 } },
  { id: "ship_class_brig", tier: 3, requiredPlayerLevel: 25, speedTilesPerMinute: 100, hull: 320, cannons: 6, buildCost: { gold: 3_000, wood: 500, ore: 300 } },
  { id: "ship_class_frigate", tier: 4, requiredPlayerLevel: 45, speedTilesPerMinute: 130, hull: 600, cannons: 12, buildCost: { gold: 12_000, wood: 1_600, ore: 1_200 } }
];

/** The shortest a voyage ever takes: even the nearest neighbour is a short sail, not a step. */
export const VOYAGE_MIN_SECONDS = 60;

export function shipClassByTier(tier: number): ShipClassDefinition | null {
  return SHIP_CLASSES.find((entry) => entry.tier === tier) ?? null;
}

/** How long a voyage of `distanceTiles` takes at a class's speed, in whole seconds. */
export function voyageSeconds(distanceTiles: number, speedTilesPerMinute: number): number {
  if (!Number.isFinite(distanceTiles) || distanceTiles < 0) throw new Error("A voyage's distance must be a non-negative number");
  if (!Number.isFinite(speedTilesPerMinute) || speedTilesPerMinute <= 0) throw new Error("A ship's speed must be positive");
  return Math.max(VOYAGE_MIN_SECONDS, Math.ceil((distanceTiles / speedTilesPerMinute) * 60));
}
