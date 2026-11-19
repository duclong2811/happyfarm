import {
  DomainError,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  shipIdFor,
  type InventoryItem,
  type PlayerId,
  type ProgressionDefinition
} from "@happy-farm/domain";
import type { EconomyService } from "./economy";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  FarmRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  PlayerShipRecord,
  ProgressionRepository,
  ShipCatalogue,
  ShipClass,
  ShipRepository,
  VoyageRecord,
  WalletRepository
} from "./ports";
import { storedLevel } from "./progression";
import type { WorldPlacement } from "./world";

/**
 * Ships and voyages (docs/design/NAVAL.md, W5a; owner decisions 2026-11-19).
 *
 * A player has one ship: the dock's rowboat until they build the next class. A voyage takes the ship
 * from where it lies - home, or the place it last reached - to a place on the player's own chart, and
 * takes as long as the chart distance at the ship's speed. Nothing ticks: whether a voyage has arrived
 * is read from server time against its stored arrival. "Home" ends the voyage and brings the ship
 * back to its dock at once; travel time on the way home comes with the sea itself (W5b).
 *
 * The client names a class never and a time never: only "build the next one", or a place to sail to.
 */

export const SHIP_BUILD_OPERATION = "SHIP_BUILD";
const WRITE_ATTEMPTS = 8;

export interface ShipDependencies {
  readonly farms: FarmRepository;
  readonly world: WorldPlacement;
  readonly ships: ShipRepository;
  readonly catalogue: ShipCatalogue;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly inventory: InventoryRepository;
  readonly inventoryService: InventoryService;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly economyService: EconomyService;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

export interface ShipView {
  readonly classId: string;
  readonly tier: number;
  readonly hull: number;
  readonly hullMax: number;
  readonly speedTilesPerMinute: number;
  readonly cannons: number;
}

export interface NextShipView {
  readonly classId: string;
  readonly tier: number;
  readonly requiredPlayerLevel: number;
  readonly speedTilesPerMinute: number;
  readonly hull: number;
  readonly cannons: number;
  readonly cost: {
    readonly currencyId: string;
    readonly gold: number;
    readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
  };
}

export interface VoyageView {
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly departedAt: string;
  readonly arrivesAt: string;
  readonly arrived: boolean;
}

export interface FleetView {
  /** The server time the view was read at; arrival is decided against it, never the client's clock. */
  readonly readAt: string;
  readonly ship: ShipView;
  readonly next: NextShipView | null;
  /** Where the ship is: at its dock, out at sea, or at the place a voyage reached. */
  readonly location: "HOME" | "AT_SEA" | "AT_PLACE";
  /** The voyage under way or just completed; null at home. */
  readonly voyage: VoyageView | null;
}

/** Where a voyage leaves the ship at `now`. */
export function voyageLocation(voyage: VoyageRecord | null, now: string): FleetView["location"] {
  if (voyage === null || voyage.status === "ENDED") return "HOME";
  return Date.parse(voyage.arrivesAt) <= Date.parse(now) ? "AT_PLACE" : "AT_SEA";
}

function classOf(catalogue: ShipCatalogue, ship: PlayerShipRecord | null): ShipClass {
  const classes = catalogue.classes();
  const found = ship === null ? classes[0] : classes.find((entry) => entry.tier === ship.tier);
  if (found === undefined) throw new ApplicationError("INTERNAL_ERROR", "A stored ship's class is not in the catalogue");
  return found;
}

function fleetView(catalogue: ShipCatalogue, ship: PlayerShipRecord | null, voyage: VoyageRecord | null, now: string): FleetView {
  const current = classOf(catalogue, ship);
  const next = catalogue.classes().find((entry) => entry.tier === current.tier + 1) ?? null;
  const location = voyageLocation(voyage, now);
  return {
    readAt: now,
    ship: {
      classId: current.id,
      tier: current.tier,
      hull: Math.min(current.hull, ship?.hull ?? current.hull),
      hullMax: current.hull,
      speedTilesPerMinute: current.speedTilesPerMinute,
      cannons: current.cannons
    },
    next:
      next?.buildCost == null
        ? null
        : {
            classId: next.id,
            tier: next.tier,
            requiredPlayerLevel: next.requiredPlayerLevel,
            speedTilesPerMinute: next.speedTilesPerMinute,
            hull: next.hull,
            cannons: next.cannons,
            cost: {
              currencyId: next.buildCost.currencyDefinitionId,
              gold: next.buildCost.gold,
              materials: Object.entries(next.buildCost.materials)
                .filter(([, quantity]) => quantity > 0)
                .map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
            }
          },
    location,
    voyage:
      voyage === null || location === "HOME"
        ? null
        : {
            fromSlotId: voyage.fromSlotId,
            toSlotId: voyage.toSlotId,
            departedAt: voyage.departedAt,
            arrivesAt: voyage.arrivesAt,
            arrived: location === "AT_PLACE"
          }
  };
}

async function playerLevel(dependencies: ShipDependencies, playerId: PlayerId): Promise<number> {
  return storedLevel(dependencies.progressionDefinition, await dependencies.progression.find(playerId));
}

/** The player's ship, the next class they could build, and where the ship is. */
export class GetFleet {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const [ship, voyage] = await Promise.all([this.dependencies.ships.findShip(actor.playerId), this.dependencies.ships.findVoyage(actor.playerId)]);
    return fleetView(this.dependencies.catalogue, ship, voyage, this.dependencies.clock.now());
  }
}

/**
 * Builds the next class of ship at the dock, replacing the one there.
 *
 * Gold goes through the centralized economy service and its ledger, wood and ore through the
 * centralized inventory service, the ship row and the receipt in the same batch. Only a ship at its
 * dock can be rebuilt, and only for a player of the next class's level. A replayed request answers
 * from its receipt; a request that lost a race to another build is refused rather than charged twice.
 */
export class BuildShip {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue, ships } = this.dependencies;
    const shipId = shipIdFor(actor.playerId);
    // The request, not the target class: a replay arrives after the class has already moved on.
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([shipId, SHIP_BUILD_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, SHIP_BUILD_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);

    const first = await ships.findShip(actor.playerId);
    const startTier = classOf(catalogue, first).tier;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const ship = attempt === 0 ? first : await ships.findShip(actor.playerId);
      const current = classOf(catalogue, ship);
      // The step is decided once, from the class the caller saw; another build moving it makes this
      // request stale rather than a second purchase.
      if (current.tier !== startTier) throw new ApplicationError("CONFLICT_STALE_STATE", "The ship changed while building");
      const next = catalogue.classes().find((entry) => entry.tier === current.tier + 1);
      const cost = next?.buildCost ?? null;
      if (next === undefined || cost === null) throw new ApplicationError("SHIP_MAX_CLASS", "The ship is already the finest class");
      const now = this.dependencies.clock.now();
      // A ship away from its dock cannot be rebuilt, whatever else would allow it.
      if (voyageLocation(await ships.findVoyage(actor.playerId), now) !== "HOME") {
        throw new ApplicationError("SHIP_AT_SEA", "The ship must be at its dock to be rebuilt");
      }
      if ((await playerLevel(this.dependencies, actor.playerId)) < next.requiredPlayerLevel) {
        throw new ApplicationError("SHIP_LEVEL_REQUIRED", `The next ship needs player level ${String(next.requiredPlayerLevel)}`);
      }
      const currency = this.dependencies.currencies.findById(parseCurrencyDefinitionId(cost.currencyDefinitionId));
      if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");

      const materials = Object.entries(cost.materials).filter(([, quantity]) => quantity > 0);
      const expectedInventory: InventoryItem[] = [];
      for (const [itemDefinitionId, quantity] of materials) {
        const row = await this.dependencies.inventory.find(actor.playerId, parseItemDefinitionId(itemDefinitionId));
        if (row === null || row.quantity < quantity) {
          throw new ApplicationError("INSUFFICIENT_ITEMS", "The ship needs materials the island does not have");
        }
        expectedInventory.push(row);
      }
      const wallet = (await this.dependencies.wallets.find(actor.playerId, currency.id)) ?? {
        playerId: actor.playerId,
        currencyDefinitionId: currency.id,
        balance: 0,
        version: 1,
        updatedAt: now
      };
      let economy;
      try {
        economy = this.dependencies.economyService.prepareMutation(actor, wallet, currency, {
          delta: -cost.gold,
          reason: "SHIP_BUILD",
          referenceId: shipId,
          requestId: command.requestId
        });
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const built: PlayerShipRecord = {
        playerId: actor.playerId,
        shipId,
        classId: next.id,
        tier: next.tier,
        hull: next.hull,
        version: (ship?.version ?? 0) + 1,
        lastChangeId: economy.transactionId,
        createdAt: ship?.createdAt ?? economy.createdAt,
        updatedAt: economy.createdAt
      };
      const result = fleetView(catalogue, built, null, economy.createdAt);
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: SHIP_BUILD_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: economy.createdAt
      };
      try {
        await ships.buildAtomically(
          {
            playerId: actor.playerId,
            shipId,
            expectedFromTier: current.tier,
            expectedVersion: ship?.version ?? 0,
            toTier: next.tier,
            classId: next.id,
            hull: next.hull,
            economy,
            removals: materials.map(([itemDefinitionId, quantity]) => this.dependencies.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)),
            expectedInventory,
            createdAt: economy.createdAt
          },
          record
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, SHIP_BUILD_OPERATION, command.requestId);
        if (raced !== null) return replay(raced, fingerprint);
        if (error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT") continue;
        throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The ship or the economy changed while building");
  }
}

function replay(record: IdempotencyRecord, fingerprint: string): FleetView {
  if (record.payloadFingerprint !== fingerprint) {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
  }
  try {
    return JSON.parse(record.responseJson) as FleetView;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
}

/**
 * Sets sail for a place on the player's own chart.
 *
 * The ship leaves from where it lies: its dock, or the place its last voyage reached. The passage takes
 * as long as the chart distance at the ship's speed, decided here from game data; the client names
 * only the place. A ship already at sea must arrive (or be called home) first. A retried request with
 * the same id answers with the voyage it started rather than starting another.
 */
export class StartVoyage {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly slotId: string; readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { world, ships, catalogue, clock } = this.dependencies;
    const target = world.chart.findSlot(command.slotId);
    if (target === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "That place is not on the chart");
    const farm = await this.dependencies.farms.findByOwner(actor.playerId);
    const home = farm === null ? null : await world.slots.findByFarm(farm.id);
    if (home === null) throw new ApplicationError("WORLD_PLACE_UNCHARTED", "Only an island with a place on the chart can sail");
    const visited = await world.visits.listVisited(actor.playerId);
    if (!world.chart.chartedArchipelagos(home.slotId, visited).some((archipelago) => archipelago.archipelagoId === target.archipelagoId)) {
      throw new ApplicationError("WORLD_PLACE_UNCHARTED", "That place is not on your chart");
    }

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const [ship, voyage] = await Promise.all([ships.findShip(actor.playerId), ships.findVoyage(actor.playerId)]);
      // The same request again: the voyage it started, not a second one.
      if (voyage !== null && voyage.requestId === command.requestId) {
        if (voyage.toSlotId !== target.slotId) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
        return fleetView(catalogue, ship, voyage, now);
      }
      const location = voyageLocation(voyage, now);
      if (location === "AT_SEA") throw new ApplicationError("VOYAGE_UNDERWAY", "The ship is still at sea");
      const fromSlotId = location === "AT_PLACE" && voyage !== null ? voyage.toSlotId : home.slotId;
      if (fromSlotId === target.slotId) throw new ApplicationError("INVALID_INPUT", "The ship is already there");
      const from = world.chart.findSlot(fromSlotId);
      if (from === null) throw new ApplicationError("INTERNAL_ERROR", "The ship's place is not on the chart");
      const shipClass = classOf(catalogue, ship);
      const seconds = catalogue.voyageSeconds(Math.hypot(target.x - from.x, target.z - from.z), shipClass.speedTilesPerMinute);
      const next: VoyageRecord = {
        playerId: actor.playerId,
        fromSlotId,
        toSlotId: target.slotId,
        shipTier: shipClass.tier,
        departedAt: now,
        arrivesAt: new Date(Date.parse(now) + seconds * 1000).toISOString(),
        status: "UNDERWAY",
        requestId: command.requestId,
        version: (voyage?.version ?? 0) + 1,
        updatedAt: now
      };
      if (await ships.writeVoyage(next, voyage?.version ?? null)) return fleetView(catalogue, ship, next, now);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while setting sail");
  }
}

/**
 * Calls the ship home: ends the voyage (under way or arrived) and the ship is at its dock at once.
 * Idempotent: a ship already home stays home.
 */
export class EndVoyage {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { ships, catalogue, clock } = this.dependencies;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const [ship, voyage] = await Promise.all([ships.findShip(actor.playerId), ships.findVoyage(actor.playerId)]);
      if (voyage === null || voyage.status === "ENDED") return fleetView(catalogue, ship, voyage, now);
      const ended: VoyageRecord = { ...voyage, status: "ENDED", version: voyage.version + 1, updatedAt: now };
      if (await ships.writeVoyage(ended, voyage.version)) return fleetView(catalogue, ship, ended, now);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while coming home");
  }
}
