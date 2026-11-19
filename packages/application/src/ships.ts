import {
  DomainError,
  MAX_TOTAL_XP,
  createXpAward,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  runSeaBattle,
  shipIdFor,
  type InventoryItem,
  type PlayerId,
  type ProgressionDefinition,
  type SeaBattleInput,
  type SeaBattleResult,
  type SeaBattleSetup,
  type SeaBattleShipSpec,
  type XpAward
} from "@happy-farm/domain";
import type { EconomyService } from "./economy";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  AmbushBountyWrite,
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
  VoyageAmbush,
  VoyageRecord,
  WalletRepository,
  WarehouseRepository,
  WarehouseTierRepository
} from "./ports";
import { emptyProgression, progressionView, storedLevel, type ProgressionView } from "./progression";
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
export const SHIP_REPAIR_OPERATION = "SHIP_REPAIR";
/** One receipt per route and day: what makes a bounty payable once (see `bountyRequest`). */
export const PIRATE_BOUNTY_OPERATION = "PIRATE_BOUNTY";
/** A player with no warehouse row is held to this by the database's own guard. */
const STARTER_WAREHOUSE_CAPACITY = 1000;
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
  /** Where a bounty's materials land: only what the island's warehouse has room for. */
  readonly warehouse: WarehouseRepository;
  /** The starter capacity for a player with no warehouse row; the database holds such a player to 1000. */
  readonly warehouseTiers?: WarehouseTierRepository;
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

/** Pirates on a voyage, as the player's device needs them to play the fight the server will replay. */
export interface AmbushView {
  /** When they strike (server time). */
  readonly at: string;
  readonly status: VoyageAmbush["status"];
  /** The fight exactly as the server will replay it: seed, the player's ship, the pirates. */
  readonly setup: SeaBattleSetup;
  readonly pirates: readonly string[];
}

export interface VoyageView {
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly departedAt: string;
  readonly arrivesAt: string;
  readonly arrived: boolean;
  readonly ambush: AmbushView | null;
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

/** The ship as it fights: its class's numbers and its hull as it stands. Null for a class that does not fight. */
function playerSpec(catalogue: ShipCatalogue, ship: PlayerShipRecord | null): SeaBattleShipSpec | null {
  const shipClass = classOf(catalogue, ship);
  const battle = catalogue.battle(shipClass.id);
  if (battle === null || shipClass.cannons <= 0) return null;
  return {
    hull: Math.min(shipClass.hull, ship?.hull ?? shipClass.hull),
    hullMax: shipClass.hull,
    cannons: shipClass.cannons,
    speed: battle.speed,
    turn: battle.turn,
    radius: battle.radius,
    spread: battle.spread
  };
}

/** The fight an ambush is: built from game data and the ship's own hull, never from anything a client sent. */
export function ambushSetup(catalogue: ShipCatalogue, ship: PlayerShipRecord | null, ambush: VoyageAmbush): SeaBattleSetup | null {
  const player = playerSpec(catalogue, ship);
  if (player === null) return null;
  const pirates: SeaBattleShipSpec[] = [];
  for (const id of ambush.pirates) {
    const pirate = catalogue.pirate(id);
    if (pirate === null) return null;
    pirates.push({ hull: pirate.hull, hullMax: pirate.hull, cannons: pirate.cannons, ...pirate.battle });
  }
  return { seed: ambush.seed, player, pirates };
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
            arrived: location === "AT_PLACE",
            ambush: ambushView(catalogue, ship, voyage.ambush ?? null)
          }
  };
}

function ambushView(catalogue: ShipCatalogue, ship: PlayerShipRecord | null, ambush: VoyageAmbush | null): AmbushView | null {
  if (ambush === null) return null;
  const setup = ambushSetup(catalogue, ship, ambush);
  return setup === null ? null : { at: ambush.at, status: ambush.status, setup, pirates: ambush.pirates };
}

/** Whether an ambush has struck and is still waiting to be fought. */
function ambushDue(voyage: VoyageRecord | null, now: string): boolean {
  const ambush = voyage?.ambush ?? null;
  return voyage !== null && voyage.status === "UNDERWAY" && ambush !== null && ambush.status === "PENDING" && Date.parse(ambush.at) <= Date.parse(now);
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
      if (ambushDue(voyage, now)) throw new ApplicationError("AMBUSH_PENDING", "Pirates are waiting: the fight comes first");
      if (ship !== null && ship.hull <= 0) throw new ApplicationError("SHIP_DAMAGED", "The ship must be repaired before it sails");
      const fromSlotId = location === "AT_PLACE" && voyage !== null ? voyage.toSlotId : home.slotId;
      if (fromSlotId === target.slotId) throw new ApplicationError("INVALID_INPUT", "The ship is already there");
      const from = world.chart.findSlot(fromSlotId);
      if (from === null) throw new ApplicationError("INTERNAL_ERROR", "The ship's place is not on the chart");
      const shipClass = classOf(catalogue, ship);
      const distance = Math.hypot(target.x - from.x, target.z - from.z);
      const seconds = catalogue.voyageSeconds(distance, shipClass.speedTilesPerMinute);
      // Pirates are planned here, from the route, the day and the player: the same route on the same
      // day meets the same fate, so calling the ship home and setting out again gains nothing.
      const plan = catalogue.planAmbush({
        playerId: actor.playerId,
        fromSlotId,
        toSlotId: target.slotId,
        day: now.slice(0, 10),
        distanceTiles: distance,
        shipTier: shipClass.tier
      });
      const departed = Date.parse(now);
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
        updatedAt: now,
        ambush:
          plan === null
            ? null
            : { at: new Date(departed + Math.round(seconds * plan.atShare) * 1000).toISOString(), seed: plan.seed, pirates: plan.pirates, status: "PENDING" }
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
      // Pirates that have already struck are not escaped by calling the ship home: the fight is played
      // out with no orders from the captain, and its damage stands.
      if (ambushDue(voyage, now) && voyage.ambush != null) {
        const decided = await decideAmbush(this.dependencies, actor, ship, voyage, [], now, true);
        if (decided !== null) return decided.view;
        continue;
      }
      const ended: VoyageRecord = { ...voyage, status: "ENDED", version: voyage.version + 1, updatedAt: now };
      if (await ships.writeVoyage(ended, voyage.version)) return fleetView(catalogue, ship, ended, now);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while coming home");
  }
}

/** What a won fight paid. Materials the warehouse had no room for are `lost`, never owed later. */
export interface AmbushBountyView {
  readonly currencyDefinitionId: string;
  readonly gold: number;
  readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number; readonly lost: number }[];
  readonly xpAwarded: number;
  readonly leveledUp: boolean;
  readonly progression: ProgressionView;
}

export interface AmbushOutcomeView {
  readonly fleet: FleetView;
  /** The fight this request decided; null when it had already been decided (its outcome is on the voyage). */
  readonly battle: SeaBattleResult | null;
  /** A won fight's bounty (also on a retried request); null when the fight was not won. */
  readonly bounty: AmbushBountyView | null;
}

/**
 * Decides a struck ambush by replaying the fight from its setup and `inputs`, and writes the outcome:
 * the voyage's ambush status, and the ship's hull. A lost fight, or `goHome`, ends the voyage. A won
 * fight pays its bounty in the same batch. Null when anything moved in between (the caller looks again).
 */
async function decideAmbush(
  dependencies: ShipDependencies,
  actor: ActorContext,
  ship: PlayerShipRecord | null,
  voyage: VoyageRecord,
  inputs: readonly SeaBattleInput[],
  now: string,
  goHome: boolean
): Promise<{ readonly view: FleetView; readonly battle: SeaBattleResult; readonly bounty: AmbushBountyView | null } | null> {
  const ambush = voyage.ambush;
  if (ambush == null || ship === null) throw new ApplicationError("INTERNAL_ERROR", "An ambush needs a fighting ship");
  const setup = ambushSetup(dependencies.catalogue, ship, ambush);
  if (setup === null) throw new ApplicationError("INTERNAL_ERROR", "An ambush's ships are not in the catalogue");
  let battle: SeaBattleResult;
  try {
    battle = runSeaBattle(setup, inputs);
  } catch (error: unknown) {
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }
  const endVoyage = goHome || battle.outcome === "LOST";
  // A win pays once per route and day: a route already paid today is fought, and decided, for nothing.
  let prepared: { readonly write: AmbushBountyWrite; readonly view: AmbushBountyView } | null = null;
  if (battle.outcome === "WON") {
    const request = await bountyRequest(dependencies, actor.playerId, voyage);
    const paid = await dependencies.idempotency.find(actor.playerId, PIRATE_BOUNTY_OPERATION, request.requestId);
    if (paid === null) prepared = await prepareBounty(dependencies, actor, voyage, ambush.pirates, request, now);
  }
  const written = await dependencies.ships.resolveAmbush({
    playerId: actor.playerId,
    expectedVoyageVersion: voyage.version,
    expectedShipVersion: ship.version,
    outcome: battle.outcome,
    hull: battle.playerHull,
    endVoyage,
    at: now,
    bounty: prepared?.write ?? null
  });
  if (!written) return null;
  const nextShip: PlayerShipRecord = { ...ship, hull: battle.playerHull, version: ship.version + 1, updatedAt: now };
  const nextVoyage: VoyageRecord = {
    ...voyage,
    status: endVoyage ? "ENDED" : voyage.status,
    version: voyage.version + 1,
    updatedAt: now,
    ambush: { ...ambush, status: battle.outcome }
  };
  return { view: fleetView(dependencies.catalogue, nextShip, nextVoyage, now), battle, bounty: prepared?.view ?? null };
}

/**
 * The bounty's request id: one per route and day, the same key the ambush itself is planned by.
 *
 * Sailing the same route again the same day meets the same pirates with the same seed, so the same
 * recorded orders would win the same fight again. Keying the bounty by the voyage would let a player
 * replay a win for gold without end; keyed by the route and the day, the encounter pays once, and the
 * second payment collides with the first receipt.
 */
async function bountyRequest(dependencies: ShipDependencies, playerId: PlayerId, voyage: VoyageRecord): Promise<{ readonly requestId: string; readonly fingerprint: string }> {
  const fingerprint = await dependencies.fingerprints.hash(
    JSON.stringify([PIRATE_BOUNTY_OPERATION, playerId, voyage.fromSlotId, voyage.toSlotId, voyage.departedAt.slice(0, 10)])
  );
  return { requestId: `bounty_${fingerprint.slice(0, 48)}`, fingerprint };
}

/**
 * Sizes a won fight's bounty against the player's state as it is now: the gold through the economy
 * service, the materials through the inventory service up to the warehouse's free room (and each
 * stack's limit), and the experience up to the curve's top. The batch re-checks every one of these.
 */
async function prepareBounty(
  dependencies: ShipDependencies,
  actor: ActorContext,
  voyage: VoyageRecord,
  pirates: readonly string[],
  request: { readonly requestId: string; readonly fingerprint: string },
  now: string
): Promise<{ readonly write: AmbushBountyWrite; readonly view: AmbushBountyView }> {
  const { catalogue } = dependencies;
  const playerId = actor.playerId;
  const bounty = catalogue.bounty(pirates);
  const currency = dependencies.currencies.findById(parseCurrencyDefinitionId(bounty.currencyDefinitionId));
  if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  const wallet = (await dependencies.wallets.find(playerId, currency.id)) ?? {
    playerId,
    currencyDefinitionId: currency.id,
    balance: 0,
    version: 1,
    updatedAt: now
  };
  const { requestId, fingerprint } = request;
  let economy;
  try {
    economy = dependencies.economyService.prepareMutation(actor, wallet, currency, {
      delta: bounty.gold,
      reason: "PIRATE_BOUNTY",
      referenceId: shipIdFor(playerId),
      requestId
    });
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }

  // Materials: the warehouse's free room is shared, so it is handed out in the bounty's own order.
  const stored = await dependencies.warehouse.find(playerId);
  const capacity = stored?.capacity ?? dependencies.warehouseTiers?.list()[0]?.capacity ?? STARTER_WAREHOUSE_CAPACITY;
  let room = Math.max(0, capacity - (await dependencies.warehouse.usedCapacity(playerId)));
  const additions: AmbushBountyWrite["additions"][number][] = [];
  const expectedInventory: (InventoryItem | null)[] = [];
  const materials: { itemDefinitionId: string; quantity: number; lost: number }[] = [];
  for (const [itemDefinitionId, wanted] of Object.entries(bounty.materials)) {
    if (wanted <= 0) continue;
    const stack = await dependencies.inventory.find(playerId, parseItemDefinitionId(itemDefinitionId));
    const probe = dependencies.inventoryService.prepareAddition(playerId, itemDefinitionId, 1);
    const quantity = Math.max(0, Math.min(wanted, room, probe.maxQuantity - (stack?.quantity ?? 0)));
    materials.push({ itemDefinitionId, quantity, lost: wanted - quantity });
    if (quantity <= 0) continue;
    room -= quantity;
    additions.push(dependencies.inventoryService.prepareAddition(playerId, itemDefinitionId, quantity));
    expectedInventory.push(stack);
  }

  const progression = (await dependencies.progression.find(playerId)) ?? emptyProgression(playerId, now);
  const xp = Math.min(bounty.xp, MAX_TOTAL_XP - progression.xp);
  let award: XpAward | null = null;
  if (xp > 0) {
    try {
      award = createXpAward(dependencies.progressionDefinition, progression, xp, now);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      throw error;
    }
  }
  const view: AmbushBountyView = {
    currencyDefinitionId: currency.id,
    gold: bounty.gold,
    materials,
    xpAwarded: award?.xpAwarded ?? 0,
    leveledUp: award?.leveledUp ?? false,
    progression: progressionView(dependencies.progressionDefinition, award?.xpAfter ?? progression.xp)
  };
  const receipt: IdempotencyRecord = {
    actorPlayerId: playerId,
    operation: PIRATE_BOUNTY_OPERATION,
    requestId,
    payloadFingerprint: fingerprint,
    resourceId: economy.transactionId,
    // The voyage it was paid on, so a retried request reports it only for that voyage.
    responseJson: JSON.stringify({ voyageRequestId: voyage.requestId, bounty: view }),
    status: "COMPLETED",
    createdAt: economy.createdAt
  };
  return { write: { economy, additions, expectedInventory, award, receipt }, view };
}

/** A won fight's bounty as its receipt stored it: what a retried request answers with. */
async function storedBounty(dependencies: ShipDependencies, playerId: PlayerId, voyage: VoyageRecord): Promise<AmbushBountyView | null> {
  if (voyage.ambush?.status !== "WON") return null;
  const { requestId } = await bountyRequest(dependencies, playerId, voyage);
  const receipt = await dependencies.idempotency.find(playerId, PIRATE_BOUNTY_OPERATION, requestId);
  if (receipt === null) return null;
  let stored: { readonly voyageRequestId?: unknown; readonly bounty?: AmbushBountyView };
  try {
    stored = JSON.parse(receipt.responseJson) as typeof stored;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored bounty is unavailable");
  }
  // The route's bounty may have been paid on an earlier voyage today; this voyage's win then paid nothing.
  return stored.voyageRequestId === voyage.requestId && stored.bounty !== undefined ? stored.bounty : null;
}

/**
 * Fights an ambush: the player's device played it and sends only the inputs it recorded; the server
 * replays the fight from the setup it planned and the ship's own hull, and the result is the server's.
 * A fight already decided answers with its outcome and takes no new inputs.
 */
export class FightAmbush {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly inputs: readonly SeaBattleInput[] }): Promise<AmbushOutcomeView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { ships, catalogue, clock } = this.dependencies;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const [ship, voyage] = await Promise.all([ships.findShip(actor.playerId), ships.findVoyage(actor.playerId)]);
      const ambush = voyage?.ambush ?? null;
      if (voyage === null || ambush === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "No pirates are on this voyage");
      // Already decided (a retried request, or the ship was called home): the outcome stands, and no
      // new inputs are taken.
      if (ambush.status !== "PENDING") {
        return { fleet: fleetView(catalogue, ship, voyage, now), battle: null, bounty: await storedBounty(this.dependencies, actor.playerId, voyage) };
      }
      if (voyage.status !== "UNDERWAY") throw new ApplicationError("RESOURCE_NOT_FOUND", "No pirates are on this voyage");
      if (Date.parse(ambush.at) > Date.parse(now)) throw new ApplicationError("AMBUSH_NOT_READY", "The pirates have not struck yet");
      const decided = await decideAmbush(this.dependencies, actor, ship, voyage, command.inputs, now, false);
      if (decided !== null) return { fleet: decided.view, battle: decided.battle, bounty: decided.bounty };
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while fighting");
  }
}

/**
 * Mends the ship at its dock: gold through the ledger (`SHIP_REPAIR`), wood through the inventory,
 * the hull back to its class's full, in one batch with its receipt, exactly as a build is.
 */
export class RepairShip {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue, ships } = this.dependencies;
    const shipId = shipIdFor(actor.playerId);
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([shipId, SHIP_REPAIR_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, SHIP_REPAIR_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = this.dependencies.clock.now();
      const ship = await ships.findShip(actor.playerId);
      const current = classOf(catalogue, ship);
      if (ship === null || ship.hull >= current.hull) throw new ApplicationError("SHIP_NOT_DAMAGED", "The ship needs no repair");
      if (voyageLocation(await ships.findVoyage(actor.playerId), now) !== "HOME") {
        throw new ApplicationError("SHIP_AT_SEA", "The ship must be at its dock to be repaired");
      }
      const cost = catalogue.repairCost(current.hull - ship.hull);
      const currency = this.dependencies.currencies.findById(parseCurrencyDefinitionId(cost.currencyDefinitionId));
      if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
      const materials = Object.entries(cost.materials).filter(([, quantity]) => quantity > 0);
      const expectedInventory: InventoryItem[] = [];
      for (const [itemDefinitionId, quantity] of materials) {
        const row = await this.dependencies.inventory.find(actor.playerId, parseItemDefinitionId(itemDefinitionId));
        if (row === null || row.quantity < quantity) throw new ApplicationError("INSUFFICIENT_ITEMS", "The repair needs materials the island does not have");
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
          reason: "SHIP_REPAIR",
          referenceId: shipId,
          requestId: command.requestId
        });
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const mended: PlayerShipRecord = { ...ship, hull: current.hull, version: ship.version + 1, lastChangeId: economy.transactionId, updatedAt: economy.createdAt };
      const result = fleetView(catalogue, mended, null, economy.createdAt);
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: SHIP_REPAIR_OPERATION,
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
            expectedVersion: ship.version,
            toTier: current.tier,
            classId: current.id,
            hull: current.hull,
            economy,
            removals: materials.map(([itemDefinitionId, quantity]) => this.dependencies.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)),
            expectedInventory,
            createdAt: economy.createdAt
          },
          record
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, SHIP_REPAIR_OPERATION, command.requestId);
        if (raced !== null) return replay(raced, fingerprint);
        if (error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT") continue;
        throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The ship or the economy changed while repairing");
  }
}
