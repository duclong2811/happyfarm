import { z } from "zod";

/**
 * The road ladder: four surfaces a player builds, cheapest first.
 *
 * V12.1 established the idea - a road is a *tier*, and the renderer draws whichever one the world
 * holds. V12.2 turns it into the thing the shop will actually sell: each tier names itself
 * (`road.dirt.t1`), a road is bought in **segments of four cells** rather than by the tile, and every
 * tier points at the one above it, so "upgrade this road" is a lookup rather than a demolition and a
 * rebuild.
 *
 * Two rules keep it honest:
 *
 * * **It is data, not rendering.** Nothing here knows a mesh, a material, or a colour. The one link to
 *   the renderer is `renderKind`, which names the surface class the client already draws.
 * * **The numbers are provisional and they live in exactly one place.** The relationship the brief
 *   asks for is a stone road costing about five times a dirt one; the prices are placeholders for
 *   balancing and nothing may restate them.
 */

/** How many cells one purchasable road segment covers. */
export const ROAD_SEGMENT_CELLS = 4;

/** The four tiers, in the order a player unlocks them: T1 is what a new island has. */
export const ROAD_TIERS = ["road.dirt.t1", "road.gravel.t2", "road.stone.t3", "road.paved.t4"] as const;
export type RoadTierId = (typeof ROAD_TIERS)[number];

/** What a tier is made of. */
export const ROAD_SURFACES = ["DIRT", "GRAVEL", "STONE", "PAVED"] as const;
export type RoadSurface = (typeof ROAD_SURFACES)[number];

/**
 * How a tier is drawn.
 *
 * These are the renderer's own three surface classes (`RoadKind` in the client's world config): a
 * path, a dirt road, and the stone spine. Gravel and stone share a class with the surfaces above and
 * below them because the client draws three ribbons, not four - a gravel *material* is a later import,
 * and inventing a fourth geometry before the art exists is decoration before gameplay.
 */
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
    /** How many cells one segment of this road covers. */
    segmentCells: z.literal(ROAD_SEGMENT_CELLS),
    /**
     * Gold for one segment, at provisional prices.
     *
     * Placeholder balance, not economy: see `PROVISIONAL_PRICES` below. A stone road costs five times
     * the dirt road of the same length, which is the ratio the brief names.
     */
    pricePerSegment: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** The tier an upgrade replaces this one with, or null at the top of the ladder. */
    upgradeTo: z.enum(ROAD_TIERS).nullable(),
    /** The group an upgrade looks the tier up by. */
    upgradeGroup: z.literal("road"),
    /** How much faster a walker moves along it, against bare ground. */
    moveMultiplier: z.number().min(1).max(3)
  })
  .strict()
  .refine((tier) => tier.rank === ROAD_TIERS.indexOf(tier.id) + 1, {
    message: "A road tier's rank is its place in the ladder"
  });

export type RoadTierData = z.infer<typeof RoadTierSchema>;

export function createRoadTierRegistry(input: unknown): ReadonlyMap<RoadTierId, RoadTierData> {
  const definitions = z.array(RoadTierSchema).parse(input);
  const registry = new Map<RoadTierId, RoadTierData>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate road tier: ${definition.id}`);
    registry.set(definition.id, definition);
  }
  // The ladder is only a ladder if it is complete and climbs: every tier below the top names the one
  // above it, and every name resolves. A dangling upgrade target is a purchase that cannot happen.
  for (const tier of registry.values()) {
    const index = ROAD_TIERS.indexOf(tier.id);
    const expected = ROAD_TIERS[index + 1] ?? null;
    if (tier.upgradeTo !== expected) {
      throw new Error(`${tier.id} must upgrade to ${expected ?? "nothing"}`);
    }
  }
  if (registry.size !== ROAD_TIERS.length) {
    throw new Error(`The road ladder is missing a tier: ${String(registry.size)} of ${String(ROAD_TIERS.length)}`);
  }
  return registry;
}

/**
 * The provisional prices, named once.
 *
 * These are development placeholders and are deliberately *not* balanced: they exist so the ratio the
 * brief asks for - a stone segment at five times a dirt one - is a fact in the data rather than a
 * comment. A later economy pass replaces this table and nothing else.
 */
export const PROVISIONAL_ROAD_PRICES = {
  "road.dirt.t1": 100,
  "road.gravel.t2": 250,
  "road.stone.t3": 500,
  "road.paved.t4": 900
} as const satisfies Readonly<Record<RoadTierId, number>>;

export const roadTiers = createRoadTierRegistry([
  {
    id: "road.dirt.t1",
    displayNameKey: "road.dirt.name",
    label: "Dirt road",
    rank: 1,
    surface: "DIRT",
    renderKind: "SECONDARY",
    segmentCells: ROAD_SEGMENT_CELLS,
    pricePerSegment: PROVISIONAL_ROAD_PRICES["road.dirt.t1"],
    upgradeTo: "road.gravel.t2",
    upgradeGroup: "road",
    moveMultiplier: 1.12
  },
  {
    id: "road.gravel.t2",
    displayNameKey: "road.gravel.name",
    label: "Gravel road",
    rank: 2,
    surface: "GRAVEL",
    renderKind: "SECONDARY",
    segmentCells: ROAD_SEGMENT_CELLS,
    pricePerSegment: PROVISIONAL_ROAD_PRICES["road.gravel.t2"],
    upgradeTo: "road.stone.t3",
    upgradeGroup: "road",
    moveMultiplier: 1.2
  },
  {
    id: "road.stone.t3",
    displayNameKey: "road.stone.name",
    label: "Stone road",
    rank: 3,
    surface: "STONE",
    renderKind: "PRIMARY",
    segmentCells: ROAD_SEGMENT_CELLS,
    pricePerSegment: PROVISIONAL_ROAD_PRICES["road.stone.t3"],
    upgradeTo: "road.paved.t4",
    upgradeGroup: "road",
    moveMultiplier: 1.3
  },
  {
    id: "road.paved.t4",
    displayNameKey: "road.paved.name",
    label: "Paved road",
    rank: 4,
    surface: "PAVED",
    renderKind: "PRIMARY",
    segmentCells: ROAD_SEGMENT_CELLS,
    pricePerSegment: PROVISIONAL_ROAD_PRICES["road.paved.t4"],
    upgradeTo: null,
    upgradeGroup: "road",
    moveMultiplier: 1.4
  }
]);

/** The tier the island itself supplies: the cheapest surface the world can draw. */
export const STARTER_ROAD_TIER: RoadTierId = "road.dirt.t1";

/**
 * What a length of road costs, in gold, in a given tier.
 *
 * Whole segments only, rounded up: a player buys road in the unit the shop sells it in, and can never
 * be quoted a fraction of a coin. The caller supplies the length; nothing here reads a level, an
 * inventory, or a clock.
 */
export function roadCost(tierId: RoadTierId, cells: number): number {
  const tier = roadTiers.get(tierId);
  if (tier === undefined) throw new Error(`Unknown road tier: ${tierId}`);
  if (!Number.isFinite(cells) || cells <= 0) return 0;
  return Math.ceil(cells / tier.segmentCells) * tier.pricePerSegment;
}

/**
 * The tiers a road passes through on its way to the top of the ladder.
 *
 * `upgradeChain("road.dirt.t1")` is `[dirt, gravel, stone, paved]`: an upgrade reuses the same cells,
 * so a player can see what a road becomes without demolishing what is there.
 */
export function upgradeChain(from: RoadTierId): readonly RoadTierId[] {
  const chain: RoadTierId[] = [];
  let current: RoadTierId | null = from;
  while (current !== null) {
    if (chain.includes(current)) throw new Error(`The road ladder cycles at ${current}`);
    chain.push(current);
    current = roadTiers.get(current)?.upgradeTo ?? null;
  }
  return chain;
}
