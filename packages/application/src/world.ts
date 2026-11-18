import type { FarmId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  Clock,
  FarmIslandRepository,
  FarmRepository,
  SeaRegionName,
  WorldChartPort,
  WorldIslandTemplate,
  WorldSlotClaim,
  WorldSlotRepository
} from "./ports";

/**
 * The world map's places (docs/design/WORLD_MAP.md).
 *
 * The chart is game data; this layer decides only *which free slot* an island takes. The rule is
 * deliberately simple: the player names a region (or none, and gets the emptiest), and the island
 * takes the first free slot there in the chart's order - so archipelagos fill one at a time and
 * neighbours are real players. The client never names a slot or a position.
 */

export interface WorldPlacement {
  readonly chart: WorldChartPort;
  readonly slots: WorldSlotRepository;
}

/** How many times a claim retries when another island took its slot between the read and the write. */
export const WORLD_SLOT_ATTEMPTS = 4;

/** The region with the fewest islands, in the chart's order on a tie. */
function emptiestRegion(chart: WorldChartPort, claimed: ReadonlySet<string>): SeaRegionName {
  const counts = new Map<SeaRegionName, number>(chart.regions.map((region) => [region, 0]));
  for (const slotId of claimed) {
    const region = chart.findSlot(slotId)?.region;
    if (region !== undefined) counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  let best = chart.regions[0] ?? "NORTH";
  for (const region of chart.regions) if ((counts.get(region) ?? 0) < (counts.get(best) ?? 0)) best = region;
  return best;
}

/** The slot a new island in `region` (or the emptiest region) would take now. */
export async function nextWorldSlot(
  world: WorldPlacement,
  farmId: FarmId,
  region: SeaRegionName | undefined,
  now: string
): Promise<WorldSlotClaim> {
  const claimed = await world.slots.claimedSlotIds();
  const chosen = region ?? emptiestRegion(world.chart, claimed);
  const slot = world.chart.nextFreeSlot(chosen, (slotId) => claimed.has(slotId));
  if (slot === null) throw new ApplicationError("WORLD_REGION_FULL", "Every island place in this sea is taken");
  return { slotId: slot.slotId, region: slot.region, farmId, claimedAt: now };
}

export interface WorldChartSlotView {
  readonly slotId: string;
  readonly x: number;
  readonly z: number;
  readonly claimed: boolean;
  readonly mine: boolean;
  /** The island standing there: its owner's, or the wild one while it is free. */
  readonly island: WorldIslandTemplate;
}

export interface WorldChartView {
  readonly regions: readonly {
    readonly region: SeaRegionName;
    readonly archipelagos: readonly {
      readonly archipelagoId: string;
      readonly index: number;
      readonly centreX: number;
      readonly centreZ: number;
      readonly slots: readonly WorldChartSlotView[];
    }[];
  }[];
  readonly mySlotId: string | null;
}

/** The world as the chart shows it: every open archipelago, which places are taken, and the reader's own. */
export class GetWorldChart {
  constructor(
    private readonly farms: FarmRepository,
    private readonly world: WorldPlacement
  ) {}

  async execute(actor: ActorContext | null): Promise<WorldChartView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findByOwner(actor.playerId);
    const claimed = await this.world.slots.listClaimed();
    const bySlot = new Map(claimed.map((entry) => [entry.slotId, entry]));
    const mine = farm === null ? null : (claimed.find((entry) => entry.farmId === farm.id) ?? null);
    const isClaimed = (slotId: string): boolean => bySlot.has(slotId);
    return {
      mySlotId: mine?.slotId ?? null,
      regions: this.world.chart.regions.map((region) => ({
        region,
        archipelagos: this.world.chart.openArchipelagos(region, isClaimed).map((archipelago) => ({
          archipelagoId: archipelago.archipelagoId,
          index: archipelago.index,
          centreX: archipelago.centreX,
          centreZ: archipelago.centreZ,
          slots: archipelago.slots.map((slot) => {
            const owner = bySlot.get(slot.slotId);
            return {
              slotId: slot.slotId,
              x: slot.x,
              z: slot.z,
              claimed: owner !== undefined,
              mine: owner !== undefined && owner.slotId === mine?.slotId,
              island: owner?.island ?? { ...slot.wild, generatorVersion: this.world.chart.wildGeneratorVersion }
            };
          })
        }))
      }))
    };
  }
}

export interface WorldSlotView {
  readonly slotId: string;
  readonly region: SeaRegionName;
  readonly archipelagoId: string;
  readonly x: number;
  readonly z: number;
}

/**
 * Gives a farm that has a chosen island but no place on the map its place: a farm made before the
 * world map, beyond the ones the migration placed. Idempotent: a farm that has a slot keeps it.
 */
export class EnsureWorldSlot {
  constructor(
    private readonly farms: FarmRepository,
    private readonly islands: FarmIslandRepository,
    private readonly world: WorldPlacement,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: { readonly region?: SeaRegionName | undefined }): Promise<WorldSlotView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findByOwner(actor.playerId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    if ((await this.islands.findByFarm(farm.id)) === null) {
      throw new ApplicationError("ISLAND_CHOICE_UNAVAILABLE", "Only a chosen island has a place on the world map");
    }
    for (let attempt = 0; attempt < WORLD_SLOT_ATTEMPTS; attempt += 1) {
      const existing = await this.world.slots.findByFarm(farm.id);
      if (existing !== null) return this.view(existing);
      const claim = await nextWorldSlot(this.world, farm.id, command.region, this.clock.now());
      if (await this.world.slots.claim(claim)) return this.view(claim);
    }
    // Every attempt lost its slot to another island at the same moment: report it rather than loop.
    throw new ApplicationError("CONFLICT_STALE_STATE", "The world map changed; try again");
  }

  private view(claim: WorldSlotClaim): WorldSlotView {
    const slot = this.world.chart.findSlot(claim.slotId);
    if (slot === null) throw new ApplicationError("INTERNAL_ERROR", "A claimed slot is not on the chart");
    return { slotId: slot.slotId, region: slot.region, archipelagoId: slot.archipelagoId, x: slot.x, z: slot.z };
  }
}
