import type { ConstructionInstance, FarmId, FarmIsland, FarmTile } from "@happy-farm/domain";
import type { CropState, CropStateProjector } from "./crops";
import { ApplicationError } from "./errors";
import type {
  ActorContext,
  ClaimedWorldSlot,
  Clock,
  ConstructionRepository,
  CropInstanceRepository,
  FarmIslandRepository,
  FarmRepository,
  FarmTileRepository,
  SeaRegionName,
  ShipRepository,
  TreeInstanceRepository,
  WorldChartArchipelago,
  WorldChartPort,
  WorldIslandTemplate,
  WorldSlotClaim,
  WorldSlotRepository,
  WorldVisitRepository
} from "./ports";
import { voyageLocation } from "./ships";
import type { TreeState, TreeStateProjector } from "./trees";

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
  readonly visits: WorldVisitRepository;
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
  /** The island's name on a settled place (its owner's own), null on a free one. */
  readonly name: string | null;
  /** The island standing there: its owner's, or the wild one while it is free. */
  readonly island: WorldIslandTemplate;
}

export interface WorldArchipelagoView {
  readonly archipelagoId: string;
  readonly index: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly slots: readonly WorldChartSlotView[];
}

/**
 * A ship at sea as anyone can see it: where it sails from and to, and when. Where it is now is
 * computed by the viewer from these times; the server is never asked again.
 */
export interface SeaVoyageView {
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly shipTier: number;
  readonly departedAt: string;
  readonly arrivesAt: string;
  /** The voyager's island name; never the account. */
  readonly name: string | null;
  readonly mine: boolean;
}

/** At most this many ships are drawn at sea from one read. */
export const SEA_VOYAGES_LIMIT = 200;

async function seaVoyages(ships: ShipRepository | undefined, slotIds: readonly string[], reader: string): Promise<readonly SeaVoyageView[]> {
  if (ships === undefined || slotIds.length === 0) return [];
  const listed = await ships.listVoyagesTouching(slotIds, SEA_VOYAGES_LIMIT);
  return listed.map(({ voyage, islandName }) => ({
    fromSlotId: voyage.fromSlotId,
    toSlotId: voyage.toSlotId,
    shipTier: voyage.shipTier,
    departedAt: voyage.departedAt,
    arrivesAt: voyage.arrivesAt,
    name: islandName,
    mine: voyage.playerId === reader
  }));
}

export interface WorldChartView {
  readonly regions: readonly {
    readonly region: SeaRegionName;
    readonly archipelagos: readonly WorldArchipelagoView[];
  }[];
  readonly mySlotId: string | null;
  /** Server time of the read, so a viewer places the ships at sea against the server's clock. */
  readonly readAt: string;
  /** Ships under way in the reader's charted world (none on the harbour's chart). */
  readonly voyages: readonly SeaVoyageView[];
}

/** One archipelago as a chart shows it: each place with its owner's island, or its wild one. */
function archipelagoView(
  chart: WorldChartPort,
  archipelago: WorldChartArchipelago,
  bySlot: ReadonlyMap<string, ClaimedWorldSlot>,
  mySlotId: string | null
): WorldArchipelagoView {
  return {
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
        mine: owner !== undefined && owner.slotId === mySlotId,
        name: owner?.name ?? null,
        island: owner?.island ?? { ...slot.wild, generatorVersion: chart.wildGeneratorVersion }
      };
    })
  };
}

/**
 * The world as the reader's chart shows it.
 *
 * An island with a place sees only its own chart (owner decision, 2026-11-20): its home archipelago,
 * and what it has seen from the places it visited. A reader without a place - a newcomer choosing a
 * sea, or an island waiting for its place - sees the harbour's chart instead: the open archipelagos
 * of every sea, so the choice of sea is an informed one.
 */
export class GetWorldChart {
  constructor(
    private readonly farms: FarmRepository,
    private readonly world: WorldPlacement,
    private readonly ships?: ShipRepository,
    private readonly clock?: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<WorldChartView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findByOwner(actor.playerId);
    const mine = farm === null ? null : await this.world.slots.findByFarm(farm.id);
    if (mine === null) {
      const claimed = await this.world.slots.listClaimed();
      const bySlot = new Map(claimed.map((entry) => [entry.slotId, entry]));
      const isClaimed = (slotId: string): boolean => bySlot.has(slotId);
      return {
        mySlotId: null,
        readAt: this.now(),
        voyages: [],
        regions: this.world.chart.regions.map((region) => ({
          region,
          archipelagos: this.world.chart
            .openArchipelagos(region, isClaimed)
            .map((archipelago) => archipelagoView(this.world.chart, archipelago, bySlot, null))
        }))
      };
    }
    const visited = await this.world.visits.listVisited(actor.playerId);
    const charted = this.world.chart.chartedArchipelagos(mine.slotId, visited);
    const claimed = await this.world.slots.listClaimedIn(charted.flatMap((archipelago) => archipelago.slots.map((slot) => slot.slotId)));
    const bySlot = new Map(claimed.map((entry) => [entry.slotId, entry]));
    const slotIds = charted.flatMap((archipelago) => archipelago.slots.map((slot) => slot.slotId));
    return {
      mySlotId: mine.slotId,
      readAt: this.now(),
      voyages: await seaVoyages(this.ships, slotIds, actor.playerId),
      regions: this.world.chart.regions.map((region) => ({
        region,
        archipelagos: charted
          .filter((archipelago) => archipelago.region === region)
          .map((archipelago) => archipelagoView(this.world.chart, archipelago, bySlot, mine.slotId))
      }))
    };
  }

  private now(): string {
    return this.clock?.now() ?? new Date().toISOString();
  }
}

export interface MyArchipelagoView {
  readonly mySlotId: string | null;
  readonly region: SeaRegionName | null;
  /** The reader's archipelago, or null while their island has no place on the chart. */
  readonly archipelago: WorldArchipelagoView | null;
  readonly readAt: string;
  /** Ships under way to or from the reader's archipelago: what the horizon shows sailing. */
  readonly voyages: readonly SeaVoyageView[];
}

/**
 * The reader's own archipelago: the islands they can see from home. It reads only that
 * archipelago's few places, so the game can ask on every visit without reading the whole world.
 */
export class GetMyArchipelago {
  constructor(
    private readonly farms: FarmRepository,
    private readonly world: WorldPlacement,
    private readonly ships?: ShipRepository,
    private readonly clock?: Clock
  ) {}

  async execute(actor: ActorContext | null): Promise<MyArchipelagoView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const readAt = this.clock?.now() ?? new Date().toISOString();
    const nothing: MyArchipelagoView = { mySlotId: null, region: null, archipelago: null, readAt, voyages: [] };
    const farm = await this.farms.findByOwner(actor.playerId);
    if (farm === null) return nothing;
    const mine = await this.world.slots.findByFarm(farm.id);
    const slot = mine === null ? null : this.world.chart.findSlot(mine.slotId);
    const archipelago = slot === null ? null : this.world.chart.findArchipelago(slot.archipelagoId);
    if (mine === null || slot === null || archipelago === null) return nothing;
    const slotIds = archipelago.slots.map((entry) => entry.slotId);
    const [claimed, voyages] = await Promise.all([this.world.slots.listClaimedIn(slotIds), seaVoyages(this.ships, slotIds, actor.playerId)]);
    const bySlot = new Map(claimed.map((entry) => [entry.slotId, entry]));
    return {
      mySlotId: mine.slotId,
      region: slot.region,
      archipelago: archipelagoView(this.world.chart, archipelago, bySlot, mine.slotId),
      readAt,
      voyages
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

/**
 * What anyone sailing by sees of a settled island: its ground, its fields, its trees and what stands
 * on it. Nothing in it is an owner's private state - no stock, no money, no jobs - and the route that
 * returns it strips every internal id.
 */
export interface PublicIslandView {
  readonly name: string;
  readonly island: FarmIsland;
  readonly tiles: readonly FarmTile[];
  readonly crops: readonly CropState[];
  /** Only the trees standing on the island; a stored one is in its owner's keeping. */
  readonly trees: readonly TreeState[];
  /** Only what stands on the island; a stored object is in its owner's keeping. */
  readonly constructions: readonly ConstructionInstance[];
}

export interface WorldVisitView {
  readonly slotId: string;
  readonly region: SeaRegionName;
  readonly archipelagoId: string;
  readonly archipelagoIndex: number;
  readonly claimed: boolean;
  readonly mine: boolean;
  readonly name: string | null;
  readonly island: WorldIslandTemplate;
  /** The settled island as it stands, or null for a free place (its wild island) and for home. */
  readonly farm: PublicIslandView | null;
}

export interface PublicIslandReaders {
  readonly islands: FarmIslandRepository;
  readonly tiles: FarmTileRepository;
  readonly crops: CropInstanceRepository;
  readonly cropProjector: CropStateProjector;
  readonly trees: TreeInstanceRepository;
  readonly treeProjector: TreeStateProjector;
  readonly constructions: ConstructionRepository;
}

/**
 * Sails to a place on the reader's chart and looks at it (W4: look only, owner decision 2026-11-20).
 *
 * - Only an island with a place on the chart can sail, and only to a place on its own chart: its
 *   home archipelago, or one it has seen from a place it visited. Anything else is refused as
 *   uncharted, so a client cannot read an island by guessing its place.
 * - Going there takes a voyage (W5a, owner decision 2026-11-19): a place other than home can be looked
 *   at only while the player's ship lies there, its voyage arrived. Anything else is refused as
 *   `VOYAGE_NOT_ARRIVED`.
 * - The visit is recorded once, which is what grows the chart: from here the player can see the
 *   archipelagos within sight of this place.
 * - Nothing on the visited island changes. Reading it is the only thing done to it.
 */
export class VisitWorldPlace {
  constructor(
    private readonly farms: FarmRepository,
    private readonly world: WorldPlacement,
    private readonly readers: PublicIslandReaders,
    private readonly clock: Clock,
    private readonly ships: ShipRepository
  ) {}

  async execute(actor: ActorContext | null, command: { readonly slotId: string }): Promise<WorldVisitView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const slot = this.world.chart.findSlot(command.slotId);
    if (slot === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "That place is not on the chart");
    const farm = await this.farms.findByOwner(actor.playerId);
    const home = farm === null ? null : await this.world.slots.findByFarm(farm.id);
    if (farm === null || home === null) throw new ApplicationError("WORLD_PLACE_UNCHARTED", "Only an island with a place on the chart can sail");
    const visited = await this.world.visits.listVisited(actor.playerId);
    const charted = this.world.chart.chartedArchipelagos(home.slotId, visited);
    if (!charted.some((archipelago) => archipelago.archipelagoId === slot.archipelagoId)) {
      throw new ApplicationError("WORLD_PLACE_UNCHARTED", "That place is not on your chart");
    }
    const mine = slot.slotId === home.slotId;
    if (!mine) {
      const now = this.clock.now();
      const voyage = await this.ships.findVoyage(actor.playerId);
      if (voyage === null || voyage.toSlotId !== slot.slotId || voyageLocation(voyage, now) !== "AT_PLACE") {
        throw new ApplicationError("VOYAGE_NOT_ARRIVED", "Sail there first: the ship has not arrived");
      }
      // Pirates struck on the way and the fight has not been fought: it comes before the visit.
      if (voyage.ambush?.status === "PENDING") throw new ApplicationError("AMBUSH_PENDING", "Pirates are waiting: the fight comes first");
      await this.world.visits.record(actor.playerId, slot.slotId, now);
    }
    const [owner] = await this.world.slots.listClaimedIn([slot.slotId]);
    const settled = owner !== undefined;
    const farmView = settled && !mine ? await this.publicView(owner) : null;
    return {
      slotId: slot.slotId,
      region: slot.region,
      archipelagoId: slot.archipelagoId,
      archipelagoIndex: slot.archipelagoIndex,
      claimed: settled,
      mine,
      name: owner?.name ?? null,
      island: owner?.island ?? { ...slot.wild, generatorVersion: this.world.chart.wildGeneratorVersion },
      farm: farmView
    };
  }

  private async publicView(owner: ClaimedWorldSlot): Promise<PublicIslandView | null> {
    const island = await this.readers.islands.findByFarm(owner.farmId);
    if (island === null) return null;
    const [tiles, crops, trees, constructions] = await Promise.all([
      this.readers.tiles.listByFarm(owner.farmId),
      this.readers.crops.listByFarm(owner.farmId),
      this.readers.trees.listByFarm(owner.farmId),
      this.readers.constructions.listByFarm(owner.farmId)
    ]);
    return {
      name: owner.name ?? "",
      island,
      tiles,
      crops: this.readers.cropProjector.projectMany(crops),
      trees: this.readers.treeProjector.projectMany(trees).filter((tree) => tree.storageState === "ACTIVE"),
      constructions: constructions.filter((construction) => construction.state === "ACTIVE")
    };
  }
}
