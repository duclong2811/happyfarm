/**
 * Ships (docs/design/NAVAL.md, W5a; docs/design/FLEET.md, F1): what a player sails the chart in.
 *
 * A player keeps a fleet: each ship takes a berth at the dock, and the dock's tier sets how many there
 * are. Every ship has a role, and each role is a ladder of classes a ship climbs one rank at a time:
 * fishing boats, merchant ships, warships. A ship never changes role. The dock lends everyone its
 * rowboat until they build a ship of their own.
 *
 * `tier` is the ship's size (1 to 4): the model's scale, how it handles at the helm, and which pirate
 * parties come for it. `rank` is its place on its own ladder.
 *
 * Owner decisions, 2026-11-19 (ships are built at the dock; going far takes time) and 2026-11-20 (a
 * fleet capped by the dock's tier; today's rowboat becomes the first fishing boat and the sloop, brig
 * and frigate the first warships; merchant ships from level 50). The numbers are a first proposal,
 * marked provisional in FLEET.md; they are game data and are tuned here, never in code.
 */

export const SHIP_GOLD_CURRENCY_ID = "currency_gold";
export const SHIP_WOOD_ITEM_ID = "item_wood";
export const SHIP_ORE_ITEM_ID = "item_ore";

export const SHIP_ROLES = ["FISHING", "MERCHANT", "WAR"] as const;
export type ShipRole = (typeof SHIP_ROLES)[number];

export interface ShipCost {
  readonly gold: number;
  readonly wood: number;
  readonly ore: number;
}

export interface ShipClassDefinition {
  /** Stable id, `ship_class_<name>`. */
  readonly id: string;
  readonly role: ShipRole;
  /** Its place on its role's ladder: 1 is built new, each next one is an upgrade of the one before. */
  readonly rank: number;
  /** The ship's size, 1 to 4: the model's scale, its handling at the helm, the pirates that come for it. */
  readonly tier: number;
  readonly requiredPlayerLevel: number;
  /** Chart tiles a voyage covers per minute. */
  readonly speedTilesPerMinute: number;
  readonly hull: number;
  readonly cannons: number;
  /** Cargo room, in items: fishing trips (F2) and deliveries (F4). */
  readonly hold: number;
  /** For rank 1, what building one costs; for the ranks after, what the upgrade from the rank before costs. */
  readonly buildCost: ShipCost;
}

/** The dock's own rowboat: lent to a player until they build a ship of their own. */
export const DOCK_ROWBOAT_CLASS_ID = "ship_class_rowboat";

export const SHIP_CLASSES: readonly ShipClassDefinition[] = [
  // Fishing boats: no guns; they run from trouble and carry the catch home.
  { id: "ship_class_rowboat", role: "FISHING", rank: 1, tier: 1, requiredPlayerLevel: 1, speedTilesPerMinute: 40, hull: 60, cannons: 0, hold: 20, buildCost: { gold: 200, wood: 40, ore: 0 } },
  { id: "ship_class_line_boat", role: "FISHING", rank: 2, tier: 1, requiredPlayerLevel: 8, speedTilesPerMinute: 55, hull: 90, cannons: 0, hold: 40, buildCost: { gold: 400, wood: 80, ore: 20 } },
  { id: "ship_class_net_boat", role: "FISHING", rank: 3, tier: 2, requiredPlayerLevel: 20, speedTilesPerMinute: 70, hull: 150, cannons: 0, hold: 80, buildCost: { gold: 1_500, wood: 250, ore: 100 } },
  { id: "ship_class_trawler", role: "FISHING", rank: 4, tier: 3, requiredPlayerLevel: 35, speedTilesPerMinute: 85, hull: 240, cannons: 0, hold: 140, buildCost: { gold: 5_000, wood: 700, ore: 400 } },
  // Warships: today's sloop, brig and frigate, with their numbers unchanged, and a dragon on top.
  { id: "ship_class_sloop", role: "WAR", rank: 1, tier: 2, requiredPlayerLevel: 10, speedTilesPerMinute: 70, hull: 150, cannons: 2, hold: 30, buildCost: { gold: 800, wood: 150, ore: 60 } },
  { id: "ship_class_brig", role: "WAR", rank: 2, tier: 3, requiredPlayerLevel: 25, speedTilesPerMinute: 100, hull: 320, cannons: 6, hold: 50, buildCost: { gold: 3_000, wood: 500, ore: 300 } },
  { id: "ship_class_frigate", role: "WAR", rank: 3, tier: 4, requiredPlayerLevel: 45, speedTilesPerMinute: 130, hull: 600, cannons: 12, hold: 80, buildCost: { gold: 12_000, wood: 1_600, ore: 1_200 } },
  { id: "ship_class_dragon", role: "WAR", rank: 4, tier: 4, requiredPlayerLevel: 65, speedTilesPerMinute: 140, hull: 900, cannons: 16, hold: 120, buildCost: { gold: 30_000, wood: 3_500, ore: 2_800 } },
  // Merchant ships: big holds and light guns; owning one is what opens the market (F4).
  { id: "ship_class_coaster", role: "MERCHANT", rank: 1, tier: 2, requiredPlayerLevel: 50, speedTilesPerMinute: 70, hull: 220, cannons: 1, hold: 150, buildCost: { gold: 6_000, wood: 900, ore: 300 } },
  { id: "ship_class_junk", role: "MERCHANT", rank: 2, tier: 3, requiredPlayerLevel: 55, speedTilesPerMinute: 85, hull: 320, cannons: 2, hold: 250, buildCost: { gold: 10_000, wood: 1_400, ore: 600 } },
  { id: "ship_class_cargo_junk", role: "MERCHANT", rank: 3, tier: 3, requiredPlayerLevel: 62, speedTilesPerMinute: 95, hull: 420, cannons: 3, hold: 400, buildCost: { gold: 16_000, wood: 2_000, ore: 1_000 } },
  { id: "ship_class_great_junk", role: "MERCHANT", rank: 4, tier: 4, requiredPlayerLevel: 70, speedTilesPerMinute: 110, hull: 560, cannons: 4, hold: 600, buildCost: { gold: 25_000, wood: 3_000, ore: 1_600 } }
];

export interface DockTierDefinition {
  readonly tier: number;
  /** How many ships the dock holds. */
  readonly berths: number;
  readonly requiredPlayerLevel: number;
  /** What raising the dock to this tier costs; null for the dock every island starts with. */
  readonly upgradeCost: ShipCost | null;
}

export const DOCK_TIERS: readonly DockTierDefinition[] = [
  { tier: 1, berths: 1, requiredPlayerLevel: 1, upgradeCost: null },
  { tier: 2, berths: 2, requiredPlayerLevel: 15, upgradeCost: { gold: 1_500, wood: 300, ore: 100 } },
  { tier: 3, berths: 3, requiredPlayerLevel: 30, upgradeCost: { gold: 6_000, wood: 900, ore: 500 } },
  { tier: 4, berths: 5, requiredPlayerLevel: 50, upgradeCost: { gold: 20_000, wood: 2_500, ore: 1_800 } }
];

/** The shortest a voyage ever takes: even the nearest neighbour is a short sail, not a step. */
export const VOYAGE_MIN_SECONDS = 60;

export function shipClassById(classId: string): ShipClassDefinition | null {
  return SHIP_CLASSES.find((entry) => entry.id === classId) ?? null;
}

/** A role's classes, rank 1 first. */
export function shipLadder(role: ShipRole): readonly ShipClassDefinition[] {
  return SHIP_CLASSES.filter((entry) => entry.role === role).sort((a, b) => a.rank - b.rank);
}

/** The class a ship of `classId` is upgraded to, or null at the top of its ladder (or for an unknown class). */
export function nextShipClass(classId: string): ShipClassDefinition | null {
  const current = shipClassById(classId);
  if (current === null) return null;
  return SHIP_CLASSES.find((entry) => entry.role === current.role && entry.rank === current.rank + 1) ?? null;
}

export function dockTier(tier: number): DockTierDefinition | null {
  return DOCK_TIERS.find((entry) => entry.tier === tier) ?? null;
}

/** How long a voyage of `distanceTiles` takes at a class's speed, in whole seconds. */
export function voyageSeconds(distanceTiles: number, speedTilesPerMinute: number): number {
  if (!Number.isFinite(distanceTiles) || distanceTiles < 0) throw new Error("A voyage's distance must be a non-negative number");
  if (!Number.isFinite(speedTilesPerMinute) || speedTilesPerMinute <= 0) throw new Error("A ship's speed must be positive");
  return Math.max(VOYAGE_MIN_SECONDS, Math.ceil((distanceTiles / speedTilesPerMinute) * 60));
}

/**
 * Fishing trips (docs/design/FLEET.md, F2): a fishing boat at its dock sails to a ground and comes back
 * by the server's clock with a catch the server rolled when it left. Inshore is quick and cheap; the
 * deep sea is slow and dear. The numbers are Claude's balance, at the owner's request (2026-11-20).
 */
export interface FishingGroundDefinition {
  /** Stable id, `ground_<name>`. */
  readonly id: string;
  readonly seconds: number;
  /** The lowest rank of fishing boat that can work it. */
  readonly minRank: number;
  /** The catch as a share of the boat's hold, before the trip's own luck. */
  readonly catchShare: number;
  /** What comes up, by weight. Items are the shop's own fish. */
  readonly table: readonly { readonly itemDefinitionId: string; readonly weight: number }[];
}

export const FISHING_GROUNDS: readonly FishingGroundDefinition[] = [
  {
    id: "ground_inshore",
    seconds: 600,
    minRank: 1,
    catchShare: 0.4,
    table: [
      { itemDefinitionId: "item_fish_sardine", weight: 55 },
      { itemDefinitionId: "item_fish_mackerel", weight: 40 },
      { itemDefinitionId: "item_fish_snapper", weight: 5 }
    ]
  },
  {
    id: "ground_offshore",
    seconds: 2_700,
    minRank: 2,
    catchShare: 0.7,
    table: [
      { itemDefinitionId: "item_fish_mackerel", weight: 30 },
      { itemDefinitionId: "item_fish_snapper", weight: 50 },
      { itemDefinitionId: "item_fish_tuna", weight: 20 }
    ]
  },
  {
    id: "ground_deep_sea",
    seconds: 10_800,
    minRank: 3,
    catchShare: 1,
    table: [
      { itemDefinitionId: "item_fish_snapper", weight: 25 },
      { itemDefinitionId: "item_fish_tuna", weight: 75 }
    ]
  }
];

/** How far a trip's catch may stray from the ground's share, either way. */
export const FISHING_TRIP_LUCK = 0.15;

export function fishingGround(groundId: string): FishingGroundDefinition | null {
  return FISHING_GROUNDS.find((entry) => entry.id === groundId) ?? null;
}

/**
 * A trip's catch, from the ground, the boat's hold and the server's dice (`roll` returns [0, 1)). The
 * count is the hold times the ground's share, give or take the trip's luck, never more than the hold
 * and never none; each fish is drawn from the ground's table by weight.
 */
export function rollTripCatch(ground: FishingGroundDefinition, hold: number, roll: () => number): Readonly<Record<string, number>> {
  if (!Number.isInteger(hold) || hold <= 0) throw new Error("A fishing boat needs a hold");
  const luck = 1 - FISHING_TRIP_LUCK + roll() * FISHING_TRIP_LUCK * 2;
  const count = Math.max(1, Math.min(hold, Math.round(hold * ground.catchShare * luck)));
  const total = ground.table.reduce((sum, entry) => sum + entry.weight, 0);
  const caught: Record<string, number> = {};
  for (let index = 0; index < count; index += 1) {
    let pick = roll() * total;
    const entry = ground.table.find((candidate) => (pick -= candidate.weight) < 0) ?? ground.table[ground.table.length - 1];
    if (entry === undefined) continue;
    caught[entry.itemDefinitionId] = (caught[entry.itemDefinitionId] ?? 0) + 1;
  }
  return caught;
}
