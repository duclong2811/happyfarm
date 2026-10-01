import { z } from "zod";

/**
 * The road ladder: four surfaces a player will one day be able to build, cheapest first.
 *
 * Roads are the one place the V12 recovery had real, useful work to keep. The interrupted pass had
 * already built the renderer - a terrain-following ribbon, batched cobbles for a stone surface, and a
 * paved disc where roads meet - and drawn it from a hand-authored network. The network is what the
 * player should own, not the renderer: this file is the *data* half of that split, so a rendered road
 * can be priced, unlocked and upgraded without a line of renderer code changing.
 *
 * Everything here is a prototype balance. The numbers are centralised on purpose: one table, so a
 * tuning pass is one edit, and so nothing can grow a second opinion about what a road costs.
 */

/** The four tiers, in the order a player unlocks them. The id *is* the rank. */
export const ROAD_TIERS = ["T1", "T2", "T3", "T4"] as const;
export type RoadTierId = (typeof ROAD_TIERS)[number];

/**
 * How a tier is drawn.
 *
 * These are the renderer's own three surface classes (`RoadKind` in the client's world config): a
 * path, a dirt road, and the stone spine. T4 maps to the stone class as well, because a premium road
 * is a *better* stone road rather than a fourth geometry, and inventing a fourth surface for a
 * prototype would be decoration before gameplay.
 */
export const ROAD_SURFACES = ["DIRT_PATH", "DIRT_ROAD", "STONE_ROAD", "PAVED_ROAD"] as const;
export type RoadSurface = (typeof ROAD_SURFACES)[number];

export const ROAD_RENDER_KINDS = ["PATH", "SECONDARY", "PRIMARY"] as const;
export type RoadRenderKind = (typeof ROAD_RENDER_KINDS)[number];

export const RoadTierSchema = z
  .object({
    id: z.enum(ROAD_TIERS),
    /** What a player is told it is. The client translates the key; the label is the game-data default. */
    displayNameKey: z.string().regex(/^road\.[a-z0-9_]+\.name$/),
    label: z.string().trim().min(1).max(60),
    /** 1..4, and the only thing that orders two tiers. */
    rank: z.number().int().min(1).max(4),
    surface: z.enum(ROAD_SURFACES),
    /** Which of the three drawn surfaces this tier uses. */
    renderKind: z.enum(ROAD_RENDER_KINDS),
    /** Gold per tile of road, at prototype prices. */
    pricePerTile: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** The tier this one replaces, and the group a later upgrade pass will look it up by. */
    upgradeGroup: z.literal("road"),
    /** How much faster a walker moves along it, against bare ground. */
    moveMultiplier: z.number().min(1).max(3)
  })
  .strict()
  .refine((tier) => tier.rank === Number(tier.id.slice(1)), {
    message: "A road tier's rank is its number"
  });

export type RoadTierData = z.infer<typeof RoadTierSchema>;

export function createRoadTierRegistry(input: unknown): ReadonlyMap<RoadTierId, RoadTierData> {
  const definitions = z.array(RoadTierSchema).parse(input);
  const registry = new Map<RoadTierId, RoadTierData>();
  let previousRank = 0;
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate road tier: ${definition.id}`);
    if (definition.rank <= previousRank) {
      throw new Error(`Road tiers must be listed in ascending rank order: ${definition.id}`);
    }
    previousRank = definition.rank;
    registry.set(definition.id, definition);
  }
  return registry;
}

/**
 * The ship list.
 *
 * The one ratio that matters during prototype balancing: the *same length* of dirt road (T2) costs
 * a fifth of a stone road (T3). Everything else is spread around it - a dirt path is half a dirt
 * road because it is half the width, and a premium road is two and a half times the stone road
 * because it is the last thing a player buys, not the first.
 */
export const roadTiers = createRoadTierRegistry([
  {
    id: "T1",
    displayNameKey: "road.dirt_path.name",
    label: "Dirt path",
    rank: 1,
    surface: "DIRT_PATH",
    renderKind: "PATH",
    pricePerTile: 6,
    upgradeGroup: "road",
    moveMultiplier: 1.05
  },
  {
    id: "T2",
    displayNameKey: "road.dirt_road.name",
    label: "Dirt road",
    rank: 2,
    surface: "DIRT_ROAD",
    renderKind: "SECONDARY",
    pricePerTile: 12,
    upgradeGroup: "road",
    moveMultiplier: 1.12
  },
  {
    id: "T3",
    displayNameKey: "road.stone_road.name",
    label: "Stone road",
    rank: 3,
    surface: "STONE_ROAD",
    renderKind: "PRIMARY",
    pricePerTile: 60,
    upgradeGroup: "road",
    moveMultiplier: 1.25
  },
  {
    id: "T4",
    displayNameKey: "road.paved_road.name",
    label: "Paved road",
    rank: 4,
    surface: "PAVED_ROAD",
    renderKind: "PRIMARY",
    pricePerTile: 150,
    upgradeGroup: "road",
    moveMultiplier: 1.4
  }
]);

/** The tier a player starts with: the cheapest surface the world can draw. */
export const STARTER_ROAD_TIER: RoadTierId = "T1";

/**
 * What a length of road costs in a given tier, in gold.
 *
 * Integer gold, rounded up: a player can never be quoted a fraction of a coin. Free of any client
 * state - the caller supplies the length, and nothing here reads a level, an inventory, or a clock.
 */
export function roadCost(tierId: RoadTierId, lengthTiles: number): number {
  const tier = roadTiers.get(tierId);
  if (tier === undefined) throw new Error(`Unknown road tier: ${tierId}`);
  if (!Number.isFinite(lengthTiles) || lengthTiles <= 0) return 0;
  return Math.ceil(tier.pricePerTile * lengthTiles);
}
